import type { AuthConfig } from "convex/server";

// Session tokens are issued by this deployment's own HTTP actions (convex/http.ts) after a
// Mera EVM signature, and verified here against the JWKS those actions serve.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "sigilo",
      issuer: process.env.CONVEX_SITE_URL!,
      jwks: `${process.env.CONVEX_SITE_URL}/.well-known/jwks.json`,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
