import { REGISTRY_TREE_DEPTH } from "@sigilo/core/constants";
import { fieldToHex } from "@sigilo/core/field";
import { registryLeaf } from "@sigilo/core/hash";
import { registryTree } from "@sigilo/core/merkle";
import { AUSD_PER_CENT } from "@sigilo/core/pieces";
import { v } from "convex/values";
import type { Hex } from "viem";

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { dispersedTotal, registryWrite } from "./lib/operator";

// The global registry of payroll runs (SPEC.md §7). Leaves are public; workers download all of
// them and rebuild the tree locally, so the server never learns which run is being proven.

const MAX_LEAVES = 8192;

async function listLeaves(ctx: QueryCtx): Promise<string[]> {
  const rows = await ctx.db.query("registryLeaves").withIndex("by_index").take(MAX_LEAVES);
  return rows.map((r) => r.leaf);
}

/** Every registry leaf in tree order (GET /api/registry/leaves in SPEC.md §10). */
export const leaves = query({
  args: {},
  returns: v.array(v.string()),
  handler: listLeaves,
});

export const allLeaves = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: listLeaves,
});

export const runForPublish = internalQuery({
  args: { run: v.id("payrollRuns") },
  returns: v.union(
    v.null(),
    v.object({ payoutTxHash: v.string(), totalNetCents: v.number(), treasury: v.string() }),
  ),
  handler: async (ctx, { run }) => {
    const row = await ctx.db.get("payrollRuns", run);
    if (!row?.payoutTxHash || !row.runRoot) return null;
    const employer = await ctx.db.get("employers", row.employer);
    if (!employer) return null;
    return {
      payoutTxHash: row.payoutTxHash,
      totalNetCents: row.totalNetCents,
      treasury: employer.treasuryAddress,
    };
  },
});

/** Append the run's leaf H(employerId, period, runRoot). Idempotent; verified employers only. */
export const appendLeaf = internalMutation({
  args: { run: v.id("payrollRuns") },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, { run }) => {
    const row = await ctx.db.get("payrollRuns", run);
    if (!row?.runRoot) return null;
    if (row.registryIndex !== undefined) return row.registryIndex;
    const employer = await ctx.db.get("employers", row.employer);
    if (!employer?.verified) {
      await ctx.db.patch("payrollRuns", run, {
        status: "failed",
        error: "Employer is not verified",
      });
      return null;
    }
    const last = await ctx.db.query("registryLeaves").withIndex("by_index").order("desc").first();
    const index = last ? last.index + 1 : 0;
    if (index >= Math.min(MAX_LEAVES, 2 ** REGISTRY_TREE_DEPTH)) throw new Error("Registry full");
    const leaf = registryLeaf(BigInt(employer.employerId), BigInt(row.period), BigInt(row.runRoot));
    await ctx.db.insert("registryLeaves", { index, leaf: fieldToHex(leaf), run });
    await ctx.db.patch("payrollRuns", run, { registryIndex: index });
    return index;
  },
});

export const recordPublished = internalMutation({
  args: { run: v.id("payrollRuns"), registryRoot: v.string(), publishTxHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { run, ...fields }) => {
    await ctx.db.patch("payrollRuns", run, { status: "done", ...fields });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { run: v.id("payrollRuns"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { run, error }) => {
    await ctx.db.patch("payrollRuns", run, { status: "failed", error: error.slice(0, 500) });
    return null;
  },
});

/**
 * Operator: check the payout really happened on-chain for the claimed total, append the run to
 * the registry, and publish the new root to SigiloRegistry.
 */
export const publish = internalAction({
  args: { run: v.id("payrollRuns") },
  returns: v.null(),
  handler: async (ctx, { run }) => {
    try {
      const info = await ctx.runQuery(internal.registry.runForPublish, { run });
      if (!info) throw new Error("Run is not ready to publish");
      const paid = await dispersedTotal(info.payoutTxHash as Hex, info.treasury);
      if (paid === null || paid < BigInt(info.totalNetCents) * AUSD_PER_CENT) {
        throw new Error("Payout not found on-chain for this treasury and total");
      }

      const index = await ctx.runMutation(internal.registry.appendLeaf, { run });
      if (index === null) return null;
      const all = await ctx.runQuery(internal.registry.allLeaves, {});
      const root = fieldToHex(registryTree(all.map((l: string) => BigInt(l))).root);
      const publishTxHash = await registryWrite("publishRoot", [root]);
      await ctx.runMutation(internal.registry.recordPublished, {
        run,
        registryRoot: root,
        publishTxHash,
      });
    } catch (error) {
      await ctx.runMutation(internal.registry.recordFailure, {
        run,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});
