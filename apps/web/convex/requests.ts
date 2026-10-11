import { MONAD_TESTNET_CHAIN_ID, PASSPORT_PERIODS } from "@sigilo/core/constants";
import { fieldToHex } from "@sigilo/core/field";
import { decodePassportPublicInputs, PASSPORT_PUBLIC_INPUT_COUNT } from "@sigilo/core/passport";
import { verifierScope } from "@sigilo/core/scope";
import {
  DEMO_LENDER,
  type IncomeAttestation,
  isRecent,
  isSigiloAttestation,
  REQUEST_TTL_MS,
  requestNonce,
} from "@sigilo/core/verify";
import { ConvexError, v } from "convex/values";
import type { Hex } from "viem";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { HEX32 } from "./lib/identity";
import { passportIsValid } from "./lib/operator";

// Income Passport verification requests (SPEC.md F5–F6). A request is addressed by its
// unguessable id (/v/[requestId]) and only ever holds public data: the lender's terms, then the
// worker's proof and the Verify API's signed answer. Nothing here identifies the worker.

const MIN_THRESHOLD_CENTS = 100;
const MAX_THRESHOLD_CENTS = 10_000_000;
const MAX_PROOF_HEX = 100_000;

const statusValidator = v.union(
  v.literal("open"),
  v.literal("submitted"),
  v.literal("verified"),
  v.literal("rejected"),
  v.literal("expired"),
);

const attestationValidator = v.object({
  valid: v.boolean(),
  thresholdCents: v.number(),
  firstPeriod: v.number(),
  months: v.number(),
  scope: v.string(),
  nonce: v.string(),
  pseudonym: v.string(),
  registryRoot: v.string(),
  verifiedAt: v.number(),
});

const requestView = v.object({
  _id: v.id("verificationRequests"),
  _creationTime: v.number(),
  lenderName: v.string(),
  thresholdCents: v.number(),
  months: v.number(),
  scope: v.string(),
  nonce: v.string(),
  status: statusValidator,
  expiresAt: v.number(),
  offer: v.optional(
    v.object({ amountCents: v.number(), installments: v.number(), feeBps: v.number() }),
  ),
  advance: v.optional(
    v.object({
      _id: v.id("advances"),
      advanceId: v.string(),
      amount: v.string(),
      owed: v.string(),
      vault: v.string(),
      status: v.union(v.literal("active"), v.literal("closed")),
      txHash: v.string(),
      // Repayment progress from payroll deductions, once the worker signed the mandate.
      installments: v.optional(v.number()),
      paidInstallments: v.optional(v.number()),
      remainingCents: v.optional(v.number()),
    }),
  ),
  result: v.optional(
    v.object({
      valid: v.boolean(),
      firstPeriod: v.number(),
      months: v.number(),
      pseudonym: v.string(),
      registryRoot: v.string(),
      verifiedAt: v.number(),
      paymentReference: v.optional(v.string()),
    }),
  ),
});

function effectiveStatus(row: Doc<"verificationRequests">, now: number) {
  return row.status === "open" && now > row.expiresAt ? "expired" : row.status;
}

/** Lender console: open a request for "at least `thresholdCents` a month, last 3 months". */
export const create = mutation({
  args: { thresholdCents: v.number() },
  returns: v.id("verificationRequests"),
  handler: async (ctx, { thresholdCents }) => {
    if (
      !Number.isInteger(thresholdCents) ||
      thresholdCents < MIN_THRESHOLD_CENTS ||
      thresholdCents > MAX_THRESHOLD_CENTS
    ) {
      throw new ConvexError("Enter a monthly amount between $1 and $100,000");
    }
    const id = await ctx.db.insert("verificationRequests", {
      lenderName: DEMO_LENDER.name,
      lenderAddress: DEMO_LENDER.address,
      thresholdCents,
      months: PASSPORT_PERIODS,
      scope: fieldToHex(verifierScope(DEMO_LENDER.address, MONAD_TESTNET_CHAIN_ID)),
      nonce: "0x",
      status: "open",
      expiresAt: Date.now() + REQUEST_TTL_MS,
    });
    await ctx.db.patch("verificationRequests", id, { nonce: fieldToHex(requestNonce(id)) });
    return id;
  },
});

/** A request and, once verified, its result. Public: the id is the capability. */
export const get = query({
  // A string, so a mistyped link shows "not found" instead of failing validation.
  args: { request: v.string() },
  returns: v.union(v.null(), requestView),
  handler: async (ctx, args) => {
    const request = ctx.db.normalizeId("verificationRequests", args.request);
    const row = request ? await ctx.db.get("verificationRequests", request) : null;
    if (!request || !row) return null;
    const verification = await ctx.db
      .query("verifications")
      .withIndex("by_request", (q) => q.eq("request", request))
      .first();
    const advance = row.advance ? await ctx.db.get("advances", row.advance) : null;
    const mandate = advance
      ? await ctx.db
          .query("mandates")
          .withIndex("by_advance", (q) => q.eq("advance", advance._id))
          .first()
      : null;
    let result;
    if (verification) {
      const { attestation } = JSON.parse(verification.attestation) as {
        attestation: IncomeAttestation;
      };
      result = {
        valid: verification.valid,
        firstPeriod: attestation.firstPeriod,
        months: attestation.months,
        pseudonym: verification.pseudonym,
        registryRoot: verification.registryRoot,
        verifiedAt: attestation.verifiedAt,
        ...(verification.paymentReceipt ? { paymentReference: verification.paymentReceipt } : {}),
      };
    }
    return {
      _id: row._id,
      _creationTime: row._creationTime,
      lenderName: row.lenderName,
      thresholdCents: row.thresholdCents,
      months: row.months,
      scope: row.scope,
      nonce: row.nonce,
      status: effectiveStatus(row, Date.now()),
      expiresAt: row.expiresAt,
      ...(result ? { result } : {}),
      ...(row.offer ? { offer: row.offer } : {}),
      ...(advance
        ? {
            advance: {
              _id: advance._id,
              advanceId: advance.advanceId,
              amount: advance.amount,
              owed: advance.owed,
              vault: advance.vault,
              status: advance.status,
              txHash: advance.txHash,
              ...(mandate
                ? {
                    installments: mandate.installments,
                    paidInstallments: mandate.paidInstallments,
                    remainingCents: mandate.remainingCents,
                  }
                : {}),
            },
          }
        : {}),
    };
  },
});

/** What the lender sends to the Verify API. */
export const forVerify = query({
  args: { request: v.id("verificationRequests") },
  returns: v.union(v.null(), v.object({ proof: v.string(), publicInputs: v.array(v.string()) })),
  handler: async (ctx, { request }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (row?.status !== "submitted" || !row.proof || !row.publicInputs) return null;
    return { proof: row.proof, publicInputs: row.publicInputs };
  },
});

export const loadForSubmit = internalQuery({
  args: { request: v.id("verificationRequests") },
  returns: v.union(
    v.null(),
    v.object({
      status: statusValidator,
      thresholdCents: v.number(),
      scope: v.string(),
      nonce: v.string(),
    }),
  ),
  handler: async (ctx, { request }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row) return null;
    return {
      status: effectiveStatus(row, Date.now()),
      thresholdCents: row.thresholdCents,
      scope: row.scope,
      nonce: row.nonce,
    };
  },
});

export const markSubmitted = internalMutation({
  args: {
    request: v.id("verificationRequests"),
    proof: v.string(),
    publicInputs: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { request, proof, publicInputs }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row || effectiveStatus(row, Date.now()) !== "open") return false;
    await ctx.db.patch("verificationRequests", request, {
      status: "submitted",
      proof,
      publicInputs,
    });
    return true;
  },
});

/**
 * Worker: answer a request with an Income Passport. Checked here for free (a view call to
 * IncomePassportVerifier) so only answers that will verify reach the lender's paid check.
 */
export const submit = action({
  args: {
    request: v.id("verificationRequests"),
    proof: v.string(),
    publicInputs: v.array(v.string()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (
    ctx,
    { request, proof, publicInputs },
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const row = await ctx.runQuery(internal.requests.loadForSubmit, { request });
    if (!row) return { ok: false as const, reason: "This request doesn't exist." };
    if (row.status === "expired") return { ok: false as const, reason: "This request expired." };
    if (row.status !== "open") {
      return { ok: false as const, reason: "This request was already answered." };
    }
    if (
      !/^0x[0-9a-fA-F]+$/.test(proof) ||
      proof.length > MAX_PROOF_HEX ||
      publicInputs.length !== PASSPORT_PUBLIC_INPUT_COUNT ||
      !publicInputs.every((x) => HEX32.test(x))
    ) {
      return { ok: false as const, reason: "That Income Passport is malformed." };
    }
    const p = decodePassportPublicInputs(publicInputs);
    if (
      p.scope !== BigInt(row.scope) ||
      p.nonce !== BigInt(row.nonce) ||
      p.threshold !== BigInt(row.thresholdCents)
    ) {
      return { ok: false as const, reason: "That Income Passport is for a different request." };
    }
    if (!isRecent(p.periods[p.periods.length - 1]!)) {
      return { ok: false as const, reason: "Those payslips are too old for this request." };
    }
    if (!(await passportIsValid(proof as Hex, publicInputs as Hex[]))) {
      return { ok: false as const, reason: "That Income Passport couldn't be verified." };
    }
    const saved: boolean = await ctx.runMutation(internal.requests.markSubmitted, {
      request,
      proof,
      publicInputs,
    });
    return saved ? { ok: true as const } : { ok: false as const, reason: "This request closed." };
  },
});

/**
 * Lender console: store the Verify API's answer. Only an attestation signed by the Sigilo
 * operator for this request's scope and nonce is accepted, so the caller needs no secret.
 * (An action: viem loads its curve code lazily, which mutations can't do.)
 */
export const record = action({
  args: {
    request: v.id("verificationRequests"),
    attestation: attestationValidator,
    signature: v.string(),
    paymentReference: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { request, attestation, signature, paymentReference }): Promise<null> => {
    const signed = { attestation: attestation as IncomeAttestation, signature: signature as Hex };
    if (!(await isSigiloAttestation(signed))) throw new ConvexError("Invalid attestation");
    await ctx.runMutation(internal.requests.saveVerification, {
      request,
      attestation,
      signed: JSON.stringify(signed),
      ...(paymentReference ? { paymentReference } : {}),
    });
    return null;
  },
});

export const saveVerification = internalMutation({
  args: {
    request: v.id("verificationRequests"),
    attestation: attestationValidator,
    signed: v.string(),
    paymentReference: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { request, attestation, signed, paymentReference }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row) throw new ConvexError("Unknown request");
    if (row.status !== "submitted") throw new ConvexError("Request is not awaiting verification");
    if (
      BigInt(attestation.scope) !== BigInt(row.scope) ||
      BigInt(attestation.nonce) !== BigInt(row.nonce) ||
      attestation.thresholdCents !== row.thresholdCents
    ) {
      throw new ConvexError("Attestation is for a different request");
    }
    await ctx.db.insert("verifications", {
      request,
      valid: attestation.valid,
      pseudonym: attestation.pseudonym,
      registryRoot: attestation.registryRoot,
      ...(paymentReference ? { paymentReceipt: paymentReference } : {}),
      attestation: signed,
    });
    await ctx.db.patch("verificationRequests", request, {
      status: attestation.valid ? "verified" : "rejected",
    });
    return null;
  },
});
