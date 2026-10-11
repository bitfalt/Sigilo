// SigiloPay.Dispersed: one payroll payout. The event has the payer, the piece count and the
// total; the pieces themselves come from the payout's calldata (see lib/disperse.ts).

import { indexer, type Denomination, type Piece } from "envio";

import { anonymityMetrics, denominationHistogram, unlinkedShare } from "../lib/anonymity";
import { decodePayout } from "../lib/disperse";
import { loadDay, loadStats } from "../lib/stats";

indexer.onEvent({ contract: "SigiloPay", event: "Dispersed" }, async ({ event, context }) => {
  const payer = event.params.payer;
  const timestamp = event.block.timestamp;
  const payout =
    decodePayout({
      input: event.transaction.input,
      txTo: event.transaction.to,
      sigiloPay: event.srcAddress,
      pieces: event.params.pieces,
      total: event.params.total,
    }) ?? [];
  const decoded = payout.length > 0 || event.params.pieces === 0n;
  const amounts = payout.map((p) => p.amount);
  const histogram = denominationHistogram(amounts);

  const [stats, day, employer, clash, denominations, existing] = await Promise.all([
    loadStats(context),
    loadDay(context, timestamp),
    context.Employer.get(payer),
    context.PayrollRun.get(event.transaction.hash),
    Promise.all(histogram.map((d) => context.Denomination.get(d.amount.toString()))),
    Promise.all(payout.map((p) => context.Piece.get(p.account))),
  ]);

  // One payout per transaction in practice; a contract batching several gets distinct ids.
  const runId = clash ? `${event.transaction.hash}-${event.logIndex}` : event.transaction.hash;
  const pieceCount = decoded ? payout.length : Number(event.params.pieces);
  const metrics = anonymityMetrics(amounts);

  context.PayrollRun.set({
    id: runId,
    txHash: event.transaction.hash,
    employer_id: payer,
    employerRunNumber: (employer?.runs ?? 0) + 1,
    blockNumber: event.block.number,
    timestamp,
    pieceCount,
    total: event.params.total,
    decoded,
    ...metrics,
    piecesSpent: 0,
    linkedPieces: 0,
    unlinkedShare: 1,
    largestExposure: 0n,
  });

  histogram.forEach((d, i) => {
    context.RunDenomination.set({
      id: `${runId}-${d.amount}`,
      run_id: runId,
      amount: d.amount,
      count: d.count,
    });
    const previous: Denomination = denominations[i] ?? {
      id: d.amount.toString(),
      amount: d.amount,
      issued: 0,
      spent: 0,
      volume: 0n,
      runs: 0,
    };
    context.Denomination.set({
      ...previous,
      issued: previous.issued + d.count,
      volume: previous.volume + d.amount * BigInt(d.count),
      runs: previous.runs + 1,
    });
  });

  payout.forEach((p, i) => {
    // Each piece goes to a brand-new account; if one was ever reused, keep its first payout.
    const before: Piece | undefined = existing[i];
    context.Piece.set(
      before
        ? { ...before, amount: before.amount + p.amount }
        : {
            id: p.account,
            source: "PAYROLL",
            run_id: runId,
            employer_id: payer,
            advance_id: undefined,
            amount: p.amount,
            receivedAt: timestamp,
            spentAmount: 0n,
            spendCount: 0,
            firstSpentAt: undefined,
            cluster_id: undefined,
            linked: false,
          },
    );
  });

  context.Employer.set({
    id: payer,
    runs: (employer?.runs ?? 0) + 1,
    pieces: (employer?.pieces ?? 0) + pieceCount,
    totalPaid: (employer?.totalPaid ?? 0n) + event.params.total,
    firstSeenAt: employer?.firstSeenAt ?? timestamp,
    lastRunAt: timestamp,
    advanceRepayments: employer?.advanceRepayments ?? 0,
    repaidToLenders: employer?.repaidToLenders ?? 0n,
    advancesRepaid: employer?.advancesRepaid ?? 0,
  });

  context.DailyActivity.set({
    ...day,
    payrollRuns: day.payrollRuns + 1,
    pieces: day.pieces + pieceCount,
    paidVolume: day.paidVolume + event.params.total,
  });

  const pieces = stats.pieces + payout.length;
  context.NetworkStats.set({
    ...stats,
    // An account that only repaid advances so far becomes a payroll employer now.
    employers: stats.employers + (employer && employer.runs > 0 ? 0 : 1),
    payrollRuns: stats.payrollRuns + 1,
    pieces,
    paidVolume: stats.paidVolume + event.params.total,
    unlinkedShare: unlinkedShare(stats.linkedPieces, pieces),
    updatedAt: timestamp,
  });
});
