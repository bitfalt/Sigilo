// Income passport witness builder (SPEC.md §7.3, §8). Turns decrypted payslips plus the public
// list of registry leaves into the exact input map of the `income_passport` circuit. The worker
// rebuilds the registry tree locally, so the backend never learns which runs are being proven.

import { PASSPORT_PERIODS } from "./constants";
import { fieldToHex, toField, toU64 } from "./field";
import { commitment, payrollLeaf, pseudonym, registryLeaf } from "./hash";
import { type MerklePath, merkleRoot, registryTree } from "./merkle";

/** What a worker's encrypted payslip carries for one period. */
export interface PassportPayslip {
  /** Month index (period.ts). */
  period: number;
  /** Gross pay in USD cents, as committed by the employer. */
  gross: bigint;
  salt: bigint;
  runRoot: bigint;
  runPath: MerklePath;
}

export interface PassportPublicInputs {
  registryRoot: bigint;
  periods: number[];
  /** USD cents. */
  threshold: bigint;
  scope: bigint;
  nonce: bigint;
  pseudonym: bigint;
}

/** Circuit input map, encoded for noir_js (Fields as hex, u64 as decimal strings). */
export type PassportCircuitInputs = Record<string, string | string[] | string[][] | boolean[][]>;

/** Number of public inputs, in circuit order: root, periods[N], threshold, scope, nonce, pseudonym. */
export const PASSPORT_PUBLIC_INPUT_COUNT = PASSPORT_PERIODS + 5;

export class PassportInputError extends Error {
  constructor(
    readonly code:
      | "wrong-period-count"
      | "periods-not-consecutive"
      | "below-threshold"
      | "payslip-mismatch"
      | "run-not-registered"
      | "zero-nonce",
    message: string,
  ) {
    super(message);
    this.name = "PassportInputError";
  }
}

export function buildPassportInputs(args: {
  passportSecret: bigint;
  employerId: bigint;
  payslips: readonly PassportPayslip[];
  /** Every registry leaf, in insertion order (GET /api/registry/leaves). */
  registryLeaves: readonly bigint[];
  threshold: bigint;
  scope: bigint;
  nonce: bigint;
}): { inputs: PassportCircuitInputs; publicInputs: PassportPublicInputs } {
  const secret = toField(args.passportSecret);
  const employerId = toField(args.employerId);
  const threshold = toU64(args.threshold);
  const scope = toField(args.scope);
  const nonce = toField(args.nonce);
  if (nonce === 0n) throw new PassportInputError("zero-nonce", "nonce must be non-zero");

  const payslips = [...args.payslips].sort((a, b) => a.period - b.period);
  if (payslips.length !== PASSPORT_PERIODS) {
    throw new PassportInputError(
      "wrong-period-count",
      `expected ${PASSPORT_PERIODS} payslips, got ${payslips.length}`,
    );
  }
  payslips.forEach((p, k) => {
    if (p.period !== payslips[0]!.period + k) {
      throw new PassportInputError("periods-not-consecutive", "payslips must be consecutive");
    }
    if (p.gross < threshold) {
      throw new PassportInputError("below-threshold", `period ${p.period} is below threshold`);
    }
  });

  const c = commitment(secret);
  const registry = registryTree(args.registryLeaves);
  const registryPaths = payslips.map((p) => {
    const leaf = payrollLeaf(c, employerId, BigInt(p.period), p.gross, p.salt);
    if (merkleRoot(leaf, p.runPath) !== p.runRoot) {
      throw new PassportInputError(
        "payslip-mismatch",
        `payslip ${p.period} does not match its run`,
      );
    }
    const index = registry.leaves.indexOf(registryLeaf(employerId, BigInt(p.period), p.runRoot));
    if (index < 0) {
      throw new PassportInputError("run-not-registered", `run ${p.period} is not registered`);
    }
    return registry.path(index);
  });

  const publicInputs: PassportPublicInputs = {
    registryRoot: registry.root,
    periods: payslips.map((p) => p.period),
    threshold,
    scope,
    nonce,
    pseudonym: pseudonym(secret, scope),
  };

  const hex = (xs: readonly bigint[]) => xs.map(fieldToHex);
  const inputs: PassportCircuitInputs = {
    registry_root: fieldToHex(publicInputs.registryRoot),
    periods: hex(payslips.map((p) => BigInt(p.period))),
    threshold: threshold.toString(),
    scope: fieldToHex(scope),
    nonce: fieldToHex(nonce),
    pseudonym_out: fieldToHex(publicInputs.pseudonym),
    passport_secret: fieldToHex(secret),
    employer_id: fieldToHex(employerId),
    gross: payslips.map((p) => toU64(p.gross).toString()),
    salts: hex(payslips.map((p) => p.salt)),
    run_roots: hex(payslips.map((p) => p.runRoot)),
    run_siblings: payslips.map((p) => hex(p.runPath.siblings)),
    run_is_right: payslips.map((p) => p.runPath.isRight),
    registry_siblings: registryPaths.map((p) => hex(p.siblings)),
    registry_is_right: registryPaths.map((p) => p.isRight),
  };
  return { inputs, publicInputs };
}

/** Public inputs as `bytes32[]`, in circuit order (the Solidity verifier's layout). */
export function encodePassportPublicInputs(p: PassportPublicInputs): `0x${string}`[] {
  return [p.registryRoot, ...p.periods.map(BigInt), p.threshold, p.scope, p.nonce, p.pseudonym].map(
    fieldToHex,
  );
}

/** Inverse of `encodePassportPublicInputs` (e.g. for bb.js `publicInputs`). */
export function decodePassportPublicInputs(fields: readonly string[]): PassportPublicInputs {
  if (fields.length !== PASSPORT_PUBLIC_INPUT_COUNT) {
    throw new Error(`expected ${PASSPORT_PUBLIC_INPUT_COUNT} public inputs, got ${fields.length}`);
  }
  const v = fields.map((f) => toField(f));
  const n = PASSPORT_PERIODS;
  return {
    registryRoot: v[0]!,
    periods: v.slice(1, 1 + n).map(Number),
    threshold: toU64(v[1 + n]!),
    scope: v[2 + n]!,
    nonce: v[3 + n]!,
    pseudonym: v[4 + n]!,
  };
}
