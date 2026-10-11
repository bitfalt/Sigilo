// Sigilo "payday" workflow (Chainlink CRE). An independent auditor between Sigilo's backend,
// Monad and the lenders:
//
//   triggers   monthly payday cron, and SigiloRegistry.RootPublished on Monad testnet
//   HTTP       GET {backendUrl}: public registry leaves + what each advance should have repaid
//              (every DON node fetches it and rebuilds the Poseidon2 registry tree itself;
//              consensus on the derived observation)
//   EVM read   SigiloRegistry (latestRoot, rootCount, isKnownRoot) and AdvanceVault.advances(id),
//              batched through Multicall3 at the last finalized block
//   EVM write  one DON-signed report to SigiloOracle through the Chainlink forwarder:
//              "root R is (or is not) backed by the public leaves" and "advance N is late / caught
//              up", so lenders and workers can rely on more than Sigilo's word
//
// Modes: "local-simulation" runs every real fetch, consensus and read, then logs what it would
// write and stops before any report or write. "production" signs and delivers the report.
// The entry point is main.ts (Javy only allows a parameterless export there).

import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  EVMClient,
  type EVMLog,
  getNetwork,
  handler,
  HTTPClient,
  logTriggerConfig,
  prepareReportRequest,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import { EVM_PB } from "@chainlink/cre-sdk/pb";
import { type Address, getAddress, type Hex, isAddress } from "viem";
import { z } from "zod";

import { type BackendObservation, fetchObservation } from "./backend";
import { readAdvances, readRegistry, ROOT_PUBLISHED_TOPIC } from "./chain";
import {
  encodeReport,
  gasLimitFor,
  type InstallmentStatus,
  isLate,
  type PaydayReport,
  type RootCheck,
  unixSeconds,
} from "./report";

// ---------------------------------------------------------------- config

const SIX_FIELD_CRON = /^\S+( \S+){5}$/;
const address = z
  .string()
  .refine((a): boolean => isAddress(a, { strict: false }), "not an address");

const shared = {
  /** Six-field CRE cron: second minute hour day-of-month month day-of-week (UTC). */
  schedule: z.string().regex(SIX_FIELD_CRON, "schedule must have six fields"),
  chainSelectorName: z.string().min(1),
  /** Sigilo's GET /cre/payday endpoint (apps/web/convex/cre.ts). */
  // A regex, not z.string().url(): QuickJS has no URL constructor.
  backendUrl: z
    .string()
    .regex(/^https:\/\/[a-zA-Z0-9.-]+(:\d+)?\/\S*$/, "backendUrl must be https"),
  registryAddress: address,
  multicallAddress: address,
  /** How many leaves behind the newest to look for the prefix that hashes to a root. */
  rootSearchWindow: z.number().int().min(0).max(16),
  /** Upper bound on advances per run (each costs a slot in a Multicall3 read). */
  maxAdvances: z.number().int().min(0).max(120),
};

export const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local-simulation"), ...shared }).strict(),
  z
    .object({
      mode: z.literal("production"),
      ...shared,
      /** SigiloOracle on the target chain. Validated before every write. */
      oracleAddress: z.string(),
      /**
       * Cap on the per-report gas limit, decimal string. The limit itself is sized to each report
       * (report.ts gasLimitFor) because Monad bills the limit, not the gas used.
       */
      maxGasLimit: z.string().regex(/^[1-9]\d{4,7}$/, "maxGasLimit must be 10000..99999999"),
    })
    .strict(),
]);

export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------- audit

type Trigger =
  { kind: "payday-cron" } | { kind: "root-published"; root: Hex; index: bigint; txHash: Hex };

function evmClient(config: Config): EVMClient {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
  if (!network) throw new Error(`Unknown chain selector name: ${config.chainSelectorName}`);
  return new EVMClient(network.chainSelector.selector);
}

const usd = (base: bigint) => {
  const cents = base / 10_000n;
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};

/** The whole run, shared by both triggers. Returns the handler's JSON result. */
export function audit(runtime: Runtime<Config>, trigger: Trigger): string {
  const config = runtime.config;
  const observedAt = unixSeconds(runtime.now());
  const evm = evmClient(config);
  const registry = getAddress(config.registryAddress);
  const multicall = getAddress(config.multicallAddress);

  // 1. Monad: the registry root this run audits.
  const eventRoot = trigger.kind === "root-published" ? trigger.root : undefined;
  const chain = readRegistry(runtime, evm, multicall, registry, eventRoot);
  const target = eventRoot ?? chain.latestRoot;
  const hint =
    trigger.kind === "root-published" ? Number(trigger.index) + 1 : Number(chain.rootCount);
  runtime.log(
    `[registry] rootCount=${chain.rootCount} latestRoot=${chain.latestRoot}` +
      (eventRoot
        ? ` published=${eventRoot} index=${trigger.kind === "root-published" ? trigger.index : ""} known=${chain.rootKnown}`
        : ""),
  );

  // 2. Sigilo's backend, through every node, with consensus on the rebuilt tree.
  const observation = new HTTPClient()
    .sendRequest(runtime, fetchObservation, consensusIdenticalAggregation<BackendObservation>())(
      config.backendUrl,
      target,
      hint,
      config.rootSearchWindow,
      config.maxAdvances,
    )
    .result();
  runtime.log(
    `[backend] leaves=${observation.leafCount} rebuiltRoot=${observation.fullRoot} advances=${observation.advances.length}`,
  );

  // 3. Cross-check: does a prefix of the public leaves hash to the root on Monad?
  const roots: RootCheck[] = [];
  if (BigInt(target) === 0n) {
    runtime.log("[check] no registry root published yet");
  } else if (eventRoot && chain.rootKnown === false) {
    runtime.log(`[check] ${target} is no longer a known root on Monad; skipping it`);
  } else {
    const consistent = observation.matchedLeafCount > 0;
    const leafCount = consistent ? observation.matchedLeafCount : observation.leafCount;
    roots.push({ root: target, leafCount, consistent });
    runtime.log(
      consistent
        ? `[check] root ${target} = Poseidon2 tree of the first ${leafCount} public leaves (OK)`
        : `[check] MISMATCH: no prefix of the ${observation.leafCount} public leaves hashes to ${target}`,
    );
    if (consistent && leafCount < observation.leafCount) {
      const newer = observation.leafCount - leafCount;
      runtime.log(
        target.toLowerCase() === chain.latestRoot.toLowerCase()
          ? `[check] ${newer} newer leaf(s) are not in a published root yet`
          : `[check] ${newer} leaf(s) were added after this root; latest is ${chain.latestRoot}`,
      );
    }
  }

  // 4. Monad: each advance as the vault sees it, against what payroll should have repaid.
  const items = observation.advances.map((a) => ({
    vault: getAddress(a.vault),
    advanceId: BigInt(a.advanceId),
    expectedRepaid: BigInt(a.expectedRepaid),
    period: a.period,
  }));
  const states = readAdvances(runtime, evm, multicall, items);
  const installments: InstallmentStatus[] = [];
  items.forEach((item, i) => {
    const state = states[i]!;
    const label = `[advance] ${item.vault}#${item.advanceId}`;
    if (!state.found) {
      runtime.log(`${label} not found on-chain; skipped`);
      return;
    }
    const late = isLate(state, item.expectedRepaid);
    installments.push({ vault: item.vault, advanceId: item.advanceId, period: item.period, late });
    runtime.log(
      `${label} repaid ${usd(state.repaid)} of ${usd(state.owed)}, due ${usd(item.expectedRepaid)} by period ${item.period}, ` +
        (late ? "LATE" : state.active ? "on schedule" : "closed"),
    );
  });

  // 5. One report for SigiloOracle.
  const report: PaydayReport = { observedAt, roots, installments };
  const encoded = encodeReport(report);
  const gasLimit = gasLimitFor(report);
  const lateCount = installments.filter((s) => s.late).length;
  const wouldWrite = roots.length + installments.length > 0;
  const summary = {
    trigger: trigger.kind,
    observedAt: observedAt.toString(),
    root: roots[0] ? { ...roots[0] } : null,
    advancesChecked: installments.length,
    late: lateCount,
    reportBytes: (encoded.length - 2) / 2,
    gasLimit: gasLimit.toString(),
  };

  if (config.mode === "local-simulation") {
    // Simulation-only target: stop before creating a report or touching a forwarder.
    runtime.log(
      `[local-simulation] would report ${roots.length} root check(s) and ${installments.length} installment status(es) (${lateCount} late), ${summary.reportBytes} bytes, gas limit ${gasLimit}; no report created`,
    );
    return JSON.stringify({ mode: "local-simulation", wouldWrite, ...summary });
  }

  if (config.mode !== "production") throw new Error("unknown mode");
  const oracle = config.oracleAddress;
  if (!isAddress(oracle, { strict: false }) || BigInt(oracle) === 0n) {
    throw new Error("oracleAddress must be the deployed SigiloOracle (nonzero address)");
  }
  if (gasLimit > BigInt(config.maxGasLimit)) {
    throw new Error(`report needs gas limit ${gasLimit}, above maxGasLimit ${config.maxGasLimit}`);
  }
  if (!wouldWrite) {
    runtime.log("[write] nothing to report");
    return JSON.stringify({ mode: "production", txHash: null, ...summary });
  }
  const signed = runtime.report(prepareReportRequest(encoded)).result();
  const reply = evm
    .writeReport(runtime, {
      receiver: getAddress(oracle),
      report: signed,
      gasConfig: { gasLimit: gasLimit.toString() },
    })
    .result();
  if (reply.txStatus !== TxStatus.SUCCESS) {
    throw new Error(reply.errorMessage ?? `write failed with status ${reply.txStatus}`);
  }
  if (reply.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
    throw new Error("SigiloOracle rejected the report");
  }
  if (!reply.txHash || reply.txHash.length === 0) {
    throw new Error("write succeeded without a transaction hash");
  }
  const txHash = bytesToHex(reply.txHash);
  runtime.log(`[write] SigiloOracle updated in ${txHash}`);
  return JSON.stringify({ mode: "production", txHash, ...summary });
}

// ---------------------------------------------------------------- handlers

export const onPayday = (runtime: Runtime<Config>): string =>
  audit(runtime, { kind: "payday-cron" });

export const onRootPublished = (runtime: Runtime<Config>, log: EVMLog): string => {
  const emitter = bytesToHex(log.address).toLowerCase();
  if (emitter !== runtime.config.registryAddress.toLowerCase()) {
    throw new Error(`log from ${emitter}, expected SigiloRegistry`);
  }
  if (log.topics.length !== 3 || bytesToHex(log.topics[0]!) !== ROOT_PUBLISHED_TOPIC) {
    throw new Error("not a RootPublished log");
  }
  const root = bytesToHex(log.topics[1]!);
  const index = BigInt(bytesToHex(log.topics[2]!));
  const txHash = bytesToHex(log.txHash);
  runtime.log(`[trigger] RootPublished root=${root} index=${index} tx=${txHash}`);
  return audit(runtime, { kind: "root-published", root, index, txHash });
};

export const initWorkflow = (config: Config) => {
  const evm = evmClient(config);
  return [
    handler(new CronCapability().trigger({ schedule: config.schedule }), onPayday),
    handler(
      evm.logTrigger(
        logTriggerConfig({
          addresses: [getAddress(config.registryAddress) as Address],
          topics: [[ROOT_PUBLISHED_TOPIC]],
          confidence: "FINALIZED",
        }),
      ),
      onRootPublished,
    ),
  ];
};
