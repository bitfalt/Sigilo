import { toField } from "@sigilo/core/field";
import { AUSD_PER_CENT } from "@sigilo/core/pieces";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { HEX32, requireEmployer } from "./lib/identity";

// Payroll runs (SPEC.md F3). The employer's browser builds the run (core/payroll.ts) and pays it
// from the treasury; the server only receives the results: the payout transaction, the run root
// and one encrypted payslip per employee.

const MAX_RECEIPT_BYTES = 64 * 1024;

const runView = v.object({
  _id: v.id("payrollRuns"),
  _creationTime: v.number(),
  period: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("paying"),
    v.literal("committing"),
    v.literal("done"),
    v.literal("failed"),
  ),
  totalNetCents: v.number(),
  pieceCount: v.number(),
  payoutTxHash: v.union(v.null(), v.string()),
  registryRoot: v.union(v.null(), v.string()),
  publishTxHash: v.union(v.null(), v.string()),
  error: v.union(v.null(), v.string()),
});

/** Claim a period before paying, so the same month can't be paid twice. Resumes a pending run. */
export const start = mutation({
  args: { period: v.number() },
  returns: v.id("payrollRuns"),
  handler: async (ctx, { period }) => {
    const employer = await requireEmployer(ctx);
    if (!Number.isInteger(period) || period < 2000 * 12 || period > 2100 * 12) {
      throw new ConvexError("Invalid period");
    }
    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_employer_and_period", (q) =>
        q.eq("employer", employer._id).eq("period", period),
      )
      .take(10);
    const pending = existing.find((r) => r.status === "pending");
    if (pending) return pending._id;
    // A failed run that already paid (e.g. an unverified employer's) still counts as paid.
    if (existing.some((r) => r.status !== "failed" || r.payoutTxHash)) {
      throw new ConvexError("Payroll already ran for this month");
    }
    return ctx.db.insert("payrollRuns", {
      employer: employer._id,
      period,
      status: "pending",
      totalNetCents: 0,
      pieceCount: 0,
    });
  },
});

/** Record a paid run: store the encrypted payslips and queue the registry update. */
export const submit = mutation({
  args: {
    run: v.id("payrollRuns"),
    payoutTxHash: v.string(),
    totalAusd: v.string(),
    pieceCount: v.number(),
    runRoot: v.union(v.null(), v.string()),
    receipts: v.array(v.object({ employee: v.id("employees"), ciphertext: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employer = await requireEmployer(ctx);
    const run = await ctx.db.get("payrollRuns", args.run);
    if (!run || run.employer !== employer._id) throw new ConvexError("Run not found");
    if (run.status !== "pending") throw new ConvexError("Run already submitted");
    if (!HEX32.test(args.payoutTxHash)) throw new ConvexError("Invalid payout");
    if (!/^[0-9]{1,30}$/.test(args.totalAusd)) throw new ConvexError("Invalid total");
    if (args.runRoot !== null) {
      if (!HEX32.test(args.runRoot)) throw new ConvexError("Invalid run root");
      toField(args.runRoot);
    }

    for (const { employee, ciphertext } of args.receipts) {
      if (ciphertext.length > MAX_RECEIPT_BYTES) throw new ConvexError("Payslip too large");
      const row = await ctx.db.get("employees", employee);
      if (!row || row.employer !== employer._id) throw new ConvexError("Unknown employee");
      if (!row.account) continue; // Not onboarded yet: nobody could read it.
      await ctx.db.insert("receipts", {
        account: row.account,
        kind: "payslip",
        ciphertext,
        run: run._id,
      });
    }

    await ctx.db.patch("payrollRuns", run._id, {
      status: args.runRoot ? "committing" : "done",
      payoutTxHash: args.payoutTxHash.toLowerCase(),
      totalNetCents: Number(BigInt(args.totalAusd) / AUSD_PER_CENT),
      pieceCount: args.pieceCount,
      ...(args.runRoot ? { runRoot: args.runRoot.toLowerCase() } : {}),
    });
    if (args.runRoot) {
      await ctx.scheduler.runAfter(0, internal.registry.publish, { run: run._id });
    }
    return null;
  },
});

/** Give up on a pending run (e.g. the payout failed) so the month can be retried. */
export const abort = mutation({
  args: { run: v.id("payrollRuns"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { run, error }) => {
    const employer = await requireEmployer(ctx);
    const row = await ctx.db.get("payrollRuns", run);
    if (!row || row.employer !== employer._id) throw new ConvexError("Run not found");
    if (row.status === "pending") {
      await ctx.db.patch("payrollRuns", run, { status: "failed", error: error.slice(0, 300) });
    }
    return null;
  },
});

/** The employer's recent runs, newest first (live status for the dashboard). */
export const list = query({
  args: {},
  returns: v.array(runView),
  handler: async (ctx) => {
    const employer = await requireEmployer(ctx);
    const rows = await ctx.db
      .query("payrollRuns")
      .withIndex("by_employer_and_period", (q) => q.eq("employer", employer._id))
      .order("desc")
      .take(36);
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      period: r.period,
      status: r.status,
      totalNetCents: r.totalNetCents,
      pieceCount: r.pieceCount,
      payoutTxHash: r.payoutTxHash ?? null,
      registryRoot: r.registryRoot ?? null,
      publishTxHash: r.publishTxHash ?? null,
      error: r.error ?? null,
    }));
  },
});
