import { v } from "convex/values";

import { query } from "./_generated/server";

/** The signed-in session's address, or null. Identity always comes from the token. */
export const whoami = query({
  args: {},
  returns: v.union(v.null(), v.object({ address: v.string() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity ? { address: identity.subject } : null;
  },
});
