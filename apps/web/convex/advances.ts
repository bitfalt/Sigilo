import {
  advanceNonce,
  DEMO_ADVANCE_TERMS,
  maxAdvance,
  recoverMandateSigner,
} from "@sigilo/core/advance";
import { MONAD_TESTNET_CHAIN_ID } from "@sigilo/core/constants";
import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { decodePassportPublicInputs, PASSPORT_PUBLIC_INPUT_COUNT } from "@sigilo/core/passport";
import { verifierScope } from "@sigilo/core/scope";
import { ConvexError, v } from "convex/values";
import type { Hex } from "viem";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { findAccount, HEX32, requireEmployer } from "./lib/identity";
import { relayRequestAdvance } from "./lib/operator";

// Payroll-deducted salary advances (SPEC.md F7). After a verified income check the lender offers
// an advance; the worker proves her income again for the AdvanceVault's own scope, and the
// operator relays AdvanceVault.requestAdvance (she holds no gas). She then signs a deduction
// mandate, and her employer's payroll repays the vault in installments. The employer and the
// lender know about the advance, as with any payroll deduction; nobody else does.

const AUSD_PER_CENT = 10_000n;
const MAX_INSTALLMENTS = 6;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Lender console: offer an advance on a verified check (at most the vault's cap). */
export const offer = mutation({
  args: {
    request: v.id("verificationRequests"),
    amountCents: v.number(),
    installments: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { request, amountCents, installments }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row || row.status !== "verified") throw new ConvexError("Verify the income first");
    if (row.advance) throw new ConvexError("This applicant already took an advance");
    if (row.offerDeclined) throw new ConvexError("The applicant declined the offer");
    const cap = Number(
      maxAdvance(BigInt(row.thresholdCents), DEMO_ADVANCE_TERMS.maxRatioBps) / AUSD_PER_CENT,
    );
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > cap) {
      throw new ConvexError(`Offer between $1 and $${(cap / 100).toFixed(2)}`);
    }
    if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) {
      throw new ConvexError(`Choose 1 to ${MAX_INSTALLMENTS} paychecks`);
    }
    await ctx.db.patch("verificationRequests", request, {
      offer: { amountCents, installments, feeBps: DEMO_ADVANCE_TERMS.feeBps },
    });
    return null;
  },
});

/** Applicant: say no to the offer. The request id is the capability, as for answering it. */
export const decline = mutation({
  args: { request: v.id("verificationRequests") },
  returns: v.null(),
  handler: async (ctx, { request }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row?.offer) throw new ConvexError("There's no advance offer on this check");
    if (row.advance) throw new ConvexError("This advance was already taken");
    await ctx.db.patch("verificationRequests", request, { offerDeclined: true });
    return null;
  },
});

export const loadOffer = internalQuery({
  args: { request: v.id("verificationRequests") },
  returns: v.union(
    v.null(),
    v.object({
      lenderName: v.string(),
      amountCents: v.number(),
      installments: v.number(),
      taken: v.boolean(),
      declined: v.boolean(),
    }),
  ),
  handler: async (ctx, { request }) => {
    const row = await ctx.db.get("verificationRequests", request);
    if (!row?.offer) return null;
    return {
      lenderName: row.lenderName,
      amountCents: row.offer.amountCents,
      installments: row.offer.installments,
      taken: !!row.advance,
      declined: !!row.offerDeclined,
    };
  },
});

export const saveAdvance = internalMutation({
  args: {
    request: v.id("verificationRequests"),
    address: v.string(),
    advanceId: v.string(),
    pseudonym: v.string(),
    amount: v.string(),
    owed: v.string(),
    recipient: v.string(),
    txHash: v.string(),
    receipt: v.string(),
  },
  returns: v.id("advances"),
  handler: async (ctx, args) => {
    const advance = await ctx.db.insert("advances", {
      advanceId: args.advanceId,
      vault: SIGILO_TESTNET.advanceVault,
      pseudonym: args.pseudonym,
      amount: args.amount,
      owed: args.owed,
      recipient: args.recipient,
      request: args.request,
      status: "active",
      txHash: args.txHash,
    });
    await ctx.db.patch("verificationRequests", args.request, { advance });
    const account = await findAccount(ctx, args.address);
    if (account) {
      await ctx.db.insert("receipts", {
        account: account._id,
        kind: "advance",
        ciphertext: args.receipt,
      });
    }
    return advance;
  },
});

/**
 * Worker: take the offered advance. The proof is for the vault's scope and its nonce commits to
 * the recipient, amount, deadline and salt, so nobody can redirect it on the way.
 */
export const take = action({
  args: {
    request: v.id("verificationRequests"),
    proof: v.string(),
    publicInputs: v.array(v.string()),
    amount: v.string(),
    recipient: v.string(),
    deadline: v.number(),
    salt: v.string(),
    receipt: v.string(),
  },
  returns: v.object({ advance: v.id("advances"), advanceId: v.string(), owed: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ advance: Id<"advances">; advanceId: string; owed: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const offer = await ctx.runQuery(internal.advances.loadOffer, { request: args.request });
    if (!offer) throw new ConvexError("There's no advance offer on this check");
    if (offer.taken) throw new ConvexError("This advance was already taken");
    if (offer.declined) throw new ConvexError("You declined this offer");
    if (
      !/^\d+$/.test(args.amount) ||
      BigInt(args.amount) !== BigInt(offer.amountCents) * AUSD_PER_CENT ||
      !ADDRESS.test(args.recipient) ||
      !HEX32.test(args.salt) ||
      !/^0x[0-9a-fA-F]+$/.test(args.proof) ||
      args.publicInputs.length !== PASSPORT_PUBLIC_INPUT_COUNT ||
      !args.publicInputs.every((x) => HEX32.test(x)) ||
      args.receipt.length > 8_000
    ) {
      throw new ConvexError("Invalid advance request");
    }
    const now = Math.floor(Date.now() / 1000);
    if (args.deadline <= now || args.deadline > now + 30 * 60) {
      throw new ConvexError("This request expired. Try again.");
    }
    const p = decodePassportPublicInputs(args.publicInputs);
    const vaultScope = verifierScope(SIGILO_TESTNET.advanceVault, MONAD_TESTNET_CHAIN_ID);
    const nonce = advanceNonce(
      args.recipient as Hex,
      BigInt(args.amount),
      BigInt(args.deadline),
      args.salt as Hex,
    );
    if (p.scope !== vaultScope || p.nonce !== nonce) {
      throw new ConvexError("That Income Passport isn't for this advance");
    }

    let issued;
    try {
      issued = await relayRequestAdvance({
        proof: args.proof as Hex,
        publicInputs: args.publicInputs as Hex[],
        amount: BigInt(args.amount),
        recipient: args.recipient as Hex,
        deadline: BigInt(args.deadline),
        salt: args.salt as Hex,
      });
    } catch (e) {
      console.error("requestAdvance failed", String(e).slice(0, 500));
      throw new ConvexError("The advance didn't go through. Nothing was sent.");
    }
    const advance: Id<"advances"> = await ctx.runMutation(internal.advances.saveAdvance, {
      request: args.request,
      address: identity.subject,
      advanceId: issued.advanceId.toString(),
      pseudonym: `0x${p.pseudonym.toString(16).padStart(64, "0")}`,
      amount: args.amount,
      owed: issued.owed.toString(),
      recipient: args.recipient,
      txHash: issued.hash,
      receipt: args.receipt,
    });
    return { advance, advanceId: issued.advanceId.toString(), owed: issued.owed.toString() };
  },
});

export const loadAdvance = internalQuery({
  args: { advance: v.id("advances") },
  returns: v.union(
    v.null(),
    v.object({
      advanceId: v.string(),
      vault: v.string(),
      owed: v.string(),
      lenderName: v.string(),
    }),
  ),
  handler: async (ctx, { advance }) => {
    const row = await ctx.db.get("advances", advance);
    if (!row) return null;
    const request = row.request ? await ctx.db.get("verificationRequests", row.request) : null;
    return {
      advanceId: row.advanceId,
      vault: row.vault,
      owed: row.owed,
      lenderName: request?.lenderName ?? "",
    };
  },
});

export const saveMandate = internalMutation({
  args: {
    address: v.string(),
    advance: v.id("advances"),
    advanceId: v.string(),
    lenderName: v.string(),
    employerId: v.string(),
    installmentCents: v.number(),
    installments: v.number(),
    owedCents: v.number(),
    vault: v.string(),
    deadline: v.number(),
    signature: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await findAccount(ctx, args.address);
    if (!account) throw new ConvexError("Account not set up");
    const employer = await ctx.db
      .query("employers")
      .withIndex("by_employerId", (q) => q.eq("employerId", args.employerId.toLowerCase()))
      .unique();
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_account", (q) => q.eq("account", account._id))
      .take(16);
    const employee = rows.find((r) => employer && r.employer === employer._id);
    if (!employee) throw new ConvexError("You don't work for that employer");
    const existing = await ctx.db
      .query("mandates")
      .withIndex("by_advance", (q) => q.eq("advance", args.advance))
      .first();
    if (existing) return null;
    await ctx.db.insert("mandates", {
      employee: employee._id,
      advance: args.advance,
      advanceId: args.advanceId,
      lenderName: args.lenderName,
      installmentCents: args.installmentCents,
      installments: args.installments,
      paidInstallments: 0,
      remainingCents: args.owedCents,
      vault: args.vault,
      deadline: args.deadline,
      signature: args.signature,
      status: "active",
    });
    return null;
  },
});

/**
 * Worker: authorize her employer to deduct the installments (EIP-712 DeductionMandate signed
 * with her session key, no prompt). Checked here, and again by the employer before paying.
 */
export const authorize = action({
  args: {
    advance: v.id("advances"),
    employerId: v.string(),
    installment: v.string(),
    installments: v.number(),
    deadline: v.number(),
    signature: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const advance = await ctx.runQuery(internal.advances.loadAdvance, { advance: args.advance });
    if (!advance) throw new ConvexError("Unknown advance");
    if (!/^\d+$/.test(args.installment) || !HEX32.test(args.employerId)) {
      throw new ConvexError("Invalid mandate");
    }
    const installment = BigInt(args.installment);
    const owed = BigInt(advance.owed);
    const n = BigInt(args.installments);
    if (
      n < 1n ||
      n > BigInt(MAX_INSTALLMENTS) ||
      installment % AUSD_PER_CENT !== 0n ||
      installment * n < owed ||
      installment * (n - 1n) >= owed
    ) {
      throw new ConvexError("The installments don't add up to the advance");
    }
    const signer = await recoverMandateSigner({
      mandate: {
        vault: advance.vault as Hex,
        advanceId: BigInt(advance.advanceId),
        installment,
        installments: args.installments,
        deadline: BigInt(args.deadline),
      },
      signature: args.signature as Hex,
    });
    if (signer.toLowerCase() !== identity.subject.toLowerCase()) {
      throw new ConvexError("The mandate isn't signed by you");
    }
    await ctx.runMutation(internal.advances.saveMandate, {
      address: identity.subject,
      advance: args.advance,
      advanceId: advance.advanceId,
      lenderName: advance.lenderName,
      employerId: args.employerId,
      installmentCents: Number(installment / AUSD_PER_CENT),
      installments: args.installments,
      owedCents: Number((owed + AUSD_PER_CENT - 1n) / AUSD_PER_CENT),
      vault: advance.vault,
      deadline: args.deadline,
      signature: args.signature,
    });
    return null;
  },
});

/** Employer payroll: active deduction mandates for this employer's people. */
export const forPayroll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("mandates"),
      employee: v.id("employees"),
      advanceId: v.string(),
      vault: v.string(),
      lenderName: v.string(),
      installmentCents: v.number(),
      installments: v.number(),
      paidInstallments: v.number(),
      remainingCents: v.number(),
      deadline: v.number(),
      signature: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const employer = await requireEmployer(ctx);
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_employer", (q) => q.eq("employer", employer._id))
      .take(256);
    const out = [];
    for (const e of employees) {
      const mandates = await ctx.db
        .query("mandates")
        .withIndex("by_employee_and_status", (q) => q.eq("employee", e._id).eq("status", "active"))
        .take(8);
      for (const m of mandates) {
        out.push({
          _id: m._id,
          employee: m.employee,
          advanceId: m.advanceId,
          vault: m.vault,
          lenderName: m.lenderName,
          installmentCents: m.installmentCents,
          installments: m.installments,
          paidInstallments: m.paidInstallments,
          remainingCents: m.remainingCents,
          deadline: m.deadline,
          signature: m.signature,
        });
      }
    }
    return out;
  },
});

/** Employer payroll: an installment was paid to the vault in this run. */
export const recordRepayment = mutation({
  args: { mandate: v.id("mandates"), paidCents: v.number(), txHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { mandate, paidCents }) => {
    const employer = await requireEmployer(ctx);
    const row = await ctx.db.get("mandates", mandate);
    if (!row || row.status !== "active") throw new ConvexError("Unknown mandate");
    const employee = await ctx.db.get("employees", row.employee);
    if (employee?.employer !== employer._id) throw new ConvexError("Unknown mandate");
    if (!Number.isInteger(paidCents) || paidCents <= 0) throw new ConvexError("Invalid amount");
    const remainingCents = Math.max(0, row.remainingCents - paidCents);
    const done = remainingCents === 0;
    await ctx.db.patch("mandates", mandate, {
      paidInstallments: row.paidInstallments + 1,
      remainingCents,
      status: done ? "completed" : "active",
    });
    if (done) await ctx.db.patch("advances", row.advance, { status: "closed" });
    return null;
  },
});
