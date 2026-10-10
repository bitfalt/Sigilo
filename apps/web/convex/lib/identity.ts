import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Identity always comes from the session token (convex/http.ts), never from arguments. Tokens
// have a single issuer (this deployment), so the subject (lowercase address) is canonical.

type Ctx = QueryCtx | MutationCtx;

export async function sessionAddress(ctx: Ctx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function requireSession(ctx: Ctx): Promise<string> {
  const address = await sessionAddress(ctx);
  if (!address) throw new ConvexError("Not signed in");
  return address;
}

export async function findAccount(ctx: Ctx, address: string): Promise<Doc<"accounts"> | null> {
  return ctx.db
    .query("accounts")
    .withIndex("by_evmAddress", (q) => q.eq("evmAddress", address))
    .unique();
}

export async function requireAccount(ctx: Ctx): Promise<Doc<"accounts">> {
  const account = await findAccount(ctx, await requireSession(ctx));
  if (!account) throw new ConvexError("Account not set up");
  return account;
}

export async function findEmployer(ctx: Ctx, address: string): Promise<Doc<"employers"> | null> {
  return ctx.db
    .query("employers")
    .withIndex("by_treasuryAddress", (q) => q.eq("treasuryAddress", address))
    .unique();
}

export async function requireEmployer(ctx: Ctx): Promise<Doc<"employers">> {
  const employer = await findEmployer(ctx, await requireSession(ctx));
  if (!employer) throw new ConvexError("Not an employer");
  return employer;
}

export const HEX32 = /^0x[0-9a-fA-F]{64}$/;
