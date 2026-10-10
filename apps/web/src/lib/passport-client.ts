// Seal an Income Passport on this device (SPEC.md F5, F7): decrypt the payslips, pick the newest
// 3 consecutive months at or above the threshold from one employer, build the witness against
// every registry leaf, and prove in the browser. Shared by income checks and advances.

import {
  buildPassportInputs,
  encodePassportPublicInputs,
  PassportInputError,
} from "@sigilo/core/passport";
import { decryptReceipt, payslipToPassportPayslip, type Receipt } from "@sigilo/core/receipts";
import { isRecent, selectPassportPayslips } from "@sigilo/core/verify";

import type { WorkerKeys } from "./identity";
import { passkeyErrorMessage } from "./passkeys";
import { provePassport } from "./prover";
import { formatAmount } from "./wallet";

/** A reason the passport can't be sealed, worded for the worker. */
export class AnswerError extends Error {}

export interface SealedPassport {
  proof: `0x${string}`;
  publicInputs: `0x${string}`[];
  periods: number[];
  /** The employer whose payslips were proven (who would deduct an advance). */
  employerId: string;
  employerName: string;
}

export async function sealIncomePassport(args: {
  keys: WorkerKeys;
  passportSecret: bigint;
  stored: readonly { kind: string; ciphertext: string }[];
  registryLeaves: readonly string[];
  thresholdCents: number;
  months: number;
  scope: bigint;
  nonce: bigint;
  onSealing?: () => void;
}): Promise<SealedPassport> {
  const { keys, thresholdCents, months } = args;
  const candidates = args.stored.flatMap((row) => {
    if (row.kind !== "payslip") return [];
    let receipt: Receipt;
    try {
      receipt = decryptReceipt(row.ciphertext, keys.receiptKeys.secretKey);
    } catch {
      return [];
    }
    if (receipt.kind !== "payslip" || !receipt.commitment) return [];
    return [
      {
        employerId: receipt.employer.employerId,
        employerName: receipt.employer.name,
        payslip: payslipToPassportPayslip(receipt),
      },
    ];
  });
  const threshold = BigInt(thresholdCents);
  const picked = selectPassportPayslips(candidates, threshold);
  const amount = formatAmount(thresholdCents);
  if (!picked) {
    throw new AnswerError(
      `Your payslips don't show ${months} months in a row of at least ${amount}.`,
    );
  }
  const periods = picked.map((p) => p.payslip.period);
  if (!isRecent(periods[periods.length - 1]!)) {
    throw new AnswerError(
      `Your newest ${months} months of at least ${amount} are too old for this.`,
    );
  }
  const { inputs, publicInputs } = buildPassportInputs({
    passportSecret: args.passportSecret,
    employerId: BigInt(picked[0]!.employerId),
    payslips: picked.map((p) => p.payslip),
    registryLeaves: args.registryLeaves.map(BigInt),
    threshold,
    scope: args.scope,
    nonce: args.nonce,
  });
  args.onSealing?.();
  const { proof } = await provePassport(inputs);
  return {
    proof,
    publicInputs: encodePassportPublicInputs(publicInputs),
    periods,
    employerId: picked[0]!.employerId,
    employerName: picked[0]!.employerName,
  };
}

/** What to tell the worker when sealing or sending fails. */
export function passportErrorMessage(e: unknown): string {
  if (e instanceof AnswerError) return e.message;
  if (e instanceof PassportInputError) {
    return e.code === "run-not-registered"
      ? "Your latest payslip is still being filed. Try again in a minute."
      : "This passkey doesn't match the Income Passport on your payslips.";
  }
  return passkeyErrorMessage(e);
}
