import { monad } from "@monad-crypto/mpp/client";
import type { SignedAttestation } from "@sigilo/core/verify";
import { ConvexHttpClient } from "convex/browser";
import { Receipt } from "mppx";
import { Mppx } from "mppx/client";

import { CONVEX_URL } from "@/lib/config";
import { lenderAccount, monadClient } from "@/lib/server/accounts";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

// The demo lender's back office (SPEC.md F6): fetch the worker's answer, pay the Sigilo Verify
// API through MPP with the lender's server-held key (pull mode: an ERC-3009 signature, no gas),
// and file the signed attestation with Convex, which checks the signature itself.

export async function POST(request: Request): Promise<Response> {
  let requestId: string;
  try {
    ({ requestId } = (await request.json()) as { requestId: string });
    if (typeof requestId !== "string") throw new Error();
  } catch {
    return Response.json({ error: "Send JSON: { requestId }" }, { status: 400 });
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  const id = requestId as Id<"verificationRequests">;
  let pending;
  try {
    pending = await convex.query(api.requests.forVerify, { request: id });
  } catch {
    return Response.json({ error: "Unknown request" }, { status: 404 });
  }
  if (!pending) {
    return Response.json({ error: "Nothing to verify yet" }, { status: 409 });
  }

  const mppx = Mppx.create({
    methods: [monad({ account: lenderAccount(), mode: "pull", getClient: monadClient })],
    polyfill: false,
  });
  const response = await mppx.fetch(new URL("/api/v1/verify", request.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pending),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("verify failed", response.status, detail.slice(0, 500));
    return Response.json({ error: "The verification service didn't answer" }, { status: 502 });
  }

  const signed = (await response.json()) as SignedAttestation;
  let paymentReference: string | undefined;
  try {
    paymentReference = Receipt.fromResponse(response).reference;
  } catch {
    // Paid but no receipt header: keep the result.
  }
  await convex.action(api.requests.record, {
    request: id,
    attestation: signed.attestation,
    signature: signed.signature,
    ...(paymentReference ? { paymentReference } : {}),
  });
  return Response.json({ ...signed, paymentReference });
}
