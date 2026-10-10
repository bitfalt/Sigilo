// Payroll run builder (SPEC.md F3). Runs in the employer's browser, so the server never sees
// salaries or which one-time accounts belong to whom.
//
//   const run = preparePayrollRun({ ... });   // pieces, payout, run tree
//   // approve run.totalAusd to SigiloPay, then SigiloPay.disperse(run.payout.to, run.payout.amounts)
//   const receipts = run.finalize(payoutTxHash); // one encrypted payslip per employee
//   // upload receipts + run.runRoot; the operator appends the registry leaf and publishes the root

import { hexToBytes } from "@noble/hashes/utils.js";
import type { Address, Hex } from "viem";

import { RUN_TREE_DEPTH } from "./constants";
import { fieldToHex, randomField, toField } from "./field";
import { payrollLeaf } from "./hash";
import { runTree } from "./merkle";
import { centsToAusd, shuffled, splitIntoPieces } from "./pieces";
import { encryptReceipt, type PayslipReceipt, type ReceiptPiece } from "./receipts";
import { createOneTimeAccount, decodePaymentProfile } from "./stealth";

/** Pieces in one `disperse` call; keeps the payout well under Monad's 30M per-tx gas limit. */
export const MAX_PIECES_PER_PAYOUT = 400;

export interface PayrollEmployee {
  /** Caller's id for this employee (e.g. the Convex row id); echoed back with the receipt. */
  key: string;
  grossCents: bigint;
  deductions: { label: string; amountCents: bigint }[];
  /** 66-byte hex payment profile (core/stealth.ts). */
  paymentProfile: string;
  /** X25519 public key (hex) the payslip is encrypted to. */
  receiptPublicKey: string;
  /** C = H(passportSecret); without it the period can't be proven later. */
  passportCommitment?: string;
}

export interface PreparedPayrollRun {
  /** Every piece of every employee, shuffled together. AUSD base units. */
  payout: { to: Address[]; amounts: bigint[] };
  totalAusd: bigint;
  pieceCount: number;
  /** Root of this run's tree, or null when no employee has a passport commitment yet. */
  runRoot: bigint | null;
  /** Encrypt one payslip per employee once the payout is confirmed. */
  finalize(payoutTxHash: Hex, issuedAt?: number): { key: string; ciphertext: string }[];
}

export function preparePayrollRun(args: {
  employer: { name: string; employerId: bigint };
  /** Month index (core/period.ts). */
  period: number;
  employees: readonly PayrollEmployee[];
}): PreparedPayrollRun {
  const { employer, period } = args;
  const employerId = toField(employer.employerId);
  if (args.employees.length === 0) throw new Error("no employees to pay");

  const plans = args.employees.map((e) => {
    const deducted = e.deductions.reduce((sum, d) => sum + d.amountCents, 0n);
    const netCents = e.grossCents - deducted;
    if (netCents < 0n) throw new RangeError(`deductions exceed gross pay for ${e.key}`);
    const profile = decodePaymentProfile(e.paymentProfile);
    const pieces: ReceiptPiece[] = splitIntoPieces(netCents).map((cents) => {
      const account = createOneTimeAccount(profile);
      return {
        account: account.address,
        ephemeralPubKey: account.ephemeralPubKey,
        amount: centsToAusd(cents).toString(),
      };
    });
    const commitment = e.passportCommitment ? toField(e.passportCommitment) : undefined;
    const salt = randomField();
    const leaf =
      commitment === undefined
        ? undefined
        : payrollLeaf(commitment, employerId, BigInt(period), e.grossCents, salt);
    return { employee: e, netCents, pieces, salt, leaf };
  });

  const allPieces = shuffled(plans.flatMap((p) => p.pieces));
  if (allPieces.length > MAX_PIECES_PER_PAYOUT) {
    throw new RangeError(`${allPieces.length} pieces exceed one payout`);
  }

  // Leaf order is shuffled too; the tree itself stays private (only its root is published).
  const withLeaves = shuffled(plans.filter((p) => p.leaf !== undefined));
  if (withLeaves.length > 2 ** RUN_TREE_DEPTH) throw new RangeError("too many employees");
  const tree = withLeaves.length > 0 ? runTree(withLeaves.map((p) => p.leaf!)) : null;

  return {
    payout: {
      to: allPieces.map((p) => p.account),
      amounts: allPieces.map((p) => BigInt(p.amount)),
    },
    totalAusd: allPieces.reduce((sum, p) => sum + BigInt(p.amount), 0n),
    pieceCount: allPieces.length,
    runRoot: tree?.root ?? null,
    finalize(payoutTxHash, issuedAt = Date.now()) {
      return plans.map((plan) => {
        const index = withLeaves.indexOf(plan);
        const path = tree && index >= 0 ? tree.path(index) : undefined;
        const receipt: PayslipReceipt = {
          v: 1,
          kind: "payslip",
          employer: { name: employer.name, employerId: fieldToHex(employerId) },
          period,
          grossCents: plan.employee.grossCents.toString(),
          deductions: plan.employee.deductions.map((d) => ({
            label: d.label,
            amountCents: d.amountCents.toString(),
          })),
          netCents: plan.netCents.toString(),
          token: "AUSD",
          pieces: plan.pieces,
          payoutTxHash,
          ...(tree && path
            ? {
                commitment: {
                  salt: fieldToHex(plan.salt),
                  runRoot: fieldToHex(tree.root),
                  runPath: { siblings: path.siblings.map(fieldToHex), isRight: path.isRight },
                },
              }
            : {}),
          issuedAt,
        };
        return {
          key: plan.employee.key,
          ciphertext: encryptReceipt(
            receipt,
            hexToBytes(plan.employee.receiptPublicKey.replace(/^0x/, "")),
          ),
        };
      });
    },
  };
}
