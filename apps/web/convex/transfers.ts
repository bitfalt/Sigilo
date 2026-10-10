import { MIN_SEND_AUSD } from "@sigilo/core/send";
import { ConvexError, v } from "convex/values";
import type { Hex } from "viem";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { relaySendHome } from "./lib/operator";

// Send home (SPEC.md F8). The relay takes no session on purpose: the signed authorizations are
// the only permission it needs, so the server never learns who is sending, only that some
// pieces paid some fresh account. The recipient's receipt is opaque ciphertext.

const MAX_PIECES = 64;
const MAX_RECEIPT_CHARS = 8_000;
const MAX_DEADLINE_SECONDS = 30 * 60;
const HEX = /^0x[0-9a-fA-F]*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A person's public payment keys, for a "send to" link. Public keys only. */
export const recipient = query({
  args: { account: v.string() },
  returns: v.union(
    v.null(),
    v.object({ paymentProfile: v.string(), receiptPublicKey: v.string() }),
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("accounts", args.account);
    const account = id ? await ctx.db.get("accounts", id) : null;
    if (!account) return null;
    return { paymentProfile: account.paymentProfile, receiptPublicKey: account.receiptPublicKey };
  },
});

export const deliverReceipt = internalMutation({
  args: { account: v.id("accounts"), ciphertext: v.string() },
  returns: v.null(),
  handler: async (ctx, { account, ciphertext }) => {
    await ctx.db.insert("receipts", { account, kind: "transfer", ciphertext });
    return null;
  },
});

/** Submit a signed send-home and deliver the recipient's receipt once it has landed. */
export const sendHome = action({
  args: {
    auths: v.array(v.object({ from: v.string(), value: v.string(), signature: v.string() })),
    intent: v.object({
      to: v.string(),
      total: v.string(),
      minOut: v.string(),
      deadline: v.number(),
      salt: v.string(),
    }),
    recipient: v.id("accounts"),
    receipt: v.string(),
  },
  returns: v.object({ txHash: v.string(), amountOut: v.string() }),
  handler: async (ctx, args): Promise<{ txHash: string; amountOut: string }> => {
    const { auths, intent } = args;
    const now = Math.floor(Date.now() / 1000);
    if (
      auths.length === 0 ||
      auths.length > MAX_PIECES ||
      !auths.every((a) => ADDRESS.test(a.from) && /^\d+$/.test(a.value) && HEX.test(a.signature)) ||
      !ADDRESS.test(intent.to) ||
      !/^\d+$/.test(intent.total) ||
      !/^\d+$/.test(intent.minOut) ||
      !/^0x[0-9a-fA-F]{64}$/.test(intent.salt) ||
      args.receipt.length > MAX_RECEIPT_CHARS
    ) {
      throw new ConvexError("Invalid payment");
    }
    if (BigInt(intent.total) < MIN_SEND_AUSD) throw new ConvexError("Send at least $1");
    if (intent.deadline <= now || intent.deadline > now + MAX_DEADLINE_SECONDS) {
      throw new ConvexError("This payment expired. Try again.");
    }
    const profile = await ctx.runQuery(internal.transfers.recipientExists, {
      account: args.recipient,
    });
    if (!profile) throw new ConvexError("Unknown recipient");

    let result;
    try {
      result = await relaySendHome({
        auths: auths.map((a) => ({
          from: a.from as Hex,
          value: BigInt(a.value),
          signature: a.signature as Hex,
        })),
        intent: {
          action: 1,
          to: intent.to as Hex,
          total: BigInt(intent.total),
          minOut: BigInt(intent.minOut),
          deadline: BigInt(intent.deadline),
          salt: intent.salt as Hex,
        },
      });
    } catch (e) {
      console.error("sendHome failed", String(e).slice(0, 500));
      throw new ConvexError("The payment didn't go through. Nothing was sent.");
    }
    await ctx.runMutation(internal.transfers.deliverReceipt, {
      account: args.recipient,
      ciphertext: args.receipt,
    });
    return { txHash: result.hash, amountOut: result.amountOut.toString() };
  },
});

export const recipientExists = internalQuery({
  args: { account: v.id("accounts") },
  returns: v.boolean(),
  handler: async (ctx, { account }) => (await ctx.db.get("accounts", account)) !== null,
});
