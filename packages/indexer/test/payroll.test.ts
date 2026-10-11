import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import { account, CHAIN_ID, payroll, txHash, usd } from "./helpers";

const acme = account("acme");
// María nets $2,400, José $1,205.07: their 1-2-5 pieces, shuffled together.
const maria = [1000, 1000, 200, 200].map((d, i) => ({
  account: account(`maria-${i}`),
  amount: usd(d),
}));
const jose = [1000, 200, 5, 0.05, 0.02].map((d, i) => ({
  account: account(`jose-${i}`),
  amount: usd(d),
}));
const pieces = [
  maria[2]!,
  jose[0]!,
  maria[0]!,
  jose[3]!,
  maria[3]!,
  jose[1]!,
  maria[1]!,
  jose[2]!,
  jose[4]!,
];

describe("payroll runs", () => {
  it("decodes the payout and measures what a stranger sees", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { [CHAIN_ID]: { simulate: [payroll({ step: 1, payer: acme, pieces })] } },
    });

    const run = await indexer.PayrollRun.getOrThrow(txHash("payroll-1"));
    t.expect(run).toMatchObject({
      employer_id: acme,
      employerRunNumber: 1,
      pieceCount: 9,
      total: usd(3605.07),
      decoded: true,
      distinctAmounts: 5,
      largestGroup: 3,
      largestGroupAmount: usd(1000),
      uniquePieces: 3,
      meanAnonymitySet: 21 / 9,
      piecesSpent: 0,
      linkedPieces: 0,
      unlinkedShare: 1,
    });

    const sizes = await indexer.RunDenomination.getAll();
    const histogram = [...sizes].sort((a, b) => Number(b.amount - a.amount));
    t.expect(histogram.map((d) => [d.amount, d.count])).toEqual([
      [usd(1000), 3],
      [usd(200), 3],
      [usd(5), 1],
      [usd(0.05), 1],
      [usd(0.02), 1],
    ]);

    t.expect(await indexer.Piece.getOrThrow(maria[0]!.account)).toMatchObject({
      source: "PAYROLL",
      run_id: run.id,
      employer_id: acme,
      amount: usd(1000),
      linked: false,
      cluster_id: undefined,
    });
    t.expect(await indexer.Employer.getOrThrow(acme)).toMatchObject({
      runs: 1,
      pieces: 9,
      totalPaid: usd(3605.07),
    });
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      employers: 1,
      payrollRuns: 1,
      pieces: 9,
      paidVolume: usd(3605.07),
      unlinkedShare: 1,
    });
  });

  it("counts every run of the same company and every size across runs", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN_ID]: {
          simulate: [
            payroll({ step: 1, payer: acme, pieces }),
            payroll({
              step: 2,
              payer: acme,
              pieces: pieces.map((p, i) => ({ ...p, account: account(`feb-${i}`) })),
            }),
          ],
        },
      },
    });
    t.expect(await indexer.PayrollRun.getOrThrow(txHash("payroll-2"))).toMatchObject({
      employerRunNumber: 2,
    });
    t.expect(await indexer.Employer.getOrThrow(acme)).toMatchObject({ runs: 2, pieces: 18 });
    t.expect(await indexer.Denomination.getOrThrow(String(usd(1000)))).toMatchObject({
      issued: 6,
      spent: 0,
      volume: usd(6000),
      runs: 2,
    });
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      employers: 1,
      payrollRuns: 2,
      pieces: 18,
    });
  });

  it("doesn't attribute pieces of a payout made through another contract", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN_ID]: {
          simulate: [payroll({ step: 1, payer: acme, pieces, txTo: account("some-router") })],
        },
      },
    });
    t.expect(await indexer.PayrollRun.getOrThrow(txHash("payroll-1"))).toMatchObject({
      decoded: false,
      pieceCount: 9,
      total: usd(3605.07),
      distinctAmounts: 0,
    });
    t.expect(await indexer.Piece.getAll()).toEqual([]);
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      payrollRuns: 1,
      pieces: 0,
    });
  });
});
