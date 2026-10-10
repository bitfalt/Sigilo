import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireAccount } from "./lib/identity";

/** The signed-in person's encrypted receipts, newest first. Decrypted only on their device. */
export const mine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("receipts"),
      _creationTime: v.number(),
      kind: v.union(v.literal("payslip"), v.literal("advance"), v.literal("transfer")),
      ciphertext: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const account = await requireAccount(ctx);
    const rows = await ctx.db
      .query("receipts")
      .withIndex("by_account", (q) => q.eq("account", account._id))
      .order("desc")
      .take(500);
    return rows.map(({ _id, _creationTime, kind, ciphertext }) => ({
      _id,
      _creationTime,
      kind,
      ciphertext,
    }));
  },
});
