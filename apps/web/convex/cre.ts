import { periodIndex } from "@sigilo/core/period";
import { AUSD_PER_CENT } from "@sigilo/core/pieces";
import { v } from "convex/values";

import { internalQuery } from "./_generated/server";

// Data for the Chainlink CRE "payday" workflow (packages/cre), served by GET /cre/payday.
//
// The workflow is an independent auditor: it rebuilds the registry tree from the public leaves,
// checks the root published on Monad, and checks every payroll-deducted advance against the
// AdvanceVault. Privacy boundary (SPEC.md §5): only data that is already public or that names
// nobody leaves this file. Registry leaves are public (registry.leaves); an advance is a vault,
// its on-chain id and how much should have been repaid by now. Never add employers, names,
// salaries, employee ids, lender names or anything else that links an advance to an employer.
//
// The response must be identical for every DON node that fetches it (consensus), so it carries no
// timestamps and is sorted deterministically.

/** Same bound as registry.ts. The CRE HTTP response limit (250 kb) caps this at ~3,500 leaves. */
const MAX_LEAVES = 8192;
/** Newest mandates checked per run; the workflow reads each advance from the vault. */
const MAX_MANDATES = 64;

const advanceDue = v.object({
  vault: v.string(),
  // AdvanceVault advance id, decimal string.
  advanceId: v.string(),
  // AUSD base units (6 decimals) that should have reached the vault by now, decimal string.
  expectedRepaid: v.string(),
  // Month index (year * 12 + month - 1, UTC) of the latest installment due.
  period: v.number(),
});

/** Month index of a unix-millisecond timestamp, UTC (core/period.ts). */
function periodAt(ms: number): number {
  const d = new Date(ms);
  return periodIndex({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
}

/**
 * Registry leaves in tree order, and what each payroll-deducted advance should have repaid by
 * `now`: one installment per month boundary passed since the worker signed the mandate, capped at
 * the advance's owed amount.
 */
export const payday = internalQuery({
  args: { now: v.number() },
  returns: v.object({ leaves: v.array(v.string()), advances: v.array(advanceDue) }),
  handler: async (ctx, { now }) => {
    const leafRows = await ctx.db.query("registryLeaves").withIndex("by_index").take(MAX_LEAVES);
    const leaves = leafRows.map((r) => r.leaf);

    const nowPeriod = periodAt(now);
    const mandates = await ctx.db.query("mandates").order("desc").take(MAX_MANDATES);
    const advances = [];
    for (const m of mandates) {
      // Completed mandates stay in so a late flag can be cleared once the vault is repaid.
      if (m.status === "cancelled") continue;
      const advance = await ctx.db.get("advances", m.advance);
      if (!advance) continue;
      const signedPeriod = periodAt(m._creationTime);
      const due = Math.min(Math.max(nowPeriod - signedPeriod, 0), m.installments);
      const owed = BigInt(advance.owed);
      const scheduled = BigInt(due) * BigInt(m.installmentCents) * AUSD_PER_CENT;
      advances.push({
        vault: m.vault,
        advanceId: m.advanceId,
        expectedRepaid: (scheduled < owed ? scheduled : owed).toString(),
        period: signedPeriod + due,
      });
    }
    advances.sort((a, b) => {
      if (a.vault !== b.vault) return a.vault < b.vault ? -1 : 1;
      const x = BigInt(a.advanceId);
      const y = BigInt(b.advanceId);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return { leaves, advances };
  },
});
