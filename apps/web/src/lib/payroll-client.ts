// Run payroll in the employer's browser (SPEC.md F3, blind server): decrypt the roster, build the
// fixed-piece payout and run tree, pay from the passkey-derived treasury, then hand the server only
// the payout hash, run root and encrypted payslips.

import { AGORA_TESTNET } from "@sigilo/core/constants";
import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { fieldToHex } from "@sigilo/core/field";
import { type PayrollEmployee, preparePayrollRun } from "@sigilo/core/payroll";
import { decryptRosterEntry } from "@sigilo/core/roster";
import { erc20Abi, parseAbi } from "viem";

import { writeContract } from "./chain";
import type { EmployerKeys } from "./identity";

const sigiloPayAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

export interface RosterRow {
  _id: string;
  roster: string;
  status: "invited" | "active";
  passportCommitment: string | null;
  account: { paymentProfile: string; receiptPublicKey: string } | null;
}

export type PayrollStep = "preparing" | "approving" | "paying" | "recording" | "done";

export interface PayrollApi {
  start(args: { period: number }): Promise<string>;
  submit(args: {
    run: string;
    payoutTxHash: string;
    totalAusd: string;
    pieceCount: number;
    runRoot: string | null;
    receipts: { employee: string; ciphertext: string }[];
  }): Promise<null>;
  abort(args: { run: string; error: string }): Promise<null>;
}

export async function runPayroll(args: {
  api: PayrollApi;
  keys: EmployerKeys;
  employer: { name: string; employerId: string };
  period: number;
  roster: readonly RosterRow[];
  onStep?: (step: PayrollStep) => void;
}): Promise<{ payoutTxHash: string; pieceCount: number }> {
  const { api, keys, employer, period, onStep } = args;
  const employees: PayrollEmployee[] = args.roster
    .filter((row) => row.status === "active" && row.account)
    .map((row) => {
      const entry = decryptRosterEntry(row.roster, keys.rosterKey, employer.employerId);
      return {
        key: row._id,
        grossCents: BigInt(entry.monthlySalaryCents),
        deductions: [],
        paymentProfile: row.account!.paymentProfile,
        receiptPublicKey: row.account!.receiptPublicKey,
        ...(row.passportCommitment ? { passportCommitment: row.passportCommitment } : {}),
      };
    });
  if (employees.length === 0) throw new Error("Nobody has joined yet. Share an invite first.");

  onStep?.("preparing");
  const run = preparePayrollRun({
    employer: { name: employer.name, employerId: BigInt(employer.employerId) },
    period,
    employees,
  });
  const runId = await api.start({ period });

  let payoutTxHash: string;
  try {
    onStep?.("approving");
    await writeContract(keys.account, {
      address: AGORA_TESTNET.ausd,
      abi: erc20Abi,
      functionName: "approve",
      args: [SIGILO_TESTNET.sigiloPay, run.totalAusd],
    });
    onStep?.("paying");
    payoutTxHash = await writeContract(keys.account, {
      address: SIGILO_TESTNET.sigiloPay,
      abi: sigiloPayAbi,
      functionName: "disperse",
      args: [run.payout.to, run.payout.amounts],
    });
  } catch (error) {
    await api.abort({ run: runId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  onStep?.("recording");
  await api.submit({
    run: runId,
    payoutTxHash,
    totalAusd: run.totalAusd.toString(),
    pieceCount: run.pieceCount,
    runRoot: run.runRoot === null ? null : fieldToHex(run.runRoot),
    receipts: run
      .finalize(payoutTxHash as `0x${string}`)
      .map((r) => ({ employee: r.key, ciphertext: r.ciphertext })),
  });
  onStep?.("done");
  return { payoutTxHash, pieceCount: run.pieceCount };
}
