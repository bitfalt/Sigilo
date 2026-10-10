// Income Passport verification (SPEC.md F5–F6). A lender opens a request; the worker answers it
// with a proof bound to the request's scope and nonce; the paid Sigilo Verify API checks the
// proof against SigiloRegistry and returns an attestation signed by the Sigilo operator. Convex
// and the lender console check that signature, so neither has to trust the other's transport.

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { type Address, type Hex, isAddressEqual, recoverTypedDataAddress } from "viem";

import { BN254_R, MONAD_TESTNET_CHAIN_ID, PASSPORT_PERIODS } from "./constants";
import { fieldToHex } from "./field";
import { type PassportPayslip, type PassportPublicInputs } from "./passport";
import { periodIndex } from "./period";

/** Signs Verify API attestations (and publishes registry roots). Public. */
export const SIGILO_OPERATOR: Address = "0x47855D8f060c1d949fb4b9DeccD8B7c333b95AfC";

/** The demo lender; its key is held server-side for the lender console (SPEC.md §3). */
export const DEMO_LENDER = {
  name: "Fondo Quincena",
  address: "0xf76E8721D6d893D8078c18F93C4689C13A0bFC2d" as Address,
} as const;

/** Price of one Verify API call, in USD (paid in AUSD through MPP). */
export const VERIFY_PRICE_USD = "0.10";

/** Requests stay open for a day. */
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The newest proven month may be at most this many months before the current one, so "the last
 * 3 months" means the last three payslips, allowing for a payroll that hasn't run yet.
 */
export const PASSPORT_MAX_AGE_MONTHS = 2;

/** A request's nonce: keccak256(requestId) mod r, never zero (the circuit rejects 0). */
export function requestNonce(requestId: string): bigint {
  const n = BigInt(`0x${bytesToHex(keccak_256(utf8ToBytes(requestId)))}`) % BN254_R;
  return n === 0n ? 1n : n;
}

/** Month index (core/period.ts) of a date, in UTC. */
export function currentPeriod(now = new Date()): number {
  return periodIndex({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

export function isRecent(lastPeriod: number, now = new Date()): boolean {
  return lastPeriod >= currentPeriod(now) - PASSPORT_MAX_AGE_MONTHS;
}

/**
 * The payslips to prove: the newest run of `PASSPORT_PERIODS` consecutive months from one
 * employer, each at or above `threshold` cents. Null when there is none.
 */
export function selectPassportPayslips<T extends { employerId: string; payslip: PassportPayslip }>(
  candidates: readonly T[],
  threshold: bigint,
): T[] | null {
  const byEmployer = new Map<string, Map<number, T>>();
  for (const c of candidates) {
    if (c.payslip.gross < threshold) continue;
    const key = BigInt(c.employerId).toString();
    const periods = byEmployer.get(key) ?? new Map<number, T>();
    if (!periods.has(c.payslip.period)) periods.set(c.payslip.period, c);
    byEmployer.set(key, periods);
  }
  let best: T[] | null = null;
  for (const periods of byEmployer.values()) {
    const sorted = [...periods.keys()].sort((a, b) => b - a);
    for (const last of sorted) {
      const window = Array.from({ length: PASSPORT_PERIODS }, (_, k) =>
        periods.get(last - (PASSPORT_PERIODS - 1) + k),
      );
      if (window.every(Boolean)) {
        if (!best || last > best[best.length - 1]!.payslip.period) best = window as T[];
        break;
      }
    }
  }
  return best;
}

export const ATTESTATION_DOMAIN = {
  name: "Sigilo Verify",
  version: "1",
  chainId: MONAD_TESTNET_CHAIN_ID,
} as const;

export const ATTESTATION_TYPES = {
  IncomeAttestation: [
    { name: "valid", type: "bool" },
    { name: "thresholdCents", type: "uint64" },
    { name: "firstPeriod", type: "uint32" },
    { name: "months", type: "uint8" },
    { name: "scope", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "pseudonym", type: "bytes32" },
    { name: "registryRoot", type: "bytes32" },
    { name: "verifiedAt", type: "uint64" },
  ],
} as const;

/** The Verify API's answer. JSON-safe: numbers fit in 2^53, field elements are bytes32 hex. */
export interface IncomeAttestation {
  valid: boolean;
  thresholdCents: number;
  firstPeriod: number;
  months: number;
  scope: Hex;
  nonce: Hex;
  /** The worker's id for this lender only (unlinkable across lenders). */
  pseudonym: Hex;
  registryRoot: Hex;
  /** Unix seconds. */
  verifiedAt: number;
}

export interface SignedAttestation {
  attestation: IncomeAttestation;
  signature: Hex;
}

export function attestationFor(
  p: PassportPublicInputs,
  valid: boolean,
  verifiedAt: number,
): IncomeAttestation {
  return {
    valid,
    thresholdCents: Number(p.threshold),
    firstPeriod: p.periods[0]!,
    months: p.periods.length,
    scope: fieldToHex(p.scope),
    nonce: fieldToHex(p.nonce),
    pseudonym: fieldToHex(p.pseudonym),
    registryRoot: fieldToHex(p.registryRoot),
    verifiedAt,
  };
}

/** EIP-712 payload for `account.signTypedData`. */
export function attestationTypedData(a: IncomeAttestation) {
  return {
    domain: ATTESTATION_DOMAIN,
    types: ATTESTATION_TYPES,
    primaryType: "IncomeAttestation" as const,
    // viem types uint64 as bigint.
    message: { ...a, thresholdCents: BigInt(a.thresholdCents), verifiedAt: BigInt(a.verifiedAt) },
  };
}

/** Whether `signature` is the Sigilo operator's signature over `attestation`. */
export async function isSigiloAttestation({ attestation, signature }: SignedAttestation) {
  try {
    const signer = await recoverTypedDataAddress({
      ...attestationTypedData(attestation),
      signature,
    });
    return isAddressEqual(signer, SIGILO_OPERATOR);
  } catch {
    return false;
  }
}
