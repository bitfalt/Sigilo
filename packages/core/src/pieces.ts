// Fixed-denomination payouts (SPEC.md §6.1). Net pay is split into 1-2-5 pieces, each sent to
// its own one-time account and shuffled with every other employee's pieces, so observers can't
// attribute pieces, and therefore salaries, to workers.

import { COMMITTED_AMOUNT_DECIMALS } from "./constants";

/** $1,000 down to $0.01, in USD cents. */
export const PIECE_DENOMINATIONS_CENTS = [
  100_000n,
  50_000n,
  20_000n,
  10_000n,
  5_000n,
  2_000n,
  1_000n,
  500n,
  200n,
  100n,
  50n,
  20n,
  10n,
  5n,
  2n,
  1n,
] as const;

export const AUSD_DECIMALS = 6;
/** AUSD base units per USD cent. */
export const AUSD_PER_CENT = 10n ** BigInt(AUSD_DECIMALS - COMMITTED_AMOUNT_DECIMALS);

export const centsToAusd = (cents: bigint): bigint => cents * AUSD_PER_CENT;

/** Greedy split into denominations, largest first. $2,400 → [1000, 1000, 200, 200] dollars. */
export function splitIntoPieces(cents: bigint): bigint[] {
  if (cents < 0n) throw new RangeError("negative amount");
  const pieces: bigint[] = [];
  let rest = cents;
  for (const d of PIECE_DENOMINATIONS_CENTS) {
    while (rest >= d) {
      pieces.push(d);
      rest -= d;
    }
  }
  return pieces;
}

export class InsufficientFundsError extends Error {
  constructor(
    readonly available: bigint,
    readonly requested: bigint,
  ) {
    super(`insufficient funds: ${available} < ${requested}`);
    this.name = "InsufficientFundsError";
  }
}

/**
 * Pieces to spend for `amount` (same units as the balances): the fewest pieces, largest first;
 * the last one may be spent partially and its remainder stays where it is.
 */
export function selectPieces<T>(
  pieces: readonly { id: T; balance: bigint }[],
  amount: bigint,
): { id: T; amount: bigint }[] {
  if (amount <= 0n) throw new RangeError("amount must be positive");
  const sorted = pieces
    .filter((p) => p.balance > 0n)
    .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  const selected: { id: T; amount: bigint }[] = [];
  let rest = amount;
  for (const p of sorted) {
    if (rest === 0n) break;
    const take = p.balance < rest ? p.balance : rest;
    selected.push({ id: p.id, amount: take });
    rest -= take;
  }
  if (rest > 0n) {
    const available = sorted.reduce((sum, p) => sum + p.balance, 0n);
    throw new InsufficientFundsError(available, amount);
  }
  return selected;
}

/** Fisher–Yates with a CSPRNG; payout order must not reveal which pieces belong together. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
