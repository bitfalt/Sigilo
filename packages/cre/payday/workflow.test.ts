import { describe, expect } from "bun:test";
import { type EVMLog, hexToBytes, TxStatus } from "@chainlink/cre-sdk";
import { EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
} from "viem";

// Cross-check against the monorepo's own implementation (needs `pnpm install` at the repo root).
import { registryTree } from "../../core/src/merkle";
import localConfig from "./config.local-simulation.json";
import productionConfig from "./config.production.json";
import stagingConfig from "./config.staging.json";
import { observe, parsePaydayBody } from "./backend";
import { ADVANCE_VAULT_ABI, MULTICALL3_ABI, REGISTRY_ABI, ROOT_PUBLISHED_TOPIC } from "./chain";
import devRegistry from "./fixtures/dev-registry.json";
import {
  BN254_R,
  coveringPrefix,
  fieldToHex,
  prefixCandidates,
  registryRoot,
  zeroHashes,
} from "./registry";
import { encodeReport, gasLimitFor, isLate, REPORT_PARAMS } from "./report";
import { type Config, configSchema, initWorkflow, onPayday, onRootPublished } from "./workflow";

const MONAD_TESTNET_SELECTOR = 2183018362218727504n;
const REGISTRY = getAddress("0xba306ac85e31D43b92bc1915fF84354A08140A8B");
const MULTICALL = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
const VAULT = getAddress("0xdB38A7F37f45934A42f4ddD740d8F69414de7734");
const ORACLE = getAddress("0x00000000000000000000000000000000000Fa11e");

const leaves = devRegistry.leaves.map((l) => BigInt(l));
const ROOT_38 = devRegistry.roots["38"] as Hex;
const ROOT_37 = devRegistry.roots["37"] as Hex;

// Pinned in packages/core/src/hash.test.ts (V.emptyRegistry) and the circuit's tests.nr.
const EMPTY_REGISTRY_ROOT = "0x1a8e5ed1f1128e6ca54bffc1b94fa4a6cd092049d280d6f6577e2f4bea81346b";

// Same bytes are decoded in packages/contracts/test/SigiloOracle.t.sol (test_reportVector).
const REPORT_VECTOR =
  "0x000000000000000000000000000000000000000000000000000000006acbe8bb00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000000207aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000012b6e4595584516d42f4a87e65f7095885620f127ca7ed439f1809ccc62c5cdb7000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000db38a7f37f45934a42f4ddd740d8f69414de773400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000005f010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000db38a7f37f45934a42f4ddd740d8f69414de773400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000";

function pseudoRandomLeaves(n: number, seed: bigint): bigint[] {
  const out: bigint[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) % BN254_R;
    out.push(x);
  }
  return out;
}

describe("registry tree (Poseidon2, depth 16)", () => {
  test("empty tree matches core's pinned vector", () => {
    expect(fieldToHex(registryRoot([]))).toBe(EMPTY_REGISTRY_ROOT);
    expect(fieldToHex(zeroHashes()[16]!)).toBe(EMPTY_REGISTRY_ROOT);
  });

  test("rebuilds the roots SigiloRegistry published on Monad testnet", () => {
    expect(fieldToHex(registryRoot(leaves))).toBe(ROOT_38);
    expect(fieldToHex(registryRoot(leaves.slice(0, 37)))).toBe(ROOT_37);
  });

  test("agrees with packages/core registryTree", () => {
    for (const n of [0, 1, 2, 3, 5, 17, 64]) {
      const set = pseudoRandomLeaves(n, BigInt(n) + 7n);
      expect(registryRoot(set)).toBe(registryTree(set).root);
    }
  });

  test("prefix candidates: hint first, then newest, unique and in range", () => {
    expect(prefixCandidates(38, 38, 3)).toEqual([38, 37, 36, 35]);
    expect(prefixCandidates(38, 20, 2)).toEqual([20, 38, 37, 36]);
    expect(prefixCandidates(2, 99, 8)).toEqual([2, 1]);
    expect(prefixCandidates(0, 1, 8)).toEqual([]);
  });

  test("finds the prefix that hashes to a root, or 0", () => {
    expect(coveringPrefix(leaves, BigInt(ROOT_37), prefixCandidates(38, undefined, 2))).toBe(37);
    expect(coveringPrefix(leaves, BigInt(ROOT_38), prefixCandidates(38, 38, 0))).toBe(38);
    expect(coveringPrefix(leaves, 12345n, prefixCandidates(38, 38, 4))).toBe(0);
  });
});

const goodBody = () => ({
  leaves: devRegistry.leaves,
  advances: [{ vault: VAULT, advanceId: "2", expectedRepaid: "2300000", period: 24322 }],
});

describe("backend payload", () => {
  test("accepts the endpoint's shape", () => {
    const body = parsePaydayBody(goodBody(), 64);
    expect(body.leaves.length).toBe(38);
    expect(body.advances[0]).toEqual({
      vault: VAULT,
      advanceId: 2n,
      expectedRepaid: 2300000n,
      period: 24322,
    });
  });

  test("rejects anything outside the privacy contract (extra fields)", () => {
    const body = goodBody();
    const withEmployer = { ...body, advances: [{ ...body.advances[0], employer: "Acme" }] };
    expect(() => parsePaydayBody(withEmployer, 64)).toThrow();
    expect(() => parsePaydayBody({ ...body, salaries: [] }, 64)).toThrow();
  });

  test("rejects malformed values", () => {
    const leaf = (l: string) => ({ ...goodBody(), leaves: [l] });
    expect(() => parsePaydayBody(leaf(fieldToHex(BN254_R - 1n)), 64)).not.toThrow();
    expect(() =>
      parsePaydayBody(leaf(`0x${BN254_R.toString(16).padStart(64, "0")}`), 64),
    ).toThrow();
    expect(() => parsePaydayBody(leaf("0x1234"), 64)).toThrow();
    const advance = (patch: object) => ({
      leaves: [],
      advances: [{ ...goodBody().advances[0], ...patch }],
    });
    expect(() => parsePaydayBody(advance({ advanceId: "0" }), 64)).toThrow();
    expect(() => parsePaydayBody(advance({ advanceId: "01" }), 64)).toThrow();
    expect(() =>
      parsePaydayBody(advance({ expectedRepaid: (1n << 96n).toString() }), 64),
    ).toThrow();
    expect(() => parsePaydayBody(advance({ expectedRepaid: "1.5" }), 64)).toThrow();
    expect(() => parsePaydayBody(advance({ period: 0 }), 64)).toThrow();
    expect(() => parsePaydayBody(advance({ vault: "0x1234" }), 64)).toThrow();
  });

  test("fails closed on duplicates and on more advances than allowed", () => {
    const body = goodBody();
    expect(() =>
      parsePaydayBody({ ...body, advances: [body.advances[0], body.advances[0]] }, 64),
    ).toThrow("duplicate");
    expect(() => parsePaydayBody(body, 0)).toThrow("max is 0");
  });

  test("observation: rebuilt root, matching prefix, advances as strings", () => {
    const body = parsePaydayBody(goodBody(), 64);
    expect(observe(body, ROOT_37, 37, 2)).toEqual({
      leafCount: 38,
      fullRoot: ROOT_38,
      matchedLeafCount: 37,
      advances: [{ vault: VAULT, advanceId: "2", expectedRepaid: "2300000", period: 24322 }],
    });
    expect(observe(body, fieldToHex(0n), 0, 8).matchedLeafCount).toBe(0);
  });
});

describe("report", () => {
  test("encoding is pinned (SigiloOracle.t.sol decodes the same bytes)", () => {
    const encoded = encodeReport({
      observedAt: 1791748283n,
      roots: [
        { root: ROOT_38, leafCount: 38, consistent: true },
        { root: ROOT_37, leafCount: 38, consistent: false },
      ],
      installments: [
        { vault: VAULT, advanceId: 2n, period: 24321, late: true },
        { vault: VAULT, advanceId: 1n, period: 24320, late: false },
      ],
    });
    expect(encoded).toBe(REPORT_VECTOR);
  });

  test("gas limit is sized to the report (Monad bills the limit)", () => {
    expect(gasLimitFor({ observedAt: 1n, roots: [], installments: [] })).toBe(200_000n);
    const full = {
      observedAt: 1n,
      roots: [{ root: ROOT_38, leafCount: 38, consistent: true }],
      installments: Array.from({ length: 64 }, (_, i) => ({
        vault: VAULT as Hex,
        advanceId: BigInt(i + 1),
        period: 24321,
        late: true,
      })),
    };
    // Must stay under the committed configs' cap (maxGasLimit) at maxAdvances = 64.
    expect(gasLimitFor(full)).toBe(3_180_000n);
    expect(gasLimitFor(full)).toBeLessThanOrEqual(BigInt(productionConfig.maxGasLimit));
  });

  test("late only when open and behind schedule", () => {
    expect(isLate({ active: true, repaid: 0n }, 1n)).toBe(true);
    expect(isLate({ active: true, repaid: 1n }, 1n)).toBe(false);
    expect(isLate({ active: true, repaid: 5n }, 0n)).toBe(false);
    expect(isLate({ active: false, repaid: 0n }, 1n)).toBe(false);
  });
});

describe("config", () => {
  test("committed configs parse; every target shares the schedule and chain", () => {
    for (const raw of [localConfig, stagingConfig, productionConfig]) {
      const parsed = configSchema.parse(raw);
      expect(parsed.schedule).toBe("0 0 12 1 * *");
      expect(parsed.chainSelectorName).toBe("monad-testnet");
      expect(parsed.registryAddress).toBe(REGISTRY);
    }
    expect(configSchema.parse(localConfig).mode).toBe("local-simulation");
    expect(configSchema.parse(productionConfig).mode).toBe("production");
  });

  test("local-simulation can't carry a receiver; unknown modes and five-field crons fail", () => {
    expect(() => configSchema.parse({ ...localConfig, oracleAddress: ORACLE })).toThrow();
    expect(() => configSchema.parse({ ...localConfig, mode: "broadcast" })).toThrow();
    expect(() => configSchema.parse({ ...localConfig, schedule: "0 12 1 * *" })).toThrow();
    expect(() => configSchema.parse({ ...localConfig, backendUrl: "http://x.y/cre" })).toThrow();
  });
});

// ------------------------------------------------------------ the workflow, end to end (mocked)

type Vault = Record<string, { owed: bigint; repaid: bigint; active: boolean }>;

/** Fakes Multicall3 → SigiloRegistry / AdvanceVault, and the forwarder write. */
function mockChain(opts: { latestRoot: Hex; rootCount: bigint; known: Hex[]; vault: Vault }) {
  const evm = EvmMock.testInstance(MONAD_TESTNET_SELECTOR);
  const writes: { receiver: Hex; payload: Hex; gasLimit: bigint }[] = [];
  evm.callContract = (req) => {
    expect(getAddress(bytesToHex(req.call!.to))).toBe(MULTICALL);
    const { args } = decodeFunctionData({ abi: MULTICALL3_ABI, data: bytesToHex(req.call!.data) });
    const results = args[0].map((call) => {
      if (getAddress(call.target) === REGISTRY) {
        const { functionName, args: a } = decodeFunctionData({
          abi: REGISTRY_ABI,
          data: call.callData,
        });
        const result =
          functionName === "latestRoot"
            ? opts.latestRoot
            : functionName === "rootCount"
              ? opts.rootCount
              : opts.known.includes((a as readonly [Hex])[0]);
        return {
          success: true,
          returnData: encodeFunctionResult({ abi: REGISTRY_ABI, functionName, result } as never),
        };
      }
      if (getAddress(call.target) === VAULT) {
        const { args: a } = decodeFunctionData({ abi: ADVANCE_VAULT_ABI, data: call.callData });
        const s = opts.vault[a[0].toString()] ?? { owed: 0n, repaid: 0n, active: false };
        return {
          success: true,
          returnData: encodeFunctionResult({
            abi: ADVANCE_VAULT_ABI,
            functionName: "advances",
            result: {
              pseudonym: s.owed > 0n ? 1n : 0n,
              recipient: VAULT,
              principal: s.owed,
              owed: s.owed,
              repaid: s.repaid,
              issuedAt: 1n,
              active: s.active,
            },
          }),
        };
      }
      return { success: false, returnData: "0x" as Hex };
    });
    return {
      data: hexToBytes(
        encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results }),
      ),
    };
  };
  evm.writeReport = (req) => {
    // The test DON prefixes a 109-byte metadata header to the encoded payload.
    writes.push({
      receiver: getAddress(bytesToHex(req.receiver)),
      payload: bytesToHex(req.report!.rawReport.slice(109)),
      gasLimit: req.gasConfig!.gasLimit,
    });
    return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(0xab) };
  };
  return writes;
}

function mockBackend(body: unknown) {
  const http = HttpActionsMock.testInstance();
  const urls: string[] = [];
  http.sendRequest = (req) => {
    urls.push(req.url);
    return { statusCode: 200, body: new TextEncoder().encode(JSON.stringify(body)) };
  };
  return urls;
}

const NOW_MS = 1_791_748_283_000;
const runtimeFor = (config: Config) =>
  newTestRuntime<Config>(null, { timeProvider: () => NOW_MS }, configSchema.parse(config));

const production: Config = configSchema.parse({ ...stagingConfig, oracleAddress: ORACLE });

describe("workflow", () => {
  test("registers the payday cron and the RootPublished log trigger", () => {
    const handlers = initWorkflow(configSchema.parse(localConfig));
    expect(handlers).toHaveLength(2);
    expect(
      (handlers[0]!.trigger as unknown as { config: { schedule: string } }).config.schedule,
    ).toBe("0 0 12 1 * *");
  });

  test("local simulation: audits and stops before any report or write", () => {
    mockBackend(goodBody());
    const writes = mockChain({
      latestRoot: ROOT_38,
      rootCount: 38n,
      known: [ROOT_37, ROOT_38],
      vault: { "2": { owed: 4590000n, repaid: 2300000n, active: true } },
    });
    const runtime = runtimeFor(configSchema.parse(localConfig));
    const result = JSON.parse(onPayday(runtime));
    expect(result).toMatchObject({
      mode: "local-simulation",
      trigger: "payday-cron",
      root: { root: ROOT_38, leafCount: 38, consistent: true },
      advancesChecked: 1,
      late: 0,
    });
    expect(writes).toHaveLength(0);
  });

  test("production: a late advance and a mismatched root reach SigiloOracle", () => {
    const body = { leaves: devRegistry.leaves.slice(0, 30), advances: goodBody().advances };
    mockBackend(body);
    const writes = mockChain({
      latestRoot: ROOT_38,
      rootCount: 38n,
      known: [ROOT_38],
      vault: { "2": { owed: 4590000n, repaid: 0n, active: true } },
    });
    const result = JSON.parse(onPayday(runtimeFor(production)));
    expect(result.mode).toBe("production");
    expect(result.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.receiver).toBe(ORACLE);
    // Sized to the report: base + 1 root + 1 installment.
    expect(writes[0]!.gasLimit).toBe(345_000n);
    const [observedAt, roots, installments] = decodeAbiParameters(
      REPORT_PARAMS,
      writes[0]!.payload,
    );
    expect(observedAt).toBe(BigInt(NOW_MS / 1000));
    expect(roots).toEqual([{ root: ROOT_38, leafCount: 30, consistent: false }]);
    expect(installments).toEqual([{ vault: VAULT, advanceId: 2n, period: 24322, late: true }]);
  });

  test("production fails closed when the report needs more gas than the cap", () => {
    mockBackend(goodBody());
    const writes = mockChain({ latestRoot: ROOT_38, rootCount: 38n, known: [ROOT_38], vault: {} });
    const capped = configSchema.parse({ ...production, maxGasLimit: "250000" });
    expect(() => onPayday(runtimeFor(capped))).toThrow("above maxGasLimit");
    expect(writes).toHaveLength(0);
  });

  test("production fails closed without a deployed oracle", () => {
    mockBackend(goodBody());
    const writes = mockChain({ latestRoot: ROOT_38, rootCount: 38n, known: [ROOT_38], vault: {} });
    const runtime = runtimeFor(configSchema.parse(stagingConfig));
    expect(() => onPayday(runtime)).toThrow("oracleAddress");
    expect(writes).toHaveLength(0);
  });

  test("RootPublished: checks the event's root against the matching prefix", () => {
    mockBackend(goodBody());
    mockChain({
      latestRoot: ROOT_38,
      rootCount: 38n,
      known: [ROOT_37, ROOT_38],
      vault: { "2": { owed: 4590000n, repaid: 2300000n, active: true } },
    });
    const topic = (h: string) => hexToBytes(h);
    const log = {
      address: hexToBytes(REGISTRY),
      topics: [topic(ROOT_PUBLISHED_TOPIC), topic(ROOT_37), topic(fieldToHex(36n))],
      txHash: new Uint8Array(32).fill(1),
    } as unknown as EVMLog;
    const result = JSON.parse(onRootPublished(runtimeFor(configSchema.parse(localConfig)), log));
    expect(result.root).toEqual({ root: ROOT_37, leafCount: 37, consistent: true });
  });

  test("RootPublished from another contract is rejected", () => {
    const log = {
      address: hexToBytes(VAULT),
      topics: [],
      txHash: new Uint8Array(32),
    } as unknown as EVMLog;
    expect(() => onRootPublished(runtimeFor(configSchema.parse(localConfig)), log)).toThrow(
      "expected SigiloRegistry",
    );
  });
});
