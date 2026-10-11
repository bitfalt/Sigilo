// Snapshot Sigilo's real testnet history for `test/testnet-replay.test.ts`, without HyperSync or
// Docker: every log of the Sigilo contracts and AUSD over plain JSON-RPC (100-block windows, the
// public RPC's limit), each payout's calldata, and, right after, the on-chain state the replay is
// checked against (vault balance and advances, registry root count, every piece's AUSD balance).
//
//   node scripts/snapshot-testnet.ts            # writes .cache/testnet.json (gitignored)
//   MONAD_RPC_URL=… node scripts/snapshot-testnet.ts
//
// Takes a few minutes on the public RPC. Needs Node ≥ 22.18 (runs TypeScript directly).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  type Log,
  parseAbi,
  toEventSelector,
} from "viem";
import { monadTestnet } from "viem/chains";

const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const FROM = 69_704_790n;
const WINDOW = 100n;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12);

const ADDRESSES = {
  registry: "0xba306ac85e31d43b92bc1915ff84354a08140a8b",
  verifier: "0x0e40b46a82a79c0a4b0a9957bbd32ae6b5a4b290",
  sigiloPay: "0xbedbfae158ed456e546bc0ee2c2b1405f8abb701",
  vault: "0xdb38a7f37f45934a42f4ddd740d8f69414de7734",
  ausd: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
} as const;

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC, { retryCount: 6, retryDelay: 400 }),
  batch: { multicall: { batchSize: 4096 } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logsIn(from: bigint, to: bigint): Promise<Log[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.getLogs({
        address: Object.values(ADDRESSES),
        fromBlock: from,
        toBlock: to,
      });
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}

const head = await client.getBlockNumber();
const windows: [bigint, bigint][] = [];
for (let b = FROM; b <= head; b += WINDOW) {
  windows.push([b, b + WINDOW - 1n > head ? head : b + WINDOW - 1n]);
}
console.log(`Fetching ${windows.length} windows up to block ${head} from ${new URL(RPC).host}…`);

const logs: Log[] = [];
let next = 0;
let done = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < windows.length) {
      const [from, to] = windows[next++]!;
      logs.push(...(await logsIn(from, to)));
      if (++done % 500 === 0) {
        console.log(`  ${done}/${windows.length} windows, ${logs.length} logs`);
      }
    }
  }),
);
logs.sort((a, b) =>
  a.blockNumber === b.blockNumber
    ? a.logIndex! - b.logIndex!
    : a.blockNumber! < b.blockNumber!
      ? -1
      : 1,
);
console.log(`${logs.length} logs in ${Math.round((Date.now() - started) / 1000)} s`);

const payAbi = parseAbi([
  "event Dispersed(address indexed payer, uint256 pieces, uint256 total)",
  "function disperse(address[] to, uint256[] amounts)",
]);
const advanceAbi = parseAbi([
  "event AdvanceIssued(uint256 indexed advanceId, uint256 indexed pseudonym, address indexed recipient, uint256 amount, uint256 owed)",
  "function advanceCount() view returns (uint256)",
  "function advances(uint256) view returns ((uint256 pseudonym, address recipient, uint96 principal, uint96 owed, uint96 repaid, uint40 issuedAt, bool active))",
]);
const registryAbi = parseAbi(["function rootCount() view returns (uint256)"]);

// Payout calldata: the transactions behind SigiloPay's Dispersed events.
const dispersedTopic = toEventSelector(payAbi[0]);
const issuedTopic = toEventSelector(advanceAbi[0]);

const payoutTxs = [
  ...new Set(
    logs
      .filter(
        (l) => l.address.toLowerCase() === ADDRESSES.sigiloPay && l.topics[0] === dispersedTopic,
      )
      .map((l) => l.transactionHash!),
  ),
];
const txs: Record<string, { to: string | null; input: Hex }> = {};
for (let i = 0; i < payoutTxs.length; i += CONCURRENCY) {
  await Promise.all(
    payoutTxs.slice(i, i + CONCURRENCY).map(async (hash) => {
      const tx = await client.getTransaction({ hash });
      txs[hash] = { to: tx.to, input: tx.input };
    }),
  );
}
console.log(`${payoutTxs.length} payouts`);

// Accounts whose balance the replay checks: every payroll piece and advance recipient.
const accounts = new Set<string>();
for (const { to, input } of Object.values(txs)) {
  if (to?.toLowerCase() !== ADDRESSES.sigiloPay) continue;
  try {
    const call = decodeFunctionData({ abi: payAbi, data: input });
    if (call.functionName === "disperse")
      for (const a of call.args[0]) accounts.add(a.toLowerCase());
  } catch {
    // Not a disperse call.
  }
}
for (const l of logs) {
  if (l.address.toLowerCase() === ADDRESSES.vault && l.topics[0] === issuedTopic) {
    accounts.add(`0x${l.topics[3]!.slice(26)}`.toLowerCase());
  }
}

// State right after the history: read at the head the logs were fetched to.
const blockNumber = head;
const list = [...accounts];
const balances = await client.multicall({
  contracts: list.map((a) => ({
    address: ADDRESSES.ausd,
    abi: erc20Abi,
    functionName: "balanceOf" as const,
    args: [a as `0x${string}`],
  })),
  allowFailure: false,
  blockNumber,
});
const [vaultBalance, advanceCount, rootCount] = await Promise.all([
  client.readContract({
    address: ADDRESSES.ausd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ADDRESSES.vault],
    blockNumber,
  }),
  client.readContract({
    address: ADDRESSES.vault,
    abi: advanceAbi,
    functionName: "advanceCount",
    blockNumber,
  }),
  client.readContract({
    address: ADDRESSES.registry,
    abi: registryAbi,
    functionName: "rootCount",
    blockNumber,
  }),
]);
const advances = await Promise.all(
  Array.from({ length: Number(advanceCount) }, (_, i) =>
    client.readContract({
      address: ADDRESSES.vault,
      abi: advanceAbi,
      functionName: "advances",
      args: [BigInt(i + 1)],
      blockNumber,
    }),
  ),
);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache", "testnet.json");
mkdirSync(dirname(out), { recursive: true });
const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
writeFileSync(
  out,
  JSON.stringify(
    {
      snapshotBlock: head.toString(),
      fetchedAt: new Date().toISOString(),
      addresses: ADDRESSES,
      logs: logs.map((l) => ({
        address: l.address.toLowerCase(),
        topics: l.topics,
        data: l.data,
        blockNumber: l.blockNumber,
        blockHash: l.blockHash,
        blockTimestamp: (l as Log & { blockTimestamp?: Hex }).blockTimestamp,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      })),
      txs,
      chain: {
        vaultBalance,
        advanceCount,
        rootCount,
        advances: advances.map((a, i) => ({ id: i + 1, ...a })),
        balances: Object.fromEntries(list.map((a, i) => [a, balances[i]])),
      },
    },
    big,
  ),
);
console.log(`Wrote ${out}: ${list.length} accounts, ${advanceCount} advances, ${rootCount} roots`);
