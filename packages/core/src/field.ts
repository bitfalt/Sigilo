// BN254 scalar field helpers. Every value hashed by the circuit (commitments, roots, ids,
// salts, scopes) is a field element, represented here as a bigint in [0, BN254_R).

import { bytesToHex } from "@noble/hashes/utils.js";

import { BN254_R } from "./constants";

export const U64_MAX = (1n << 64n) - 1n;

/** Validates and returns `x` as a canonical field element. */
export function toField(x: bigint | number | string): bigint {
  const v = BigInt(x);
  if (v < 0n || v >= BN254_R) throw new RangeError(`not a BN254 field element: ${x}`);
  return v;
}

/** Validates `x` as a u64 (gross pay, thresholds). */
export function toU64(x: bigint | number | string): bigint {
  const v = BigInt(x);
  if (v < 0n || v > U64_MAX) throw new RangeError(`not a u64: ${x}`);
  return v;
}

/** 0x-prefixed, 32-byte big-endian hex: the `bytes32` / noir_js `Field` encoding. */
export function fieldToHex(x: bigint): `0x${string}` {
  return `0x${toField(x).toString(16).padStart(64, "0")}`;
}

/** Uniform random field element (64 random bytes reduced mod r to avoid bias). */
export function randomField(): bigint {
  const wide = crypto.getRandomValues(new Uint8Array(64));
  return BigInt(`0x${bytesToHex(wide)}`) % BN254_R;
}
