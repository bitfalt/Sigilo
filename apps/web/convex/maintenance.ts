import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

/**
 * Operator only: delete throwaway employers created by `pnpm e2e:passkey` (name prefix), with
 * their employees. Refuses any employer that has payroll runs.
 *   npx convex run maintenance:deleteTestEmployers '{"namePrefix":"Passkey Test"}' [--prod]
 */
export const deleteTestEmployers = internalMutation({
  args: { namePrefix: v.string() },
  returns: v.object({ deleted: v.array(v.string()), skipped: v.array(v.string()) }),
  handler: async (ctx, { namePrefix }) => {
    if (namePrefix.trim().length < 6) throw new Error("Prefix too short");
    const deleted: string[] = [];
    const skipped: string[] = [];
    for await (const employer of ctx.db.query("employers")) {
      if (!employer.name.startsWith(namePrefix)) continue;
      const run = await ctx.db
        .query("payrollRuns")
        .withIndex("by_employer_and_period", (q) => q.eq("employer", employer._id))
        .first();
      if (run) {
        skipped.push(employer.name);
        continue;
      }
      const employees = await ctx.db
        .query("employees")
        .withIndex("by_employer", (q) => q.eq("employer", employer._id))
        .take(300);
      for (const row of employees) await ctx.db.delete("employees", row._id);
      await ctx.db.delete("employers", employer._id);
      deleted.push(employer.name);
    }
    return { deleted, skipped };
  },
});
