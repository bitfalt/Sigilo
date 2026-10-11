import { describe, expect, it } from "vitest";

import { anonymityMetrics, denominationHistogram, unlinkedShare } from "../src/lib/anonymity";

const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

describe("anonymity metrics", () => {
  // Two workers on $2,400 and $1,205.07 net, split into 1-2-5 pieces and shuffled together.
  const payout = [...[1000, 1000, 200, 200], ...[1000, 200, 5, 0.05, 0.02]].map(usd);

  it("groups a payout by piece size, largest first", () => {
    expect(denominationHistogram(payout)).toEqual([
      { amount: usd(1000), count: 3 },
      { amount: usd(200), count: 3 },
      { amount: usd(5), count: 1 },
      { amount: usd(0.05), count: 1 },
      { amount: usd(0.02), count: 1 },
    ]);
  });

  it("measures how well each piece hides", () => {
    expect(anonymityMetrics(payout)).toEqual({
      distinctAmounts: 5,
      largestGroup: 3,
      largestGroupAmount: usd(1000),
      uniquePieces: 3,
      // (3² + 3² + 1 + 1 + 1) / 9
      meanAnonymitySet: 21 / 9,
    });
  });

  it("handles an empty payout", () => {
    expect(anonymityMetrics([])).toEqual({
      distinctAmounts: 0,
      largestGroup: 0,
      largestGroupAmount: 0n,
      uniquePieces: 0,
      meanAnonymitySet: 0,
    });
  });

  it("reports the unlinked share", () => {
    expect(unlinkedShare(0, 0)).toBe(1);
    expect(unlinkedShare(3, 12)).toBe(0.75);
    expect(unlinkedShare(12, 12)).toBe(0);
  });
});
