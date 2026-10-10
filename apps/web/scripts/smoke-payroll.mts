// End-to-end payroll on the configured Convex deployment and Monad testnet:
//   pnpm smoke:payroll
// A fresh test employer and worker (random fake passkey outputs) go through registration,
// operator verification, an encrypted roster entry, invite acceptance, passport activation,
// a real AUSD payout through SigiloPay, registry publication, and the worker reading their pay.
// The TREASURY key acts as the demo faucet for the test employer. Spends a few testnet dollars.

import { execFileSync } from "node:child_process";

import {
  AGORA_TESTNET,
  commitment,
  decryptReceipt,
  deriveAccountKeys,
  deriveEmployerKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePaymentProfile,
  encryptRosterEntry,
  fieldToHex,
  newInviteCode,
  oneTimeAccountKey,
  paymentProfile,
  type PayslipReceipt,
  periodIndex,
  preparePayrollRun,
  randomField,
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

import { api } from "../convex/_generated/api.js";

const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;
const faucetKey = process.env.TREASURY_PRIVATE_KEY as Hex | undefined;
if (!cloudUrl || !siteUrl || !faucetKey) throw new Error("missing env (Convex URLs, TREASURY key)");

const erc20 = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const registryAbi = parseAbi(["function isKnownRoot(bytes32 root) view returns (bool)"]);
const payAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

const transport = http(monadTestnet.rpcUrls.default.http[0]);
const chain = createPublicClient({ chain: monadTestnet, transport });

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) throw new Error(`failed: ${label}`);
}

/**
 * Monad: consensus sees balances a few blocks late, and accounts under 10 MON may send one
 * transaction per ~3 blocks, so a fresh or low-balance sender can be refused for ~1-2 s.
 */
const transient = (e: unknown) => /insufficient balance|reserve|rate|nonce/i.test(String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Accounts under 10 MON may send one transaction per 3 blocks (~1.2 s). */
const LOW_BALANCE_SPACING_MS = 1_500;

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
      await sleep(LOW_BALANCE_SPACING_MS);
      return hash;
    } catch (e) {
      if (attempt >= 8 || !transient(e)) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
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

// ---------------------------------------------------------------- employer signs in
const employerKeys = deriveEmployerKeys(randomPrf());
const treasury = privateKeyToAccount(toHex(employerKeys.treasuryKey));
const employer = await signIn(treasury);
const employerId = fieldToHex(randomField());
const employerDoc = await employer.mutation(api.employers.register, {
  name: "Acme Labs (smoke test)",
  employerId,
});
check("employer registered", typeof employerDoc === "string");

const verifyTx = JSON.parse(
  execFileSync(
    "npx",
    ["convex", "run", "employers:verify", JSON.stringify({ employer: employerDoc })],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ),
) as string;
check("operator verified the employer on-chain", /^0x[0-9a-f]{64}$/.test(verifyTx), verifyTx);

// ---------------------------------------------------------------- worker signs in
const workerPrf = randomPrf();
const workerKeys = deriveAccountKeys(workerPrf);
const workerSession = privateKeyToAccount(toHex(deriveEvmPrivateKey(workerPrf)));
const payslipKeys = derivePayslipKeypair(workerPrf);
const worker = await signIn(workerSession);
await worker.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(workerKeys.stealth)),
  receiptPublicKey: toHex(payslipKeys.publicKey),
});
check("worker account registered", (await worker.query(api.accounts.me, {})) !== null);

// ---------------------------------------------------------------- roster + invite
const invite = newInviteCode();
const employeeId = await employer.mutation(api.employees.add, {
  roster: encryptRosterEntry(
    { name: "María Solís", monthlySalaryCents: 1_234 },
    employerKeys.rosterKey,
    employerId,
  ),
  inviteCodeHash: invite.hash,
});
const info = await worker.query(api.employees.inviteInfo, { inviteCodeHash: invite.hash });
check(
  "invite shows the employer only",
  info?.employerName === "Acme Labs (smoke test)" && info.open,
);
await worker.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
const passportSecret = derivePassportSecret(randomPrf());
await worker.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(passportSecret)),
});
const roster = await employer.query(api.employees.list, {});
check(
  "employer sees an active, onboarded employee with a passport",
  roster.length === 1 &&
    roster[0]!.status === "active" &&
    !!roster[0]!.account &&
    !!roster[0]!.passportCommitment,
);

// ---------------------------------------------------------------- demo faucet funds the treasury
const faucet = privateKeyToAccount(faucetKey);
const fundAusd = 20_000_000n; // $20
// MON first: an account under the 10 MON reserve may only send value if it sent nothing in the
// last 3 blocks (Monad's "emptying transaction" rule), so this can't follow another faucet tx.
const faucetWallet = createWalletClient({ account: faucet, chain: monadTestnet, transport });
await sleep(LOW_BALANCE_SPACING_MS);
const monTx = await faucetWallet.sendTransaction({
  to: treasury.address,
  value: parseEther("0.3"),
  gas: 21_000n,
});
const monReceipt = await chain.waitForTransactionReceipt({ hash: monTx });
check("treasury received MON for fees", monReceipt.status === "success", monTx);
await sleep(LOW_BALANCE_SPACING_MS);
await send(faucet, {
  address: AGORA_TESTNET.ausd,
  abi: erc20,
  functionName: "transfer",
  args: [treasury.address, fundAusd],
});
check(
  "treasury funded",
  (await chain.readContract({
    address: AGORA_TESTNET.ausd,
    abi: erc20,
    functionName: "balanceOf",
    args: [treasury.address],
  })) === fundAusd,
);

// ---------------------------------------------------------------- employer runs payroll (browser side)
const period = periodIndex({ year: 2026, month: 10 });
const runId = await employer.mutation(api.runs.start, { period });
const row = roster[0]!;
const run = preparePayrollRun({
  employer: { name: "Acme Labs (smoke test)", employerId: BigInt(employerId) },
  period,
  employees: [
    {
      key: row._id,
      grossCents: 1_234n,
      deductions: [],
      paymentProfile: row.account!.paymentProfile,
      receiptPublicKey: row.account!.receiptPublicKey,
      passportCommitment: row.passportCommitment!,
    },
  ],
});
await send(treasury, {
  address: AGORA_TESTNET.ausd,
  abi: erc20,
  functionName: "approve",
  args: [SIGILO_TESTNET.sigiloPay, run.totalAusd],
});
const payoutTx = await send(treasury, {
  address: SIGILO_TESTNET.sigiloPay,
  abi: payAbi,
  functionName: "disperse",
  args: [run.payout.to, run.payout.amounts],
});
check("payout dispersed in fixed pieces", true, `${run.pieceCount} pieces, tx ${payoutTx}`);

await employer.mutation(api.runs.submit, {
  run: runId,
  payoutTxHash: payoutTx,
  totalAusd: run.totalAusd.toString(),
  pieceCount: run.pieceCount,
  runRoot: fieldToHex(run.runRoot!),
  receipts: run.finalize(payoutTx).map((r) => ({ employee: employeeId, ciphertext: r.ciphertext })),
});

// ---------------------------------------------------------------- operator publishes the root
let status = "";
let registryRoot: string | null = null;
for (let i = 0; i < 40 && status !== "done" && status !== "failed"; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const runs = await employer.query(api.runs.list, {});
  status = runs[0]!.status;
  registryRoot = runs[0]!.registryRoot;
  if (status === "failed") console.log("run error:", runs[0]!.error);
}
check("run committed and root published", status === "done" && !!registryRoot, registryRoot ?? "");
check(
  "SigiloRegistry knows the new root",
  await chain.readContract({
    address: SIGILO_TESTNET.registry,
    abi: registryAbi,
    functionName: "isKnownRoot",
    args: [registryRoot as Hex],
  }),
);

// ---------------------------------------------------------------- worker reads their pay
const inbox = await worker.query(api.receipts.mine, {});
const payslip = decryptReceipt(inbox[0]!.ciphertext, payslipKeys.secretKey) as PayslipReceipt;
check(
  "worker decrypts their payslip",
  payslip.netCents === "1234" && payslip.employer.name.startsWith("Acme"),
);
let balance = 0n;
for (const piece of payslip.pieces) {
  const owned = oneTimeAccountKey(workerKeys.stealth, piece.ephemeralPubKey);
  if (owned.address !== piece.account) throw new Error("piece not owned");
  balance += await chain.readContract({
    address: AGORA_TESTNET.ausd,
    abi: erc20,
    functionName: "balanceOf",
    args: [piece.account],
  });
}
check(
  "on-chain balance of their pieces equals net pay",
  balance === 12_340_000n,
  `${payslip.pieces.length} pieces`,
);
const leaves = await worker.query(api.registry.leaves, {});
check("registry leaves are public", leaves.length >= 1);
