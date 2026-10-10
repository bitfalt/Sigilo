import { defineApp } from "convex/server";
import { v } from "convex/values";

// Typed deployment env (set with `npx convex env set`). Never prefix secrets with NEXT_PUBLIC_.
export default defineApp({
  env: {
    // ES256 key pair for session tokens, as JWK JSON. The private key is a secret.
    SESSION_PRIVATE_JWK: v.string(),
    SESSION_PUBLIC_JWK: v.string(),
    // Comma-separated browser origins allowed to call the HTTP actions (CORS).
    ALLOWED_ORIGINS: v.optional(v.string()),
  },
});
