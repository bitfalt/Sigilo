// Replays Sigilo's real testnet history through the real handlers and checks the result against
// on-chain state. Needs `.cache/testnet.json` from `pnpm snapshot:testnet`; skipped without it.
//
// It feeds the handlers exactly what HyperSync delivers in production: the logs of the Sigilo
// contracts, plus the AUSD transfers the `where` filters select (into SigiloPay, into or out of
// the vault), with lowercase addresses (config.yaml `address_format: lowercase`).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTestIndexer } from "envio";
import { decodeEventLog, type Hex, parseAbi } from "viem";
import { describe, it } from "vitest";

const CACHE = join(import.meta.dirname, "..", ".cache", "testnet.json");

interface Snapshot {
  snapshotBlock: string;
  addresses: Record<"registry" | "verifier" | "sigiloPay" | "vault" | "ausd", string>;
  logs: {
    address: string;
    topics: Hex[];
    data: Hex;
    blockNumber: string;
    blockHash: Hex;
    blockTimestamp: Hex;
    transactionHash: Hex;
    logIndex: number;
  }[];
  txs: Record<string, { to: string | null; input: Hex }>;
  chain: {
    vaultBalance: string;
    advanceCount: string;
    rootCount: string;
    advances: { id: number; principal: string; owed: string; repaid: string; active: boolean }[];
    balances: Record<string, string>;
  };
}

const abi = parseAbi([
  "event RootPublished(bytes32 indexed root, uint256 indexed index)",
  "event EmployerVerificationSet(bytes32 indexed employerId, bool verified)",
  "event PassportVerified(uint256 indexed scope, uint256 indexed pseudonym, uint64 threshold, uint256 firstPeriod, uint256 nonce, bytes32 registryRoot)",
  "event Dispersed(address indexed payer, uint256 pieces, uint256 total)",
  "event Paid(bytes32 indexed intentHash, uint8 indexed action, address indexed to, uint256 total, uint256 amountOut)",
  "event AdvanceIssued(uint256 indexed advanceId, uint256 indexed pseudonym, address indexed recipient, uint256 amount, uint256 owed)",
  "event AdvanceRepaid(uint256 indexed advanceId, address indexed payer, uint256 paid, uint256 remaining)",
  "event AdvanceClosed(uint256 indexed advanceId)",
  "event Withdrawn(address indexed to, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const CONTRACT_EVENTS: Record<string, readonly string[]> = {
  SigiloRegistry: ["RootPublished", "EmployerVerificationSet"],
  IncomePassportVerifier: ["PassportVerified"],
  SigiloPay: ["Dispersed", "Paid"],
  AdvanceVault: ["AdvanceIssued", "AdvanceRepaid", "AdvanceClosed", "Withdrawn"],
  AUSD: ["Transfer"],
};

/** Addresses lowercased, small uints as bigint: what the indexer hands handlers. */
function normalize(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === "number" ? BigInt(v) : typeof v === "string" ? v.toLowerCase() : v,
    ]),
  );
}

function simulateItems(snap: Snapshot) {
  const a = snap.addresses;
  const contractOf: Record<string, string> = {
    [a.registry]: "SigiloRegistry",
    [a.verifier]: "IncomePassportVerifier",
    [a.sigiloPay]: "SigiloPay",
    [a.vault]: "AdvanceVault",
    [a.ausd]: "AUSD",
  };
  const items = [];
  for (const log of snap.logs) {
    const contract = contractOf[log.address];
    if (!contract) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue; // An event the indexer doesn't listen to (AUSD Approval, OperatorTransferred…).
    }
    if (!CONTRACT_EVENTS[contract]!.includes(decoded.eventName)) continue;
    const params = normalize(decoded.args as Record<string, unknown>);
    if (contract === "AUSD") {
      const { from, to } = params as { from: string; to: string };
      if (to !== a.sigiloPay && to !== a.vault && from !== a.vault) continue;
    }
    const tx = snap.txs[log.transactionHash];
    items.push({
      contract,
      event: decoded.eventName,
      srcAddress: log.address,
      logIndex: log.logIndex,
      block: {
        number: Number(log.blockNumber),
        timestamp: Number(BigInt(log.blockTimestamp)),
        hash: log.blockHash,
      },
      transaction: {
        hash: log.transactionHash,
        ...(tx ? { to: tx.to?.toLowerCase(), input: tx.input } : {}),
      },
      params,
    });
  }
  return items;
}

const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

describe.skipIf(!existsSync(CACHE))("testnet replay", () => {
  it("matches the chain", { timeout: 300_000 }, async (t) => {
    const snap = JSON.parse(readFileSync(CACHE, "utf8")) as Snapshot;
    const items = simulateItems(snap);
    const indexer = createTestIndexer();
    // The simulate type is a union over every configured event; these come from decoded logs.
    await indexer.process({ chains: { 10143: { simulate: items as never[] } } });

    const stats = await indexer.NetworkStats.getOrThrow("sigilo");
    const runs = await indexer.PayrollRun.getAll();
    const pieces = await indexer.Piece.getAll();
    const spends = await indexer.Spend.getAll();
    const inputs = await indexer.SpendInput.getAll();
    const advances = await indexer.Advance.getAll();
    const clusters = await indexer.Cluster.getAll();
    const count = (event: string) => items.filter((i) => i.event === event).length;

    // Every payout decoded, and its pieces add up to what the event says.
    t.expect(stats.payrollRuns).toBe(count("Dispersed"));
    t.expect(runs.filter((r) => !r.decoded)).toEqual([]);
    t.expect(stats.pieces).toBe(runs.reduce((n, r) => n + r.pieceCount, 0));
    t.expect(stats.paidVolume).toBe(runs.reduce((s, r) => s + r.total, 0n));

    // Every payment's pulled pieces add up to its total.
    t.expect(stats.spends).toBe(count("Paid"));
    const pulled = new Map<string, bigint>();
    for (const i of inputs) pulled.set(i.spend_id, (pulled.get(i.spend_id) ?? 0n) + i.amount);
    t.expect(spends.filter((s) => pulled.get(s.id) !== s.total).map((s) => s.id)).toEqual([]);

    // Registry and vault state.
    t.expect(BigInt(stats.rootsPublished)).toBe(BigInt(snap.chain.rootCount));
    t.expect(BigInt(stats.advancesIssued)).toBe(BigInt(snap.chain.advanceCount));
    const portfolio = await indexer.LenderPortfolio.getOrThrow(snap.addresses.vault);
    t.expect(portfolio.liquidity).toBe(BigInt(snap.chain.vaultBalance));
    for (const onChain of snap.chain.advances) {
      const advance = advances.find((x) => x.advanceId === onChain.id)!;
      t.expect({
        principal: advance.principal,
        owed: advance.owed,
        repaid: advance.repaid,
        active: advance.status === "ACTIVE",
      }).toEqual({
        principal: BigInt(onChain.principal),
        owed: BigInt(onChain.owed),
        repaid: BigInt(onChain.repaid),
        active: onChain.active,
      });
    }

    // Every payroll piece and advance account holds exactly what it received minus what it spent.
    const off = pieces
      .filter((p) => p.source === "PAYROLL" || p.source === "ADVANCE")
      .filter((p) => p.amount - p.spentAmount !== BigInt(snap.chain.balances[p.id] ?? -1))
      .map((p) => ({
        id: p.id,
        indexed: p.amount - p.spentAmount,
        chain: snap.chain.balances[p.id],
      }));
    t.expect(off).toEqual([]);

    // Internal consistency of the linkage.
    const active = clusters.filter((c) => c.active);
    t.expect(stats.clusters).toBe(active.length);
    t.expect(stats.linkedPieces).toBe(
      pieces.filter((p) => p.source === "PAYROLL" && p.linked).length,
    );
    t.expect(stats.multiRunClusters).toBe(active.filter((c) => c.runCount >= 2).length);
    t.expect(stats.largestCluster).toBe(Math.max(0, ...active.map((c) => c.size)));

    writeFileSync(
      join(import.meta.dirname, "..", ".cache", "replay-summary.json"),
      JSON.stringify(
        {
          snapshotBlock: snap.snapshotBlock,
          events: items.length,
          stats,
          runs: runs.sort((x, y) => y.timestamp - x.timestamp),
          denominations: await indexer.Denomination.getAll(),
          runDenominations: await indexer.RunDenomination.getAll(),
          clusters: active.sort((x, y) => y.size - x.size),
          exposures: (await indexer.Exposure.getAll()).filter((e) => e.active),
          spends,
          portfolio,
          advances,
          daily: await indexer.DailyActivity.getAll(),
          pieces,
        },
        big,
        2,
      ),
    );
  });
});
