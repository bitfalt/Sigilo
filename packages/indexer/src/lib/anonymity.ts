// What a stranger learns from one payroll payout, before anyone spends anything.
//
// A payout is N pieces, shuffled, each to a brand-new account. The only handle an observer has
// on a piece is its amount, so a piece hides among the other pieces of the same size: that group
// is its anonymity set. Pieces of a size nobody else got stand out.

export interface DenominationCount {
  amount: bigint;
  count: number;
}

/** Pieces per amount, largest amount first. */
export function denominationHistogram(amounts: readonly bigint[]): DenominationCount[] {
  const counts = new Map<bigint, number>();
  for (const amount of amounts) counts.set(amount, (counts.get(amount) ?? 0) + 1);
  return [...counts.entries()]
    .map(([amount, count]) => ({ amount, count }))
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
}

export interface AnonymityMetrics {
  distinctAmounts: number;
  /** The most pieces sharing one amount (ties: the larger amount). */
  largestGroup: number;
  largestGroupAmount: bigint;
  /** Pieces whose amount appears once. */
  uniquePieces: number;
  /** Average size of a piece's anonymity set: sum(count²) / N. 0 for an empty payout. */
  meanAnonymitySet: number;
}

export function anonymityMetrics(amounts: readonly bigint[]): AnonymityMetrics {
  const histogram = denominationHistogram(amounts);
  let largest: DenominationCount | undefined;
  let uniquePieces = 0;
  let sumOfSquares = 0;
  for (const d of histogram) {
    if (!largest || d.count > largest.count) largest = d;
    if (d.count === 1) uniquePieces += 1;
    sumOfSquares += d.count * d.count;
  }
  return {
    distinctAmounts: histogram.length,
    largestGroup: largest?.count ?? 0,
    largestGroupAmount: largest?.amount ?? 0n,
    uniquePieces,
    meanAnonymitySet: amounts.length === 0 ? 0 : sumOfSquares / amounts.length,
  };
}

/** Share of `whole` not in `part`, in [0, 1]; 1 when there is nothing to measure. */
export function unlinkedShare(linked: number, whole: number): number {
  return whole === 0 ? 1 : Math.max(0, whole - linked) / whole;
}
