// The global payroll registry tree, rebuilt inside the workflow (QuickJS/WASM).
//
// WARNING: mirrors packages/core/src/merkle.ts and hash.ts (`node`, `zeroHashes`, depth 16), which
// mirror the Noir circuit. The domain tag, input order and depth are part of on-chain state; the
// tests in main.test.ts pin vectors and cross-check this file against core.

import { poseidon2Hash } from "@zkpassport/poseidon2";

/** BN254 scalar field modulus (packages/core/src/constants.ts). */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** Depth of the global registry tree (core REGISTRY_TREE_DEPTH, SPEC.md §7.2). */
export const REGISTRY_TREE_DEPTH = 16;
/** Domain tag of an internal Merkle node: H(5, left, right) (core hash.ts DOMAIN_NODE). */
export const DOMAIN_NODE = 5n;

/** Internal Merkle node, Noir `Poseidon2::hash([5, left, right], 3)`. */
export function node(left: bigint, right: bigint): bigint {
  return poseidon2Hash([DOMAIN_NODE, left, right]);
}

let zeroCache: bigint[] | undefined;

/** zero[i] is the root of an empty subtree of height i (zero[0] = 0, the empty leaf). */
export function zeroHashes(): bigint[] {
  if (zeroCache) return zeroCache;
  const zero = [0n];
  for (let i = 1; i <= REGISTRY_TREE_DEPTH; i++) zero.push(node(zero[i - 1]!, zero[i - 1]!));
  zeroCache = zero;
  return zero;
}

/** Root of the depth-16 registry tree whose first leaves are `leaves` (the rest are empty). */
export function registryRoot(leaves: readonly bigint[]): bigint {
  if (leaves.length > 2 ** REGISTRY_TREE_DEPTH) throw new RangeError("too many registry leaves");
  const zero = zeroHashes();
  let layer = [...leaves];
  for (let level = 0; level < REGISTRY_TREE_DEPTH; level++) {
    const above: bigint[] = [];
    for (let j = 0; j < layer.length; j += 2) {
      above.push(node(layer[j]!, layer[j + 1] ?? zero[level]!));
    }
    layer = above;
  }
  return layer[0] ?? zero[REGISTRY_TREE_DEPTH]!;
}

/**
 * Leaf counts worth trying when looking for the prefix of the leaves that hashes to a published
 * root: the hint first (the publish index + 1, since every publish appends one leaf), then all
 * leaves, then up to `window` fewer (leaves appended but not yet published).
 */
export function prefixCandidates(
  total: number,
  hint: number | undefined,
  window: number,
): number[] {
  const out: number[] = [];
  const push = (k: number) => {
    if (Number.isInteger(k) && k >= 1 && k <= total && !out.includes(k)) out.push(k);
  };
  if (hint !== undefined) push(hint);
  for (let k = total; k >= total - window; k--) push(k);
  return out;
}

/** The first candidate leaf count whose prefix hashes to `target`, or 0 when none does. */
export function coveringPrefix(
  leaves: readonly bigint[],
  target: bigint,
  candidates: readonly number[],
): number {
  for (const k of candidates) {
    if (registryRoot(leaves.slice(0, k)) === target) return k;
  }
  return 0;
}

/** 0x-prefixed 32-byte hex of a field element (the bytes32 encoding of a root). */
export function fieldToHex(x: bigint): `0x${string}` {
  if (x < 0n || x >= BN254_R) throw new RangeError("not a BN254 field element");
  return `0x${x.toString(16).padStart(64, "0")}`;
}
