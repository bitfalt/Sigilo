import { describe, expect, test } from "vitest";

import { fieldToHex } from "./field";
import { commitment, payrollLeaf, pseudonym, registryLeaf } from "./hash";
import { runTree } from "./merkle";
import {
  buildPassportInputs,
  decodePassportPublicInputs,
  encodePassportPublicInputs,
  type PassportPayslip,
  PassportInputError,
} from "./passport";

// The tests.nr fixture again (see hash.test.ts): the registry root must match the pinned vector.
const secret = 0x1234567890abcdefn;
const employerId = 777n;
const periods = [24318, 24319, 24320];
const gross = [2400n, 2400n, 2500n];
const salts = [11n, 22n, 33n];

function fixture() {
  const c = commitment(secret);
  const payslips: PassportPayslip[] = periods.map((period, k) => {
    const run = runTree([
      payrollLeaf(42n, employerId, BigInt(period), 3000n, 99n),
      payrollLeaf(c, employerId, BigInt(period), gross[k]!, salts[k]!),
    ]);
    return { period, gross: gross[k]!, salt: salts[k]!, runRoot: run.root, runPath: run.path(1) };
  });
  const registryLeaves = payslips.map((p) => registryLeaf(employerId, BigInt(p.period), p.runRoot));
  return {
    passportSecret: secret,
    employerId,
    payslips,
    registryLeaves,
    threshold: 1500n,
    scope: 999n,
    nonce: 1n,
  };
}

const expectCode = (fn: () => unknown, code: PassportInputError["code"]) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PassportInputError);
    expect((e as PassportInputError).code).toBe(code);
    return;
  }
  throw new Error(`expected PassportInputError(${code})`);
};

describe("buildPassportInputs", () => {
  test("reproduces the circuit fixture's public inputs", () => {
    const { inputs, publicInputs } = buildPassportInputs(fixture());
    expect(fieldToHex(publicInputs.registryRoot)).toBe(
      "0x1071e5acd50fbcf685407efcde701f5eaa71f94d261d699e6d53a791bb2da967",
    );
    expect(publicInputs.pseudonym).toBe(pseudonym(secret, 999n));
    expect(publicInputs.periods).toEqual(periods);
    expect(inputs.registry_root).toBe(fieldToHex(publicInputs.registryRoot));
    expect(inputs.threshold).toBe("1500");
    expect(inputs.gross).toEqual(["2400", "2400", "2500"]);
    expect(inputs.run_siblings).toHaveLength(3);
    expect((inputs.registry_siblings as string[][])[0]).toHaveLength(16);
    expect((inputs.registry_is_right as boolean[][])[1]!.slice(0, 2)).toEqual([true, false]);
  });

  test("accepts payslips in any order and other employers' runs in the registry", () => {
    const f = fixture();
    const other = registryLeaf(555n, 24318n, 123n);
    const { publicInputs } = buildPassportInputs({
      ...f,
      payslips: [...f.payslips].reverse(),
      registryLeaves: [other, ...f.registryLeaves, other],
    });
    expect(publicInputs.periods).toEqual(periods);
  });

  test("rejects unusable payslips before proving", () => {
    const f = fixture();
    expectCode(() => buildPassportInputs({ ...f, nonce: 0n }), "zero-nonce");
    expectCode(() => buildPassportInputs({ ...f, threshold: 2450n }), "below-threshold");
    expectCode(
      () => buildPassportInputs({ ...f, payslips: f.payslips.slice(0, 2) }),
      "wrong-period-count",
    );
    expectCode(
      () =>
        buildPassportInputs({
          ...f,
          payslips: f.payslips.map((p, k) => (k === 2 ? { ...p, period: p.period + 1 } : p)),
        }),
      "periods-not-consecutive",
    );
    expectCode(
      () =>
        buildPassportInputs({
          ...f,
          payslips: f.payslips.map((p, k) => (k === 0 ? { ...p, gross: 9000n } : p)),
        }),
      "payslip-mismatch",
    );
    expectCode(
      () => buildPassportInputs({ ...f, registryLeaves: f.registryLeaves.slice(1) }),
      "run-not-registered",
    );
  });
});

describe("public input encoding", () => {
  test("round-trips through bytes32[] in circuit order", () => {
    const { publicInputs } = buildPassportInputs(fixture());
    const encoded = encodePassportPublicInputs(publicInputs);
    expect(encoded).toHaveLength(8);
    expect(encoded[0]).toBe(fieldToHex(publicInputs.registryRoot));
    expect(BigInt(encoded[4]!)).toBe(1500n);
    expect(decodePassportPublicInputs(encoded)).toEqual(publicInputs);
  });
});
