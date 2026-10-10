// Fixed-depth Poseidon2 Merkle trees matching the circuit's `merkle_root` (SPEC.md §7.2).
// Empty leaves are 0 and empty subtrees hash up from there, so a sparse tree (e.g. the depth-16
// registry with a handful of runs) is built in O(leaves × depth) without materializing 2^depth
// leaves.

import { REGISTRY_TREE_DEPTH, RUN_TREE_DEPTH } from "./constants";
import { node } from "./hash";

/** Authentication path in the circuit's layout. Index 0 is the leaf level. */
export interface MerklePath {
  siblings: bigint[];
  /** True when the running node is the right child at that level. */
  isRight: boolean[];
}

const zeroCache = new Map<number, bigint[]>();

/** zero[i] is the root of an empty subtree of height i (zero[0] = 0, the empty leaf). */
export function zeroHashes(depth: number): bigint[] {
  const cached = zeroCache.get(depth);
  if (cached) return cached;
  const zero = [0n];
  for (let i = 1; i <= depth; i++) zero.push(node(zero[i - 1]!, zero[i - 1]!));
  zeroCache.set(depth, zero);
  return zero;
}

/** Root reached by hashing `leaf` up `path`. Mirrors `merkle_root` in lib.nr. */
export function merkleRoot(leaf: bigint, path: MerklePath): bigint {
  if (path.siblings.length !== path.isRight.length) throw new Error("malformed Merkle path");
  let current = leaf;
  path.siblings.forEach((sibling, i) => {
    current = path.isRight[i] ? node(sibling, current) : node(current, sibling);
  });
  return current;
}

export class MerkleTree {
  readonly depth: number;
  readonly leaves: readonly bigint[];
  /** layers[0] holds the leaves; layers[depth] holds the root. Missing nodes are empty. */
  private readonly layers: bigint[][];

  constructor(depth: number, leaves: readonly bigint[]) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("bad depth");
    if (leaves.length > 2 ** depth) {
      throw new RangeError(`${leaves.length} leaves exceed a depth-${depth} tree`);
    }
    this.depth = depth;
    this.leaves = [...leaves];

    const zero = zeroHashes(depth);
    this.layers = [[...leaves]];
    for (let level = 0; level < depth; level++) {
      const below = this.layers[level]!;
      const above: bigint[] = [];
      for (let j = 0; j < below.length; j += 2) {
        above.push(node(below[j]!, below[j + 1] ?? zero[level]!));
      }
      this.layers.push(above);
    }
  }

  get root(): bigint {
    return this.layers[this.depth]![0] ?? zeroHashes(this.depth)[this.depth]!;
  }

  path(index: number): MerklePath {
    if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
      throw new RangeError(`leaf index ${index} out of range`);
    }
    const zero = zeroHashes(this.depth);
    const siblings: bigint[] = [];
    const isRight: boolean[] = [];
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.layers[level]![i ^ 1] ?? zero[level]!);
      isRight.push((i & 1) === 1);
      i >>= 1;
    }
    return { siblings, isRight };
  }
}

/** Tree of one employer's payroll run for one period. */
export function runTree(leaves: readonly bigint[]): MerkleTree {
  return new MerkleTree(RUN_TREE_DEPTH, leaves);
}

/** Global append-only registry of payroll runs of verified employers. */
export function registryTree(leaves: readonly bigint[]): MerkleTree {
  return new MerkleTree(REGISTRY_TREE_DEPTH, leaves);
}
