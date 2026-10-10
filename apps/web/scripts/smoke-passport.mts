// End-to-end Income Passport on the configured Convex deployment and Monad testnet:
//   pnpm dev            (in another terminal: the lender route and the Verify API run in Next)
//   pnpm smoke:passport [http://localhost:3000]
// A fresh verified employer pays a fresh worker for the last three months (real AUSD payouts and
// published registry roots). The demo lender opens a request, the worker proves "at least $15 a
// month" with the Noir circuit, Convex checks it on-chain, and the lender pays the Sigilo Verify
// API $0.10 through MPP and files the signed attestation. Spends a few testnet dollars.

import {
  buildPassportInputs,
  commitment,
  currentPeriod,
  decryptReceipt,
  DEMO_LENDER,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePassportPublicInputs,
  encodePaymentProfile,
  fieldToHex,
  paymentProfile,
  type PayslipReceipt,
  payslipToPassportPayslip,
  selectPassportPayslips,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createPassportProver, toHex as bytesToHex } from "../../../packages/circuits/js/prover";
import { api } from "../convex/_generated/api.js";
import {
  ausdBalance,
  check,
  cloudUrl,
  randomPrf,
  signIn,
  sleep,
  verifiedEmployer,
} from "./lib/testnet.mjs";

const webUrl = process.argv[2] ?? "http://localhost:3000";
const GROSS_CENTS = 2_000n; // $20 a month
const THRESHOLD_CENTS = 1_500; // asks for at least $15 a month
const VERIFY_FEE = 100_000n; // $0.10 in AUSD base units

// ---------------------------------------------------------------- employer + worker
const employer = await verifiedEmployer(
  "Acme Labs (passport smoke test)",
  GROSS_CENTS * 3n * 10_000n,
);
check("employer registered, verified and funded", true);

const workerPrf = randomPrf();
const workerKeys = deriveAccountKeys(workerPrf);
const payslipKeys = derivePayslipKeypair(workerPrf);
const worker = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(workerPrf))));
await worker.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(workerKeys.stealth)),
  receiptPublicKey: toHex(payslipKeys.publicKey),
});
const invite = await employer.invite("María Solís", Number(GROSS_CENTS));
await worker.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
const passportSecret = derivePassportSecret(randomPrf());
await worker.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(passportSecret)),
});
check("worker joined with an Income Passport", true);

// ---------------------------------------------------------------- three months of payroll
const now = currentPeriod();
for (const period of [now - 3, now - 2, now - 1]) {
  check(
    `payroll for ${period} paid and registered`,
    (await employer.pay(period, GROSS_CENTS)) === "done",
  );
}

// ---------------------------------------------------------------- lender asks
const anonymous = new ConvexHttpClient(cloudUrl);
const requestId = await anonymous.mutation(api.requests.create, {
  thresholdCents: THRESHOLD_CENTS,
});
const request = (await anonymous.query(api.requests.get, { request: requestId }))!;
check(
  "lender opened a request",
  request.status === "open" && request.lenderName === DEMO_LENDER.name,
  requestId,
);

// ---------------------------------------------------------------- worker proves
const inbox = await worker.query(api.receipts.mine, {});
const candidates = inbox
  .filter((r) => r.kind === "payslip")
  .map((r) => decryptReceipt(r.ciphertext, payslipKeys.secretKey) as PayslipReceipt)
  .map((r) => ({ employerId: r.employer.employerId, payslip: payslipToPassportPayslip(r) }));
const picked = selectPassportPayslips(candidates, BigInt(THRESHOLD_CENTS));
check("worker found 3 qualifying months", picked?.length === 3);

const { inputs, publicInputs } = buildPassportInputs({
  passportSecret,
  employerId: BigInt(picked![0]!.employerId),
  payslips: picked!.map((p) => p.payslip),
  registryLeaves: (await worker.query(api.registry.leaves, {})).map(BigInt),
  threshold: BigInt(THRESHOLD_CENTS),
  scope: BigInt(request.scope),
  nonce: BigInt(request.nonce),
});
const prover = await createPassportProver();
const proving = Date.now();
const proof = await prover.prove(inputs);
await prover.destroy();
const encoded = encodePassportPublicInputs(publicInputs);
check(
  "Income Passport proven",
  proof.publicInputs.every((x, i) => BigInt(x) === BigInt(encoded[i]!)),
  `${Date.now() - proving} ms`,
);

const submitted = await worker.action(api.requests.submit, {
  request: requestId,
  proof: bytesToHex(proof.proof),
  publicInputs: encoded,
});
check("Convex checked it on-chain and accepted it", submitted.ok, JSON.stringify(submitted));

// ---------------------------------------------------------------- lender pays to verify
const lenderBefore = await ausdBalance(DEMO_LENDER.address);
const res = await fetch(`${webUrl}/api/lender/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestId }),
});
const body = (await res.json().catch(() => ({}))) as {
  attestation?: { valid: boolean };
  paymentReference?: string;
  error?: string;
};
check("lender paid the Verify API via MPP", res.ok, body.paymentReference ?? body.error ?? "");
check("attestation says valid", body.attestation?.valid === true);
const final = (await anonymous.query(api.requests.get, { request: requestId }))!;
check(
  "request shows verified with a payment reference",
  final.status === "verified" && final.result?.valid === true && !!final.result.paymentReference,
);
await sleep(2_000);
check(
  "lender spent exactly $0.10",
  lenderBefore - (await ausdBalance(DEMO_LENDER.address)) === VERIFY_FEE,
);
console.log("\nAll checks passed.");
