// Shared helpers for the testnet scripts: sign in to Convex with a raw key, send Monad
// transactions politely, and set up a verified employer that pays a worker for real.

import { execFileSync } from "node:child_process";

import {
  AGORA_TESTNET,
  deriveEmployerKeys,
  encryptRosterEntry,
  fieldToHex,
  newInviteCode,
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

import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";

export const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;
const faucetKey = process.env.TREASURY_PRIVATE_KEY as Hex | undefined;
if (!cloudUrl || !siteUrl || !faucetKey) throw new Error("missing env (Convex URLs, TREASURY key)");

const erc20 = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const payAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

const transport = http(monadTestnet.rpcUrls.default.http[0]);
export const chain = createPublicClient({ chain: monadTestnet, transport });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();

export function check(label: string, ok: boolean, detail = "") {
  const t = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "PASS" : "FAIL"} [${t}s] ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) throw new Error(`failed: ${label}`);
}

export const ausdBalance = (address: Hex) =>
  chain.readContract({
    address: AGORA_TESTNET.ausd,
    abi: erc20,
    functionName: "balanceOf",
    args: [address],
  });

// Monad: accounts under 10 MON may send one transaction per ~3 blocks; retry the transient refusals.
const transient = (e: unknown) => /insufficient balance|reserve|rate|nonce/i.test(String(e));
export async function send(account: PrivateKeyAccount, req: Record<string, unknown>): Promise<Hex> {
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

export async function signIn(account: PrivateKeyAccount): Promise<ConvexHttpClient> {
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

export const randomPrf = () => crypto.getRandomValues(new Uint8Array(32));

/** A registered, operator-verified employer with a treasury funded for `ausd` (+ MON for fees). */
export async function verifiedEmployer(name: string, ausd: bigint) {
  const keys = deriveEmployerKeys(randomPrf());
  const treasury = privateKeyToAccount(toHex(keys.treasuryKey));
  const client = await signIn(treasury);
  const employerId = fieldToHex(randomField());
  const doc = await client.mutation(api.employers.register, { name, employerId });
  execFileSync("npx", ["convex", "run", "employers:verify", JSON.stringify({ employer: doc })], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  // ausd = 0: an employer that never pays (no funding, no fees spent).
  if (ausd > 0n) {
    const faucet = privateKeyToAccount(faucetKey!);
    await sleep(1_500);
    const monTx = await createWalletClient({
      account: faucet,
      chain: monadTestnet,
      transport,
    }).sendTransaction({ to: treasury.address, value: parseEther("0.25"), gas: 21_000n });
    const mon = await chain.waitForTransactionReceipt({ hash: monTx });
    if (mon.status !== "success") throw new Error("MON funding failed");
    await sleep(1_500);
    await send(faucet, {
      address: AGORA_TESTNET.ausd,
      abi: erc20,
      functionName: "transfer",
      args: [treasury.address, ausd],
    });
    await send(treasury, {
      address: AGORA_TESTNET.ausd,
      abi: erc20,
      functionName: "approve",
      args: [SIGILO_TESTNET.sigiloPay, ausd],
    });
  }

  return {
    name,
    employerId,
    client,
    treasury,
    rosterKey: keys.rosterKey,
    /** Add a person to the encrypted roster; returns the invite code for their link. */
    async invite(person: string, monthlySalaryCents: number) {
      const invite = newInviteCode();
      const employee = await client.mutation(api.employees.add, {
        roster: encryptRosterEntry(
          { name: person, monthlySalaryCents },
          keys.rosterKey,
          employerId,
        ),
        inviteCodeHash: invite.hash,
      });
      return { employee, code: invite.code, hash: invite.hash };
    },
    /** Pay every onboarded employee `grossCents` for `period` and wait for the registry. */
    async pay(period: number, grossCents: bigint) {
      const roster = (await client.query(api.employees.list, {})).filter(
        (r) => r.account && r.passportCommitment,
      );
      const runId = await client.mutation(api.runs.start, { period });
      const run = preparePayrollRun({
        employer: { name, employerId: BigInt(employerId) },
        period,
        employees: roster.map((r) => ({
          key: r._id,
          grossCents,
          deductions: [],
          paymentProfile: r.account!.paymentProfile,
          receiptPublicKey: r.account!.receiptPublicKey,
          passportCommitment: r.passportCommitment!,
        })),
      });
      const payoutTx = await send(treasury, {
        address: SIGILO_TESTNET.sigiloPay,
        abi: payAbi,
        functionName: "disperse",
        args: [run.payout.to, run.payout.amounts],
      });
      await client.mutation(api.runs.submit, {
        run: runId,
        payoutTxHash: payoutTx,
        totalAusd: run.totalAusd.toString(),
        pieceCount: run.pieceCount,
        runRoot: fieldToHex(run.runRoot!),
        receipts: run
          .finalize(payoutTx)
          .map((r) => ({ employee: r.key as Id<"employees">, ciphertext: r.ciphertext })),
      });
      let status = "";
      for (let i = 0; i < 60 && status !== "done" && status !== "failed"; i++) {
        await sleep(1_500);
        status = (await client.query(api.runs.list, {})).find((r) => r._id === runId)!.status;
      }
      return status;
    },
  };
}
