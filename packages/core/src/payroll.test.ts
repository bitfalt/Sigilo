import { bytesToHex } from "@noble/hashes/utils.js";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, test } from "vitest";

import { fieldToHex } from "./field";
import { commitment, payrollLeaf } from "./hash";
import {
  deriveAccountKeys,
  deriveEmployerKeys,
  derivePassportSecret,
  derivePayslipKeypair,
  SALT_EMPLOYER,
} from "./keys";
import { merkleRoot } from "./merkle";
import { buildPassportInputs } from "./passport";
import { type PayrollEmployee, preparePayrollRun } from "./payroll";
import { decryptReceipt, type PayslipReceipt, payslipToPassportPayslip } from "./receipts";
import { registryLeaf } from "./hash";
import {
  decryptRosterEntry,
  encryptRosterEntry,
  hashInviteCode,
  newInviteCode,
  RosterDecryptionError,
} from "./roster";
import { encodePaymentProfile, oneTimeAccountKey, paymentProfile } from "./stealth";

const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("employer namespace", () => {
  test("salt and keys are pinned", () => {
    // sha256("sigilo/employer/v1"), cross-checked with `shasum -a 256`.
    expect(bytesToHex(SALT_EMPLOYER)).toBe(
      "40f3c9eb9479f8239944d8f4e8a033c8acadf4320283aab94a432a5f78806e50",
    );
    const keys = deriveEmployerKeys(PRF);
    expect(bytesToHex(keys.treasuryKey)).toBe(
      "ead8c4d1c746c1a3ea99944fa70fb779d6e8c03fd90e1b833321d283e5a90f09",
    );
    expect(privateKeyToAddress(`0x${bytesToHex(keys.treasuryKey)}`)).toBe(
      "0x7332f58B012648d8c69B33c3AD3D58D71e0be5E7",
    );
    expect(bytesToHex(keys.rosterKey)).toBe(
      "4fb8c9aff9a72e3f9f9ad097156cec7667cba44df1df59b65831bef77097fb85",
    );
  });
});

describe("roster", () => {
  const { rosterKey } = deriveEmployerKeys(PRF);
  const entry = { name: "María Solís", monthlySalaryCents: 240_000 };

  test("round-trips and is bound to the employer", () => {
    const envelope = encryptRosterEntry(entry, rosterKey, "0xAC3E1AB");
    expect(decryptRosterEntry(envelope, rosterKey, "0xac3e1ab")).toEqual(entry);
    expect(() => decryptRosterEntry(envelope, rosterKey, "0xbee5")).toThrow(RosterDecryptionError);
    const otherKey = deriveEmployerKeys(PRF.map((b) => b ^ 1)).rosterKey;
    expect(() => decryptRosterEntry(envelope, otherKey, "0xac3e1ab")).toThrow(
      RosterDecryptionError,
    );
  });

  test("rejects non-integer salaries", () => {
    expect(() =>
      encryptRosterEntry({ name: "x", monthlySalaryCents: 1.5 }, rosterKey, "0x1"),
    ).toThrow(RangeError);
  });

  test("invite codes are random and only their hash is stored", () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a.code).not.toBe(b.code);
    expect(a.hash).toBe(hashInviteCode(a.code));
    expect(a.hash).not.toContain(a.code);
    expect(hashInviteCode("demo")).toBe(hashInviteCode("demo"));
  });
});

describe("payroll run", () => {
  // Three workers, each with their own passkey (fake PRFs).
  const workers = [1, 2, 3].map((n) => {
    const prf = PRF.map((b) => b ^ n);
    const account = deriveAccountKeys(prf);
    const passportSecret = derivePassportSecret(prf.map((b) => b ^ 0x80));
    return { prf, account, passportSecret, payslip: derivePayslipKeypair(prf) };
  });
  const employees: PayrollEmployee[] = workers.map((w, i) => ({
    key: `employee-${i}`,
    grossCents: [240_000n, 310_000n, 185_050n][i]!,
    deductions: i === 0 ? [{ label: "Advance installment", amountCents: 22_950n }] : [],
    paymentProfile: encodePaymentProfile(paymentProfile(w.account.stealth)),
    receiptPublicKey: `0x${bytesToHex(w.payslip.publicKey)}`,
    // The third worker hasn't activated their passport yet.
    ...(i < 2 ? { passportCommitment: fieldToHex(commitment(w.passportSecret)) } : {}),
  }));
  const employerId = 0xac3e1abn;
  const period = 24321; // Oct 2026

  const run = preparePayrollRun({
    employer: { name: "Acme Labs", employerId },
    period,
    employees,
  });
  const receipts = run.finalize(`0x${"ef".repeat(32)}`, 1_760_000_000_000);
  const decrypted = receipts.map(
    (r, i) => decryptReceipt(r.ciphertext, workers[i]!.payslip.secretKey) as PayslipReceipt,
  );

  test("pays every net salary in fixed pieces", () => {
    const netCents = 240_000n - 22_950n + 310_000n + 185_050n;
    expect(run.totalAusd).toBe(netCents * 10_000n);
    expect(run.payout.to).toHaveLength(run.pieceCount);
    expect(run.payout.amounts.reduce((a, b) => a + b, 0n)).toBe(run.totalAusd);
    expect(new Set(run.payout.to).size).toBe(run.pieceCount);
    expect(decrypted.map((r) => r.netCents)).toEqual(["217050", "310000", "185050"]);
  });

  test("each worker can open only their own payslip", () => {
    expect(() => decryptReceipt(receipts[0]!.ciphertext, workers[1]!.payslip.secretKey)).toThrow();
    expect(receipts.map((r) => r.key)).toEqual(["employee-0", "employee-1", "employee-2"]);
  });

  test("every piece belongs to its worker and sits in the payout", () => {
    decrypted.forEach((receipt, i) => {
      for (const piece of receipt.pieces) {
        const owned = oneTimeAccountKey(workers[i]!.account.stealth, piece.ephemeralPubKey);
        expect(owned.address).toBe(piece.account);
        const at = run.payout.to.indexOf(piece.account);
        expect(run.payout.amounts[at]).toBe(BigInt(piece.amount));
      }
      // Another worker's keys never match.
      const other = workers[(i + 1) % 3]!.account.stealth;
      expect(oneTimeAccountKey(other, receipt.pieces[0]!.ephemeralPubKey).address).not.toBe(
        receipt.pieces[0]!.account,
      );
    });
  });

  test("payslips commit to the run root; no commitment without a passport", () => {
    expect(run.runRoot).not.toBeNull();
    decrypted.slice(0, 2).forEach((receipt, i) => {
      const c = receipt.commitment!;
      expect(c.runRoot).toBe(fieldToHex(run.runRoot!));
      const leaf = payrollLeaf(
        commitment(workers[i]!.passportSecret),
        employerId,
        BigInt(period),
        BigInt(receipt.grossCents),
        BigInt(c.salt),
      );
      expect(
        merkleRoot(leaf, { siblings: c.runPath.siblings.map(BigInt), isRight: c.runPath.isRight }),
      ).toBe(run.runRoot);
    });
    expect(decrypted[2]!.commitment).toBeUndefined();
  });

  test("a payslip from a real run feeds the Income Passport", () => {
    // Three consecutive runs for worker 0, each registered in the global tree.
    const months = [period - 2, period - 1, period].map((p) => {
      const r = preparePayrollRun({
        employer: { name: "Acme Labs", employerId },
        period: p,
        employees,
      });
      const [mine] = r.finalize(`0x${"01".repeat(32)}`);
      return {
        root: r.runRoot!,
        payslip: decryptReceipt(mine!.ciphertext, workers[0]!.payslip.secretKey) as PayslipReceipt,
      };
    });
    const { publicInputs } = buildPassportInputs({
      passportSecret: workers[0]!.passportSecret,
      employerId,
      payslips: months.map((m) => payslipToPassportPayslip(m.payslip)),
      registryLeaves: months.map((m, k) =>
        registryLeaf(employerId, BigInt(period - 2 + k), m.root),
      ),
      threshold: 150_000n,
      scope: 999n,
      nonce: 7n,
    });
    expect(publicInputs.periods).toEqual([period - 2, period - 1, period]);
  });

  test("rejects impossible runs", () => {
    expect(() =>
      preparePayrollRun({ employer: { name: "A", employerId }, period, employees: [] }),
    ).toThrow();
    expect(() =>
      preparePayrollRun({
        employer: { name: "A", employerId },
        period,
        employees: [{ ...employees[0]!, deductions: [{ label: "x", amountCents: 999_999n }] }],
      }),
    ).toThrow(RangeError);
  });
});
