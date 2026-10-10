import { RUN_TREE_DEPTH } from "@sigilo/core/constants";
import { toField } from "@sigilo/core/field";
import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { HEX32, requireAccount, requireEmployer } from "./lib/identity";

// Blind roster (SPEC.md §5): the server stores the employer-encrypted roster entry and the hash of
// the invite code. Names and salaries are never visible here.

const MAX_EMPLOYEES = 2 ** RUN_TREE_DEPTH;
const MAX_ROSTER_BYTES = 4096;

export const add = mutation({
  args: { roster: v.string(), inviteCodeHash: v.string() },
  returns: v.id("employees"),
  handler: async (ctx, args) => {
    const employer = await requireEmployer(ctx);
    if (args.roster.length > MAX_ROSTER_BYTES) throw new ConvexError("Roster entry too large");
    if (!/^[0-9a-f]{64}$/.test(args.inviteCodeHash)) throw new ConvexError("Invalid invite");
    const current = await ctx.db
      .query("employees")
      .withIndex("by_employer", (q) => q.eq("employer", employer._id))
      .take(MAX_EMPLOYEES);
    if (current.length >= MAX_EMPLOYEES) throw new ConvexError("Employee limit reached");
    return ctx.db.insert("employees", {
      employer: employer._id,
      roster: args.roster,
      inviteCodeHash: args.inviteCodeHash,
      status: "invited",
    });
  },
});

/** The employer's roster with each worker's public keys, for building a payroll run. */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("employees"),
      roster: v.string(),
      status: v.union(v.literal("invited"), v.literal("active")),
      passportCommitment: v.union(v.null(), v.string()),
      account: v.union(
        v.null(),
        v.object({ paymentProfile: v.string(), receiptPublicKey: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const employer = await requireEmployer(ctx);
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_employer", (q) => q.eq("employer", employer._id))
      .take(MAX_EMPLOYEES);
    return Promise.all(
      rows.map(async (row) => {
        const account = row.account ? await ctx.db.get("accounts", row.account) : null;
        return {
          _id: row._id,
          roster: row.roster,
          status: row.status,
          passportCommitment: row.passportCommitment ?? null,
          account: account
            ? { paymentProfile: account.paymentProfile, receiptPublicKey: account.receiptPublicKey }
            : null,
        };
      }),
    );
  },
});

/** What an invite link shows before sign-in: the employer's name and whether it's still open. */
export const inviteInfo = query({
  args: { inviteCodeHash: v.string() },
  returns: v.union(v.null(), v.object({ employerName: v.string(), open: v.boolean() })),
  handler: async (ctx, { inviteCodeHash }) => {
    const row = await ctx.db
      .query("employees")
      .withIndex("by_inviteCodeHash", (q) => q.eq("inviteCodeHash", inviteCodeHash))
      .unique();
    if (!row) return null;
    const employer = await ctx.db.get("employers", row.employer);
    return employer ? { employerName: employer.name, open: row.status === "invited" } : null;
  },
});

/** Bind the signed-in worker's account to the invited employee record. */
export const acceptInvite = mutation({
  args: { inviteCodeHash: v.string() },
  returns: v.object({ employerName: v.string() }),
  handler: async (ctx, { inviteCodeHash }) => {
    const account = await requireAccount(ctx);
    const row = await ctx.db
      .query("employees")
      .withIndex("by_inviteCodeHash", (q) => q.eq("inviteCodeHash", inviteCodeHash))
      .unique();
    if (!row) throw new ConvexError("Invite not found");
    if (row.status !== "invited") {
      if (row.account === account._id) {
        const employer = await ctx.db.get("employers", row.employer);
        return { employerName: employer?.name ?? "" };
      }
      throw new ConvexError("Invite already used");
    }
    await ctx.db.patch("employees", row._id, { account: account._id, status: "active" });
    const employer = await ctx.db.get("employers", row.employer);
    return { employerName: employer?.name ?? "" };
  },
});

/** Activate the Income Passport: store C = H(passportSecret) on the worker's employee records. */
export const setPassportCommitment = mutation({
  args: { commitment: v.string() },
  returns: v.null(),
  handler: async (ctx, { commitment }) => {
    const account = await requireAccount(ctx);
    if (!HEX32.test(commitment)) throw new ConvexError("Invalid commitment");
    try {
      toField(commitment);
    } catch {
      throw new ConvexError("Invalid commitment");
    }
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_account", (q) => q.eq("account", account._id))
      .take(16);
    for (const row of rows) {
      await ctx.db.patch("employees", row._id, { passportCommitment: commitment.toLowerCase() });
    }
    return null;
  },
});

/** Employers the signed-in worker belongs to (names only). */
export const myEmployers = query({
  args: {},
  returns: v.array(v.object({ employerName: v.string(), passportActive: v.boolean() })),
  handler: async (ctx) => {
    const account = await requireAccount(ctx);
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_account", (q) => q.eq("account", account._id))
      .take(16);
    const out = [];
    for (const row of rows) {
      const employer = await ctx.db.get("employers", row.employer);
      if (employer) {
        out.push({ employerName: employer.name, passportActive: !!row.passportCommitment });
      }
    }
    return out;
  },
});
