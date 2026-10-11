// Sigilo's backend as an external system: GET /cre/payday (apps/web/convex/cre.ts) serves the
// public registry leaves and, per payroll-deducted advance, what should have been repaid by now.
// Every DON node fetches it, validates it strictly, and rebuilds the registry tree itself; only
// the small derived observation goes through consensus (identical aggregation).

import { type HTTPSendRequester, json, ok } from "@chainlink/cre-sdk";
import { z } from "zod";

import { BN254_R, coveringPrefix, fieldToHex, prefixCandidates, registryRoot } from "./registry";

const UINT96_MAX = (1n << 96n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const UINT32_MAX = 2 ** 32 - 1;

const field = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "leaf must be 32-byte hex")
  .transform((s) => BigInt(s))
  .refine((x) => x < BN254_R, "leaf is not a BN254 field element");

const decimal = (max: bigint, what: string) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/, `${what} must be a base-10 integer string`)
    .transform((s) => BigInt(s))
    .refine((x) => x <= max, `${what} is out of range`);

const advanceDue = z
  .object({
    vault: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "vault must be an address"),
    advanceId: decimal(UINT256_MAX, "advanceId").refine((x) => x > 0n, "advanceId starts at 1"),
    expectedRepaid: decimal(UINT96_MAX, "expectedRepaid"),
    period: z.number().int().min(1).max(UINT32_MAX),
  })
  .strict();

const paydayBody = z
  .object({ leaves: z.array(field).max(2 ** 16), advances: z.array(advanceDue) })
  .strict();

export type AdvanceDue = z.output<typeof advanceDue>;
export type PaydayBody = z.output<typeof paydayBody>;

/** Validates the endpoint's JSON. Throws (fails closed) on anything unexpected. */
export function parsePaydayBody(body: unknown, maxAdvances: number): PaydayBody {
  const parsed = paydayBody.parse(body);
  if (parsed.advances.length > maxAdvances) {
    throw new Error(`backend listed ${parsed.advances.length} advances, max is ${maxAdvances}`);
  }
  const seen = new Set<string>();
  for (const a of parsed.advances) {
    const key = `${a.vault.toLowerCase()}:${a.advanceId}`;
    if (seen.has(key)) throw new Error(`duplicate advance ${key}`);
    seen.add(key);
  }
  return parsed;
}

/** What each node reports for consensus. Strings and numbers only, so it serializes exactly. */
export type BackendObservation = {
  leafCount: number;
  /** Root of every leaf served, 32-byte hex. */
  fullRoot: string;
  /** How many leaves hash to the target root (0 = none of the candidates do, or no target). */
  matchedLeafCount: number;
  advances: { vault: string; advanceId: string; expectedRepaid: string; period: number }[];
};

/** Pure part of the node work, separate from HTTP so it is testable. */
export function observe(
  body: PaydayBody,
  targetRoot: string,
  hint: number,
  window: number,
): BackendObservation {
  const total = body.leaves.length;
  const target = BigInt(targetRoot);
  const matched =
    target === 0n
      ? 0
      : coveringPrefix(
          body.leaves,
          target,
          prefixCandidates(total, hint > 0 ? hint : undefined, window),
        );
  return {
    leafCount: total,
    fullRoot: fieldToHex(registryRoot(body.leaves)),
    matchedLeafCount: matched,
    advances: body.advances.map((a) => ({
      vault: a.vault,
      advanceId: a.advanceId.toString(),
      expectedRepaid: a.expectedRepaid.toString(),
      period: a.period,
    })),
  };
}

/**
 * Node-mode callback for HTTPClient.sendRequest: fetch, validate, rebuild the tree.
 * `targetRoot` is the on-chain root to look for (0x0 for none) and `hint` the expected leaf count.
 */
export function fetchObservation(
  sender: HTTPSendRequester,
  url: string,
  targetRoot: string,
  hint: number,
  window: number,
  maxAdvances: number,
): BackendObservation {
  const response = sender
    .sendRequest({ url, method: "GET", headers: { Accept: "application/json" } })
    .result();
  if (!ok(response)) throw new Error(`Sigilo backend answered HTTP ${response.statusCode}`);
  return observe(parsePaydayBody(json(response), maxAdvances), targetRoot, hint, window);
}
