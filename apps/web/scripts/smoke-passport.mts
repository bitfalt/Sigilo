// End-to-end Income Passport on the configured Convex deployment and Monad testnet:
//   pnpm dev            (in another terminal: the lender route and the Verify API run in Next)
//   pnpm smoke:passport [http://localhost:3000]
// A fresh verified employer pays a fresh worker for the last three months (real AUSD payouts and
// published registry roots). The demo lender opens a request, the worker proves "at least $15 a
// month" with the Noir circuit, Convex checks it on-chain, and the lender pays the Sigilo Verify
// API $0.10 through MPP and files the signed attestation. Spends a few testnet dollars.

import { execFileSync } from "node:child_process";

import {
  AGORA_TESTNET,
  buildPassportInputs,
  commitment,
  currentPeriod,
  decryptReceipt,
  DEMO_LENDER,
  deriveAccountKeys,
  deriveEmployerKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePassportPublicInputs,
  encodePaymentProfile,
  encryptRosterEntry,
  fieldToHex,
  newInviteCode,
  paymentProfile,
  type PayslipReceipt,
  payslipToPassportPayslip,
  preparePayrollRun,
  randomField,
  selectPassportPayslips,
  SIGILO_TESTNET,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
  parseEther,
  type PrivateKeyAccount,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { createPassportProver, toHex as bytesToHex } from "../../../packages/circuits/js/prover.ts";
import { api } from "../convex/_generated/api.js";

const webUrl = process.argv[2] ?? "http://localhost:3000";
const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;
const faucetKey = process.env.TREASURY_PRIVATE_KEY as Hex | undefined;
if (!cloudUrl || !siteUrl || !faucetKey) throw new Error("missing env (Convex URLs, TREASURY key)");

const GROSS_CENTS = 2_000n; // $20 a month
const THRESHOLD_CENTS = 1_500; // asks for at least $15 a month
const VERIFY_FEE = 100_000n; // $0.10 in AUSD base units

const erc20 = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const payAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

const transport = http(monadTestnet.rpcUrls.default.http[0]);
const chain = createPublicClient({ chain: monadTestnet, transport });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();

function check(label: string, ok: boolean, detail = "") {
  const t = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "PASS" : "FAIL"} [${t}s] ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) throw new Error(`failed: ${label}`);
}

// Monad: accounts under 10 MON may send one transaction per ~3 blocks; retry the transient refusals.
const transient = (e: unknown) => /insufficient balance|reserve|rate|nonce/i.test(String(e));
async function send(account: PrivateKeyAccount, req: Record<string, unknown>): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  for (let attempt = 0; ; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gas = await chain.estimateContractGas({ ...(req as any), account });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await wallet.writeContract({ ...(req as any), gas: (gas * 115n) / 100n });
      const receipt = await chain.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
      await sleep(1_500);
      return hash;
    } catch (e) {
      if (attempt >= 8 || !transient(e)) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
}

async function signIn(account: PrivateKeyAccount): Promise<ConvexHttpClient> {
  const post = (path: string, body: unknown) =>
    fetch(`${siteUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const { nonce, message } = await post("/auth/challenge", { address: account.address });
  const signature = await account.signMessage({ message });
  const { token } = await post("/auth/session", { address: account.address, nonce, signature });
  const client = new ConvexHttpClient(cloudUrl);
  client.setAuth(token);
  return client;
}

const randomPrf = () => crypto.getRandomValues(new Uint8Array(32));
const ausdBalance = (address: Hex) =>
  chain.readContract({
    address: AGORA_TESTNET.ausd,
    abi: erc20,
    functionName: "balanceOf",
    args: [address],
  });

// ---------------------------------------------------------------- verified employer + worker
const employerKeys = deriveEmployerKeys(randomPrf());
const treasury = privateKeyToAccount(toHex(employerKeys.treasuryKey));
const employer = await signIn(treasury);
const employerId = fieldToHex(randomField());
const employerName = "Acme Labs (passport smoke test)";
const employerDoc = await employer.mutation(api.employers.register, {
  name: employerName,
  employerId,
});
execFileSync(
  "npx",
  ["convex", "run", "employers:verify", JSON.stringify({ employer: employerDoc })],
  {
    stdio: ["ignore", "ignore", "ignore"],
  },
);
check("employer registered and verified", true);

const workerPrf = randomPrf();
const workerKeys = deriveAccountKeys(workerPrf);
const payslipKeys = derivePayslipKeypair(workerPrf);
const worker = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(workerPrf))));
await worker.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(workerKeys.stealth)),
  receiptPublicKey: toHex(payslipKeys.publicKey),
});
const invite = newInviteCode();
const employeeId = await employer.mutation(api.employees.add, {
  roster: encryptRosterEntry(
    { name: "María Solís", monthlySalaryCents: Number(GROSS_CENTS) },
    employerKeys.rosterKey,
    employerId,
  ),
  inviteCodeHash: invite.hash,
});
await worker.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
const passportSecret = derivePassportSecret(randomPrf());
await worker.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(passportSecret)),
});
const row = (await employer.query(api.employees.list, {}))[0]!;
check("worker joined with an Income Passport", !!row.account && !!row.passportCommitment);

// ---------------------------------------------------------------- fund the treasury
const faucet = privateKeyToAccount(faucetKey);
const faucetWallet = createWalletClient({ account: faucet, chain: monadTestnet, transport });
await sleep(1_500);
const monTx = await faucetWallet.sendTransaction({
  to: treasury.address,
  value: parseEther("0.5"),
  gas: 21_000n,
});
check(
  "treasury received MON for fees",
  (await chain.waitForTransactionReceipt({ hash: monTx })).status === "success",
);
await sleep(1_500);
const fund = GROSS_CENTS * 3n * 10_000n;
await send(faucet, {
  address: AGORA_TESTNET.ausd,
  abi: erc20,
  functionName: "transfer",
  args: [treasury.address, fund],
});
await send(treasury, {
  address: AGORA_TESTNET.ausd,
  abi: erc20,
  functionName: "approve",
  args: [SIGILO_TESTNET.sigiloPay, fund],
});
check("treasury funded", (await ausdBalance(treasury.address)) === fund);

// ---------------------------------------------------------------- three months of payroll
const now = currentPeriod();
for (const period of [now - 3, now - 2, now - 1]) {
  const runId = await employer.mutation(api.runs.start, { period });
  const run = preparePayrollRun({
    employer: { name: employerName, employerId: BigInt(employerId) },
    period,
    employees: [
      {
        key: row._id,
        grossCents: GROSS_CENTS,
        deductions: [],
        paymentProfile: row.account!.paymentProfile,
        receiptPublicKey: row.account!.receiptPublicKey,
        passportCommitment: row.passportCommitment!,
      },
    ],
  });
  const payoutTx = await send(treasury, {
    address: SIGILO_TESTNET.sigiloPay,
    abi: payAbi,
    functionName: "disperse",
    args: [run.payout.to, run.payout.amounts],
  });
  await employer.mutation(api.runs.submit, {
    run: runId,
    payoutTxHash: payoutTx,
    totalAusd: run.totalAusd.toString(),
    pieceCount: run.pieceCount,
    runRoot: fieldToHex(run.runRoot!),
    receipts: run
      .finalize(payoutTx)
      .map((r) => ({ employee: employeeId, ciphertext: r.ciphertext })),
  });
  let status = "";
  for (let i = 0; i < 60 && status !== "done" && status !== "failed"; i++) {
    await sleep(1_500);
    status = (await employer.query(api.runs.list, {})).find((r) => r._id === runId)!.status;
  }
  check(`payroll for period ${period} paid and registered`, status === "done");
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
const body = (await res.json()) as {
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
console.log(`\nAll checks passed in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
