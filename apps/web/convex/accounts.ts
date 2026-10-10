import { decodePaymentProfile } from "@sigilo/core/stealth";
import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { findAccount, HEX32, requireSession, sessionAddress } from "./lib/identity";

const publicAccount = v.object({
  _id: v.id("accounts"),
  evmAddress: v.string(),
  paymentProfile: v.string(),
  receiptPublicKey: v.string(),
});

/** Register (or confirm) the signed-in person's public keys. Keys derive from the passkey. */
export const register = mutation({
  args: { paymentProfile: v.string(), receiptPublicKey: v.string() },
  returns: v.id("accounts"),
  handler: async (ctx, args) => {
    const address = await requireSession(ctx);
    try {
      decodePaymentProfile(args.paymentProfile);
    } catch {
      throw new ConvexError("Invalid payment profile");
    }
    if (!HEX32.test(args.receiptPublicKey)) throw new ConvexError("Invalid receipt key");

    const keys = {
      paymentProfile: args.paymentProfile.toLowerCase(),
      receiptPublicKey: args.receiptPublicKey.toLowerCase(),
    };
    const existing = await findAccount(ctx, address);
    if (existing) {
      if (
        existing.paymentProfile !== keys.paymentProfile ||
        existing.receiptPublicKey !== keys.receiptPublicKey
      ) {
        await ctx.db.patch("accounts", existing._id, keys);
      }
      return existing._id;
    }
    return ctx.db.insert("accounts", { evmAddress: address, ...keys });
  },
});

/** The signed-in person's account, or null before registration. */
export const me = query({
  args: {},
  returns: v.union(v.null(), publicAccount),
  handler: async (ctx) => {
    const address = await sessionAddress(ctx);
    const account = address ? await findAccount(ctx, address) : null;
    if (!account) return null;
    const { _id, evmAddress, paymentProfile, receiptPublicKey } = account;
    return { _id, evmAddress, paymentProfile, receiptPublicKey };
  },
});
