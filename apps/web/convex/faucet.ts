import { AGORA_TESTNET } from "@sigilo/core/constants";
import { ConvexError, v } from "convex/values";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Hex,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { internal } from "./_generated/api";
import { action, env, internalAction, internalMutation } from "./_generated/server";

// Demo faucet (testnet only, SPEC.md F2.3): "Add funds" sends a new employer's passkey-derived
// treasury some AUSD for salaries and a little MON for fees.
//
// Monad reserve rules: the faucet holds < 10 MON, so it may only send MON when it sent nothing in
// the last 3 blocks. MON goes first, then AUSD, ~1.5 s apart, and every receipt is checked.

const FUND_AUSD = 6_000_000_000n; // $6,000
const FUND_MON = parseEther("0.25");
const COOLDOWN_MS = 3 * 60 * 1000;
const SPACING_MS = 1_500;

const agoraFaucetAbi = parseAbi(["function requestFunds(address recipient)"]);

function clients(privateKey: string) {
  const transport = http(env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(privateKey as Hex);
  return {
    account,
    publicClient: createPublicClient({ chain: monadTestnet, transport }),
    walletClient: createWalletClient({ account, chain: monadTestnet, transport }),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Atomically check the cooldown and claim a funding slot for the signed-in employer. Returns a
 * result instead of throwing: errors thrown in a nested mutation reach the browser as a generic
 * "Server Error" in production.
 */
export const claimFunding = internalMutation({
  args: { address: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("notEmployer") }),
    v.object({ kind: v.literal("wait"), minutes: v.number() }),
    v.object({ kind: v.literal("ok"), treasury: v.string() }),
  ),
  handler: async (ctx, { address }) => {
    const employer = await ctx.db
      .query("employers")
      .withIndex("by_treasuryAddress", (q) => q.eq("treasuryAddress", address))
      .unique();
    if (!employer) return { kind: "notEmployer" as const };
    const now = Date.now();
    if (employer.lastFundedAt && now - employer.lastFundedAt < COOLDOWN_MS) {
      const minutes = Math.ceil((COOLDOWN_MS - (now - employer.lastFundedAt)) / 60_000);
      return { kind: "wait" as const, minutes };
    }
    await ctx.db.patch("employers", employer._id, { lastFundedAt: now });
    return { kind: "ok" as const, treasury: employer.treasuryAddress };
  },
});

export const fundTreasury = action({
  args: {},
  returns: v.object({ monTx: v.string(), ausdTx: v.string() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const claim = await ctx.runMutation(internal.faucet.claimFunding, {
      address: identity.subject,
    });
    if (claim.kind === "notEmployer") throw new ConvexError("Not an employer");
    if (claim.kind === "wait") {
      throw new ConvexError(
        `Test funds were just added. Try again in ${claim.minutes} minute${claim.minutes === 1 ? "" : "s"}.`,
      );
    }
    const treasury = claim.treasury;

    const { publicClient, walletClient } = clients(env.FAUCET_PRIVATE_KEY);
    const to = treasury as Hex;
    const monTx = await walletClient.sendTransaction({ to, value: FUND_MON, gas: 21_000n });
    const monReceipt = await publicClient.waitForTransactionReceipt({ hash: monTx });
    if (monReceipt.status !== "success") throw new ConvexError("The demo faucet is out of fees");
    await sleep(SPACING_MS);

    const gas = await publicClient.estimateContractGas({
      address: AGORA_TESTNET.ausd,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, FUND_AUSD],
      account: walletClient.account,
    });
    const ausdTx = await walletClient.writeContract({
      address: AGORA_TESTNET.ausd,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, FUND_AUSD],
      gas: (gas * 115n) / 100n,
    });
    const ausdReceipt = await publicClient.waitForTransactionReceipt({ hash: ausdTx });
    if (ausdReceipt.status !== "success")
      throw new ConvexError("The demo faucet is out of dollars");
    return { monTx, ausdTx };
  },
});

/**
 * Top up the demo faucet from Agora's testnet AUSD faucet (global cooldown, so most attempts are
 * refused at estimation and cost nothing). Run by crons.ts.
 */
export const refill = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    const faucet = privateKeyToAccount(env.FAUCET_PRIVATE_KEY as Hex).address;
    const { publicClient, walletClient } = clients(env.OPERATOR_PRIVATE_KEY);
    try {
      const gas = await publicClient.estimateContractGas({
        address: AGORA_TESTNET.ausdFaucet,
        abi: agoraFaucetAbi,
        functionName: "requestFunds",
        args: [faucet],
        account: walletClient.account,
      });
      const hash = await walletClient.writeContract({
        address: AGORA_TESTNET.ausdFaucet,
        abi: agoraFaucetAbi,
        functionName: "requestFunds",
        args: [faucet],
        gas: (gas * 115n) / 100n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } catch {
      // MaxFrequencyExceeded or a busy faucet: try again next time.
    }
    return null;
  },
});
