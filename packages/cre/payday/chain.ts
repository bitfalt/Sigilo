// Monad reads, batched through Multicall3 so a run stays well inside CRE's per-execution chain
// read limit (15 calls, 5 kb payloads). Every read is at the last finalized block.

import {
  bytesToHex,
  type EVMClient,
  encodeCallMsg,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  parseAbi,
  zeroAddress,
} from "viem";

export const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

export const REGISTRY_ABI = parseAbi([
  "event RootPublished(bytes32 indexed root, uint256 indexed index)",
  "function latestRoot() view returns (bytes32)",
  "function rootCount() view returns (uint256)",
  "function isKnownRoot(bytes32 root) view returns (bool)",
]);

export const ADVANCE_VAULT_ABI = parseAbi([
  "struct Advance { uint256 pseudonym; address recipient; uint96 principal; uint96 owed; uint96 repaid; uint40 issuedAt; bool active; }",
  "function advances(uint256 advanceId) view returns (Advance)",
]);

/** keccak256("RootPublished(bytes32,uint256)") */
export const ROOT_PUBLISHED_TOPIC =
  "0x7cb1b170c940f13b008a0e5b1d328f211ef727b902335753cfb3378fbf7b95c1" as const;

/** Advances read per Multicall3 call: ~350 bytes of return data each keeps a call under 5 kb. */
export const ADVANCES_PER_CALL = 10;

type Call = { target: Address; allowFailure: boolean; callData: Hex };
type CallResult = { success: boolean; returnData: Hex };

function aggregate3(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  multicall: Address,
  calls: Call[],
): readonly CallResult[] {
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: multicall,
        data: encodeFunctionData({
          abi: MULTICALL3_ABI,
          functionName: "aggregate3",
          args: [calls],
        }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const results = decodeFunctionResult({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    data: bytesToHex(reply.data),
  });
  if (results.length !== calls.length) throw new Error("Multicall3 returned the wrong length");
  return results;
}

export type RegistryState = {
  latestRoot: Hex;
  rootCount: bigint;
  /** isKnownRoot(root) for the root asked about, when one was. */
  rootKnown?: boolean;
};

/** SigiloRegistry state at the last finalized block (and isKnownRoot of `root` if given). */
export function readRegistry(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  multicall: Address,
  registry: Address,
  root?: Hex,
): RegistryState {
  const calls: Call[] = [
    {
      target: registry,
      allowFailure: false,
      callData: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "latestRoot" }),
    },
    {
      target: registry,
      allowFailure: false,
      callData: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "rootCount" }),
    },
  ];
  if (root) {
    calls.push({
      target: registry,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: "isKnownRoot",
        args: [root],
      }),
    });
  }
  const [latest, count, known] = aggregate3(runtime, evm, multicall, calls);
  const state: RegistryState = {
    latestRoot: decodeFunctionResult({
      abi: REGISTRY_ABI,
      functionName: "latestRoot",
      data: latest!.returnData,
    }),
    rootCount: decodeFunctionResult({
      abi: REGISTRY_ABI,
      functionName: "rootCount",
      data: count!.returnData,
    }),
  };
  if (known) {
    state.rootKnown = decodeFunctionResult({
      abi: REGISTRY_ABI,
      functionName: "isKnownRoot",
      data: known.returnData,
    });
  }
  return state;
}

export type AdvanceState = {
  /** False when the vault call failed or the advance does not exist. */
  found: boolean;
  owed: bigint;
  repaid: bigint;
  active: boolean;
};

/** AdvanceVault.advances(id) for each item, at the last finalized block. */
export function readAdvances(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  multicall: Address,
  items: readonly { vault: Address; advanceId: bigint }[],
): AdvanceState[] {
  const out: AdvanceState[] = [];
  for (let i = 0; i < items.length; i += ADVANCES_PER_CALL) {
    const chunk = items.slice(i, i + ADVANCES_PER_CALL);
    const results = aggregate3(
      runtime,
      evm,
      multicall,
      chunk.map((item) => ({
        target: item.vault,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: ADVANCE_VAULT_ABI,
          functionName: "advances",
          args: [item.advanceId],
        }),
      })),
    );
    for (const r of results) {
      if (!r.success || r.returnData.length !== 2 + 64 * 7) {
        out.push({ found: false, owed: 0n, repaid: 0n, active: false });
        continue;
      }
      const a = decodeFunctionResult({
        abi: ADVANCE_VAULT_ABI,
        functionName: "advances",
        data: r.returnData,
      });
      // An id that was never issued reads as all zeros.
      out.push({ found: a.owed > 0n, owed: a.owed, repaid: a.repaid, active: a.active });
    }
  }
  return out;
}
