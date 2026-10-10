// End-to-end check of Convex sign-in against the configured deployment:
//   pnpm smoke:auth (node --env-file=.env.local scripts/smoke-auth.mts)
// A throwaway key stands in for a Mera session key. Nothing is persisted or printed.

import { ConvexHttpClient } from "convex/browser";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";

const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!cloudUrl || !siteUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL / _SITE_URL are not set");

const post = (path: string, body: unknown) =>
  fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

const worker = privateKeyToAccount(generatePrivateKey());
const impostor = privateKeyToAccount(generatePrivateKey());

async function challenge() {
  const res = await post("/auth/challenge", { address: worker.address });
  if (res.headers.get("Access-Control-Allow-Origin") !== "http://localhost:3000") {
    throw new Error("missing CORS header");
  }
  return (await res.json()) as { nonce: string; message: string };
}

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

// 1. Happy path.
const c1 = await challenge();
const signature = await worker.signMessage({ message: c1.message });
const session = await post("/auth/session", {
  address: worker.address,
  nonce: c1.nonce,
  signature,
});
const { token } = (await session.json()) as { token: string };
check("session issued", session.status === 200 && typeof token === "string");

const client = new ConvexHttpClient(cloudUrl);
client.setAuth(token);
const me = await client.query(api.me.whoami, {});
check("Convex sees the signer", me?.address === worker.address.toLowerCase());

// 2. Replaying the same challenge fails.
const replay = await post("/auth/session", { address: worker.address, nonce: c1.nonce, signature });
check("replayed challenge rejected", replay.status === 401);

// 3. Someone else's signature fails.
const c2 = await challenge();
const forged = await impostor.signMessage({ message: c2.message });
const wrong = await post("/auth/session", {
  address: worker.address,
  nonce: c2.nonce,
  signature: forged,
});
check("wrong signer rejected", wrong.status === 401);

// 4. A tampered token is not accepted.
const anon = new ConvexHttpClient(cloudUrl);
anon.setAuth(`${token.slice(0, -4)}AAAA`);
const tampered = await anon.query(api.me.whoami, {}).then(
  (r) => r === null,
  () => true,
);
check("tampered token rejected", tampered);
