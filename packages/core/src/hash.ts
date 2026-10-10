// Poseidon2 hashes used by payroll commitments and the income passport circuit (SPEC.md §7).
//
// WARNING: this file mirrors packages/circuits/income_passport/src/lib.nr exactly. Domain tags,
// input order and arity are part of on-chain state; changing any of them invalidates every
// existing commitment and registry root. Cross-language vectors pin both sides (hash.test.ts and
// the circuit's tests.nr).

import { poseidon2Hash } from "@zkpassport/poseidon2";

import { toField, toU64 } from "./field";

// Domain separation tags: the first input of every hash.
export const DOMAIN_COMMITMENT = 1n;
export const DOMAIN_PSEUDONYM = 2n;
export const DOMAIN_PAYROLL_LEAF = 3n;
export const DOMAIN_REGISTRY_LEAF = 4n;
export const DOMAIN_NODE = 5n;

/** Noir `Poseidon2::hash(inputs, inputs.len())` over BN254 (fixed-length sponge). */
export function poseidon2(inputs: readonly bigint[]): bigint {
  return poseidon2Hash(inputs.map(toField));
}

/** Passport commitment registered with the employer: H(1, secret). */
export function commitment(passportSecret: bigint): bigint {
  return poseidon2([DOMAIN_COMMITMENT, passportSecret]);
}

/** Per-verifier pseudonym, unlinkable across scopes: H(2, secret, scope). */
export function pseudonym(passportSecret: bigint, scope: bigint): bigint {
  return poseidon2([DOMAIN_PSEUDONYM, passportSecret, scope]);
}

/**
 * Leaf of a payroll run tree: H(3, commitment, employerId, period, gross, salt).
 * `period` is a month index (see period.ts); `gross` is a u64 in USD cents.
 */
export function payrollLeaf(
  passportCommitment: bigint,
  employerId: bigint,
  period: bigint,
  gross: bigint,
  salt: bigint,
): bigint {
  return poseidon2([
    DOMAIN_PAYROLL_LEAF,
    passportCommitment,
    employerId,
    period,
    toU64(gross),
    salt,
  ]);
}

/** Leaf of the global registry tree: H(4, employerId, period, runRoot). */
export function registryLeaf(employerId: bigint, period: bigint, runRoot: bigint): bigint {
  return poseidon2([DOMAIN_REGISTRY_LEAF, employerId, period, runRoot]);
}

/** Internal Merkle node: H(5, left, right). */
export function node(left: bigint, right: bigint): bigint {
  return poseidon2([DOMAIN_NODE, left, right]);
}
