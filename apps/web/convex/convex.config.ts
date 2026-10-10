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
    // Sigilo operator: publishes registry roots and verifies employers. Secret.
    OPERATOR_PRIVATE_KEY: v.string(),
    MONAD_RPC_URL: v.optional(v.string()),
    // Demo faucet (testnet only): funds new employer treasuries with AUSD and MON. Secret.
    FAUCET_PRIVATE_KEY: v.string(),
    // "true" on a demo deployment: verify every new employer automatically (KYB stand-in), so
    // testers get Income Passports without waiting for the operator.
    AUTO_VERIFY_EMPLOYERS: v.optional(v.string()),
  },
});
