// Payroll-deducted salary advance on the configured Convex deployment and Monad testnet:
//   pnpm dev   (other terminal: the lender's paid check runs in Next)
//   pnpm smoke:advance [http://localhost:3000]
// María is paid $20 for three months and passes Fondo Quincena's check (at least $15 a month).
// The lender offers $4.50 over 2 paychecks; she proves her income again for the AdvanceVault
// (nonce bound to her own fresh account), the operator relays requestAdvance, and she signs the
// deduction mandate. Two payroll runs (the real runPayroll) deduct and repay until it closes.

import {
  advanceNonce,
  buildPassportInputs,
  commitment,
  createOneTimeAccount,
  currentPeriod,
  decodePaymentProfile,
  decryptReceipt,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePassportPublicInputs,
  encodePaymentProfile,
  encryptReceipt,
  fieldToHex,
  mandateTypedData,
  paymentProfile,
  type PayslipReceipt,
  payslipToPassportPayslip,
  selectPassportPayslips,
  SIGILO_TESTNET,
  vaultScope,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import { parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createPassportProver, toHex as bytesToHex } from "../../../packages/circuits/js/prover";
import { api } from "../convex/_generated/api.js";
import { runPayroll } from "../src/lib/payroll-client";
import type { EmployerKeys } from "../src/lib/identity";
import {
  ausdBalance,
  chain,
  check,
  cloudUrl,
  randomPrf,
  signIn,
  verifiedEmployer,
} from "./lib/testnet.mjs";

const webUrl = process.argv[2] ?? "http://localhost:3000";
const GROSS = 2_000n; // $20 a month
const THRESHOLD = 1_500; // $15
const vaultAbi = parseAbi([
  "function advances(uint256) view returns (uint256 pseudonym, address recipient, uint96 principal, uint96 owed, uint96 repaid, uint40 issuedAt, bool active)",
]);

const employer = await verifiedEmployer("Acme Labs (advance smoke test)", GROSS * 6n * 10_000n);
const prf = randomPrf();
const keys = deriveAccountKeys(prf);
const payslipKeys = derivePayslipKeypair(prf);
const session = privateKeyToAccount(toHex(deriveEvmPrivateKey(prf)));
const maria = await signIn(session);
const profile = encodePaymentProfile(paymentProfile(keys.stealth));
await maria.mutation(api.accounts.register, {
  paymentProfile: profile,
  receiptPublicKey: toHex(payslipKeys.publicKey),
});
const invite = await employer.invite("María Solís", Number(GROSS));
await maria.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
const passportSecret = derivePassportSecret(randomPrf());
await maria.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(passportSecret)),
});

// The real payroll engine, as the employer console runs it.
const employerKeys = {
  account: employer.treasury,
  rosterKey: employer.rosterKey,
} as unknown as EmployerKeys;
async function payroll(period: number) {
  const roster = await employer.client.query(api.employees.list, {});
  const mandates = await employer.client.query(api.advances.forPayroll, {});
  await runPayroll({
    api: {
      start: (a) => employer.client.mutation(api.runs.start, a),
      submit: (a) => employer.client.mutation(api.runs.submit, a as never),
      abort: (a) => employer.client.mutation(api.runs.abort, a as never),
      recordRepayment: (a) => employer.client.mutation(api.advances.recordRepayment, a as never),
    },
    keys: employerKeys,
    employer: { name: employer.name, employerId: employer.employerId },
    period,
    roster,
    mandates,
  });
  for (let i = 0; i < 60; i++) {
    const run = (await employer.client.query(api.runs.list, {})).find((r) => r.period === period);
    if (run?.status === "done") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`run ${period} didn't finish`);
}

const now = currentPeriod();
for (const p of [now - 3, now - 2, now - 1]) await payroll(p);
check("María paid for 3 months", true);

async function payslipCandidates() {
  const inbox = await maria.query(api.receipts.mine, {});
  return inbox
    .filter((r) => r.kind === "payslip")
    .map((r) => decryptReceipt(r.ciphertext, payslipKeys.secretKey) as PayslipReceipt)
    .filter((r) => r.commitment)
    .map((r) => ({ employerId: r.employer.employerId, payslip: payslipToPassportPayslip(r) }));
}
const prover = await createPassportProver();
async function prove(scope: bigint, nonce: bigint) {
  const picked = selectPassportPayslips(await payslipCandidates(), BigInt(THRESHOLD))!;
  const { inputs, publicInputs } = buildPassportInputs({
    passportSecret,
    employerId: BigInt(picked[0]!.employerId),
    payslips: picked.map((p) => p.payslip),
    registryLeaves: (await maria.query(api.registry.leaves, {})).map(BigInt),
    threshold: BigInt(THRESHOLD),
    scope,
    nonce,
  });
  const proof = await prover.prove(inputs);
  return {
    proof: bytesToHex(proof.proof),
    publicInputs: encodePassportPublicInputs(publicInputs),
    employerId: picked[0]!.employerId,
  };
}

// ---------------------------------------------------------------- the lender's check
const anonymous = new ConvexHttpClient(cloudUrl);
const requestId = await anonymous.mutation(api.requests.create, { thresholdCents: THRESHOLD });
const request = (await anonymous.query(api.requests.get, { request: requestId }))!;
const answer = await prove(BigInt(request.scope), BigInt(request.nonce));
check(
  "check answered",
  (
    await maria.action(api.requests.submit, {
      request: requestId,
      proof: answer.proof,
      publicInputs: answer.publicInputs,
    })
  ).ok,
);
const verified = await fetch(`${webUrl}/api/lender/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestId }),
});
check("lender verified (paid $0.10 via MPP)", verified.ok);

// ---------------------------------------------------------------- offer and take
await anonymous.mutation(api.advances.offer, {
  request: requestId,
  amountCents: 450,
  installments: 2,
});
check(
  "lender offered $4.50 over 2 paychecks",
  !!(await anonymous.query(api.requests.get, { request: requestId }))?.offer,
);

const oneTime = createOneTimeAccount(decodePaymentProfile(profile));
const amount = 4_500_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
const forVault = await prove(
  vaultScope(SIGILO_TESTNET.advanceVault),
  advanceNonce(oneTime.address, amount, deadline, salt),
);
await prover.destroy();
const receipt = encryptReceipt(
  {
    v: 1,
    kind: "advance",
    from: "Fondo Quincena",
    token: "AUSD",
    pieces: [
      {
        account: oneTime.address,
        ephemeralPubKey: oneTime.ephemeralPubKey,
        amount: amount.toString(),
      },
    ],
    issuedAt: Date.now(),
  },
  payslipKeys.publicKey,
);
const started = Date.now();
const taken = await maria.action(api.advances.take, {
  request: requestId,
  proof: forVault.proof,
  publicInputs: forVault.publicInputs,
  amount: amount.toString(),
  recipient: oneTime.address,
  deadline: Number(deadline),
  salt,
  receipt,
});
check(
  "advance issued on-chain",
  BigInt(taken.owed) === 4_590_000n,
  `id ${taken.advanceId}, ${Date.now() - started} ms`,
);
check("her fresh account holds $4.50", (await ausdBalance(oneTime.address)) === amount);

const installment = 2_300_000n; // ceil($4.59 / 2) to the cent
const mandateDeadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
const signature = await session.signTypedData(
  mandateTypedData({
    vault: SIGILO_TESTNET.advanceVault,
    advanceId: BigInt(taken.advanceId),
    installment,
    installments: 2,
    deadline: mandateDeadline,
  }),
);
await maria.action(api.advances.authorize, {
  advance: taken.advance,
  employerId: forVault.employerId,
  installment: installment.toString(),
  installments: 2,
  deadline: Number(mandateDeadline),
  signature,
});
const mandates = await employer.client.query(api.advances.forPayroll, {});
check(
  "employer sees the deduction mandate",
  mandates.length === 1 && mandates[0]!.installmentCents === 230,
);

// ---------------------------------------------------------------- payroll repays it
const readAdvance = () =>
  chain.readContract({
    address: SIGILO_TESTNET.advanceVault,
    abi: vaultAbi,
    functionName: "advances",
    args: [BigInt(taken.advanceId)],
  });
await payroll(now);
let onchain = await readAdvance();
check("first payroll repaid $2.30", onchain[4] === 2_300_000n && onchain[6] === true);
const slip = (await maria.query(api.receipts.mine, {}))
  .map((r) => decryptReceipt(r.ciphertext, payslipKeys.secretKey))
  .find((r): r is PayslipReceipt => r.kind === "payslip" && r.period === now)!;
check(
  "her payslip shows the deduction",
  slip.deductions.length === 1 && slip.netCents === "1770",
  `${slip.deductions[0]?.label}: ${slip.deductions[0]?.amountCents}`,
);
await payroll(now + 1);
onchain = await readAdvance();
check("second payroll closed the advance", onchain[4] === 4_590_000n && onchain[6] === false);
const final = await anonymous.query(api.requests.get, { request: requestId });
check(
  "lender sees it fully repaid",
  final?.advance?.status === "closed" && final.advance.remainingCents === 0,
);
console.log("\nAll checks passed.");
