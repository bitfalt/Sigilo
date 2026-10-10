import { toField } from "@sigilo/core/field";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { findEmployer, HEX32, requireSession, sessionAddress } from "./lib/identity";
import { registryWrite } from "./lib/operator";

const employerView = v.object({
  _id: v.id("employers"),
  name: v.string(),
  employerId: v.string(),
  verified: v.boolean(),
  treasuryAddress: v.string(),
});

/**
 * Register the signed-in admin's company. The session address is their passkey-derived treasury
 * (S_EMPLOYER); `employerId` is a random field element generated in their browser.
 */
export const register = mutation({
  args: { name: v.string(), employerId: v.string() },
  returns: v.id("employers"),
  handler: async (ctx, { name, employerId }) => {
    const address = await requireSession(ctx);
    const existing = await findEmployer(ctx, address);
    if (existing) return existing._id;

    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) throw new ConvexError("Invalid company name");
    if (!HEX32.test(employerId)) throw new ConvexError("Invalid employer id");
    try {
      toField(employerId);
    } catch {
      throw new ConvexError("Invalid employer id");
    }
    const id = employerId.toLowerCase();
    const clash = await ctx.db
      .query("employers")
      .withIndex("by_employerId", (q) => q.eq("employerId", id))
      .unique();
    if (clash) throw new ConvexError("Employer id already in use");

    return ctx.db.insert("employers", {
      name: trimmed,
      employerId: id,
      verified: false,
      treasuryAddress: address,
    });
  },
});

/** The signed-in admin's company, or null. */
export const mine = query({
  args: {},
  returns: v.union(v.null(), employerView),
  handler: async (ctx) => {
    const address = await sessionAddress(ctx);
    const employer = address ? await findEmployer(ctx, address) : null;
    if (!employer) return null;
    const { _id, name, employerId, verified, treasuryAddress } = employer;
    return { _id, name, employerId, verified, treasuryAddress };
  },
});

export const get = internalQuery({
  args: { employer: v.id("employers") },
  returns: v.union(v.null(), employerView),
  handler: async (ctx, { employer }) => {
    const row = await ctx.db.get("employers", employer);
    if (!row) return null;
    const { _id, name, employerId, verified, treasuryAddress } = row;
    return { _id, name, employerId, verified, treasuryAddress };
  },
});

export const markVerified = internalMutation({
  args: { employer: v.id("employers") },
  returns: v.null(),
  handler: async (ctx, { employer }) => {
    await ctx.db.patch("employers", employer, { verified: true });
    return null;
  },
});

/**
 * KYB stand-in, operator only: mark the employer verified in SigiloRegistry, then here.
 *   npx convex run employers:verify '{"employer":"<id>"}'
 */
export const verify = internalAction({
  args: { employer: v.id("employers") },
  returns: v.string(),
  handler: async (ctx, { employer }): Promise<string> => {
    const row = await ctx.runQuery(internal.employers.get, { employer });
    if (!row) throw new Error("Unknown employer");
    const hash = await registryWrite("setEmployerVerified", [row.employerId, true]);
    await ctx.runMutation(internal.employers.markVerified, { employer });
    return hash;
  },
});
