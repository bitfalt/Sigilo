import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Sigilo data model (SPEC.md §10). Conventions:
// - Field elements, hashes, public keys and addresses are 0x-prefixed hex strings.
// - USD amounts are integer cents (`v.number()`, exact below 2^53).
// - AUSD amounts are base-unit decimal strings (6 decimals; bigint-safe).
// - Periods are month indexes (year * 12 + month - 1), as in the circuit.
// Nothing secret is stored: receipts are ciphertext only, and keys never leave the device.

const runStatus = v.union(
  v.literal("pending"),
  v.literal("paying"),
  v.literal("committing"),
  v.literal("done"),
  v.literal("failed"),
);

const requestStatus = v.union(
  v.literal("open"),
  v.literal("submitted"),
  v.literal("verified"),
  v.literal("rejected"),
  v.literal("expired"),
);

export default defineSchema({
  // A person with a Sigilo passkey (a worker, or family receiving money). Public identity only.
  accounts: defineTable({
    // Mera session key address; the subject of the session JWT.
    evmAddress: v.string(),
    // 66-byte hex: one-time-account spend ‖ view public keys (core/stealth.ts).
    paymentProfile: v.string(),
    // X25519 public key that receipts are encrypted to (core/receipts.ts).
    receiptPublicKey: v.string(),
    displayName: v.optional(v.string()),
  }).index("by_evmAddress", ["evmAddress"]),

  employers: defineTable({
    name: v.string(),
    // BN254 field element: the employer id in payroll leaves and SigiloRegistry.
    employerId: v.string(),
    // Mirrors SigiloRegistry.isVerifiedEmployer (KYB stand-in).
    verified: v.boolean(),
    // Custodial treasury (server-held key) that pays through SigiloPay.disperse.
    treasuryAddress: v.string(),
  }).index("by_employerId", ["employerId"]),

  employees: defineTable({
    employer: v.id("employers"),
    name: v.string(),
    monthlySalaryCents: v.number(),
    // Secret part of the invite link.
    inviteCode: v.string(),
    status: v.union(v.literal("invited"), v.literal("active")),
    // Set when the invite is accepted.
    account: v.optional(v.id("accounts")),
    // C = H(passportSecret), set when the worker activates their Income Passport.
    passportCommitment: v.optional(v.string()),
  })
    .index("by_employer", ["employer"])
    .index("by_inviteCode", ["inviteCode"])
    .index("by_account", ["account"]),

  payrollRuns: defineTable({
    employer: v.id("employers"),
    period: v.number(),
    status: runStatus,
    totalNetCents: v.number(),
    pieceCount: v.number(),
    payoutTxHash: v.optional(v.string()),
    runRoot: v.optional(v.string()),
    registryIndex: v.optional(v.number()),
    registryRoot: v.optional(v.string()),
    publishTxHash: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_employer_and_period", ["employer", "period"]),

  // Encrypted receipts: payslips, advances and money from family (SPEC.md F3.6).
  receipts: defineTable({
    account: v.id("accounts"),
    kind: v.union(v.literal("payslip"), v.literal("advance"), v.literal("transfer")),
    ciphertext: v.string(),
    run: v.optional(v.id("payrollRuns")),
  }).index("by_account", ["account"]),

  // Global append-only registry tree. Leaves are public; `index` is the tree position.
  registryLeaves: defineTable({
    index: v.number(),
    leaf: v.string(),
    run: v.id("payrollRuns"),
  }).index("by_index", ["index"]),

  // Lender requests, addressed by their unguessable `_id` (/v/[requestId]).
  verificationRequests: defineTable({
    lenderName: v.string(),
    // scope = verifierScope(lenderAddress, chainId) (core/scope.ts).
    lenderAddress: v.string(),
    thresholdCents: v.number(),
    months: v.number(),
    scope: v.string(),
    nonce: v.string(),
    status: requestStatus,
    proof: v.optional(v.string()),
    publicInputs: v.optional(v.array(v.string())),
    expiresAt: v.number(),
  }),

  verifications: defineTable({
    request: v.id("verificationRequests"),
    valid: v.boolean(),
    pseudonym: v.string(),
    registryRoot: v.string(),
    // MPP payment receipt for the paid Verify API.
    paymentReceipt: v.optional(v.string()),
    // Sigilo-signed result returned by /api/v1/verify.
    attestation: v.string(),
  }).index("by_request", ["request"]),

  // Signed EIP-712 payroll-deduction mandates (SPEC.md F7, P1).
  mandates: defineTable({
    employee: v.id("employees"),
    advanceId: v.string(),
    installmentCents: v.number(),
    installments: v.number(),
    paidInstallments: v.number(),
    vault: v.string(),
    signature: v.string(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("cancelled")),
  }).index("by_employee_and_status", ["employee", "status"]),

  // Cache of AdvanceVault state (P1).
  advances: defineTable({
    advanceId: v.string(),
    pseudonym: v.string(),
    amount: v.string(),
    outstanding: v.string(),
    recipient: v.string(),
    status: v.union(v.literal("active"), v.literal("closed")),
    txHash: v.string(),
  }).index("by_advanceId", ["advanceId"]),
});
