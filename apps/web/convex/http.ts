import {
  SESSION_AUDIENCE,
  SESSION_TTL_SECONDS,
  sessionChallengeMessage,
} from "@sigilo/core/session";
import { httpRouter } from "convex/server";
import { importJWK, SignJWT } from "jose";
import { type Hex, isAddress, verifyMessage } from "viem";

import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";

// Sign-in (SPEC.md §10 Auth): challenge → Mera EVM signature → ES256 session token, verified by
// auth.config.ts against the JWKS served below.

const http = httpRouter();

const DEFAULT_ORIGINS = "http://localhost:3000,https://sigilo.work,https://www.sigilo.work";

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(",").map((o) => o.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(req) },
  });

const preflight = httpAction(
  async (_ctx, req) => new Response(null, { status: 204, headers: cors(req) }),
);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

http.route({
  path: "/auth/challenge",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await readBody(req);
    const address = body?.address;
    if (typeof address !== "string" || !isAddress(address)) {
      return json(req, { error: "invalid account" }, 400);
    }
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const challenge = await ctx.runMutation(internal.sessions.createChallenge, { address, nonce });
    return json(req, { ...challenge, message: sessionChallengeMessage(challenge) });
  }),
});
http.route({ path: "/auth/challenge", method: "OPTIONS", handler: preflight });

http.route({
  path: "/auth/session",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await readBody(req);
    const { address, nonce, signature } = body ?? {};
    if (
      typeof address !== "string" ||
      !isAddress(address) ||
      typeof nonce !== "string" ||
      typeof signature !== "string" ||
      !/^0x[0-9a-fA-F]{130}$/.test(signature)
    ) {
      return json(req, { error: "invalid request" }, 400);
    }

    const challenge = await ctx.runMutation(internal.sessions.consumeChallenge, { address, nonce });
    if (!challenge) return json(req, { error: "challenge expired" }, 401);
    const valid = await verifyMessage({
      address,
      message: sessionChallengeMessage(challenge),
      signature: signature as Hex,
    });
    if (!valid) return json(req, { error: "invalid signature" }, 401);

    const publicJwk = JSON.parse(env.SESSION_PUBLIC_JWK) as { kid: string };
    const key = await importJWK(JSON.parse(env.SESSION_PRIVATE_JWK), "ES256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: publicJwk.kid, typ: "JWT" })
      .setIssuer(env.CONVEX_SITE_URL)
      .setAudience(SESSION_AUDIENCE)
      .setSubject(address.toLowerCase())
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(key);
    return json(req, { token, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
  }),
});
http.route({ path: "/auth/session", method: "OPTIONS", handler: preflight });

http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: httpAction(
    async () =>
      new Response(JSON.stringify({ keys: [JSON.parse(env.SESSION_PUBLIC_JWK)] }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      }),
  ),
});

// Chainlink CRE "payday" workflow (packages/cre): public registry leaves and the advances due.
// Called server to server by the DON nodes, so no CORS. See convex/cre.ts for the privacy rules.
http.route({
  path: "/cre/payday",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const body = await ctx.runQuery(internal.cre.payday, { now: Date.now() });
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }),
});

export default http;
