// Spending: SigiloPay.collect / sendHome pull each piece with an AUSD ERC-3009
// receiveWithAuthorization (an AUSD Transfer piece → SigiloPay), then emit one Paid event in the
// same transaction. The Transfer handler stages the pulls per transaction; the Paid handler turns
// them into a Spend and runs the linkage analysis (lib/linkage.ts).

import {
  indexer,
  type Cluster,
  type Denomination,
  type Enum,
  type Exposure,
  type PayrollRun,
  type Piece,
} from "envio";

import { unlinkedShare } from "../lib/anonymity";
import { exposureId, link } from "../lib/linkage";
import { loadDay, loadStats, maxBig } from "../lib/stats";

const SIGILO_PAY = indexer.chains.monadTestnet.SigiloPay.addresses;
const ACTION_COLLECT = 0n;

// ------------------------------------------------------------------ pulls into SigiloPay

indexer.onEvent(
  {
    contract: "AUSD",
    event: "Transfer",
    // Only transfers into SigiloPay: each one is a piece being spent.
    where: { params: [{ to: SIGILO_PAY }] },
  },
  async ({ event, context }) => {
    if (!SIGILO_PAY.includes(event.params.to)) return;
    const id = event.transaction.hash;
    const pending = await context.PendingPulls.get(id);
    context.PendingPulls.set({
      id,
      accounts: [...(pending?.accounts ?? []), event.params.from],
      amounts: [...(pending?.amounts ?? []), event.params.value],
      consumed: pending?.consumed ?? 0,
    });
  },
);

// ------------------------------------------------------------------ the payment

indexer.onEvent({ contract: "SigiloPay", event: "Paid" }, async ({ event, context }) => {
  const { intentHash, action, to, total, amountOut } = event.params;
  const txHash = event.transaction.hash;
  const timestamp = event.block.timestamp;
  const kind: Enum<"SpendKind"> = action === ACTION_COLLECT ? "COLLECT" : "SEND_HOME";

  // This payment's pulls: everything staged in this transaction since the previous Paid.
  const pending = await context.PendingPulls.get(txHash);
  const from = pending?.consumed ?? 0;
  const pulls = (pending?.accounts ?? []).slice(from).map((account, i) => ({
    account,
    amount: pending!.amounts[from + i]!,
  }));
  if (pending) context.PendingPulls.set({ ...pending, consumed: pending.accounts.length });

  const [stats, day, destination, known, fundedBy] = await Promise.all([
    loadStats(context),
    loadDay(context, timestamp),
    context.Destination.get(to),
    Promise.all(pulls.map((p) => context.Piece.get(p.account))),
    Promise.all(pulls.map((p) => context.Destination.get(p.account))),
  ]);
  if (pulls.length > 0 && pulls.reduce((s, p) => s + p.amount, 0n) !== total) {
    context.log.warn(`Paid ${intentHash}: pulled pieces don't add up to the total`);
  }

  // Inputs as they were before this payment. An account Sigilo didn't fund through a payout or
  // an advance either received an earlier Sigilo payment or was funded off the record.
  const inputs: Piece[] = pulls.map(
    (p, i) =>
      known[i] ?? {
        id: p.account,
        source: fundedBy[i] ? "PAYMENT" : "UNKNOWN",
        run_id: undefined,
        employer_id: undefined,
        advance_id: undefined,
        amount: 0n,
        receivedAt: timestamp,
        spentAmount: 0n,
        spendCount: 0,
        firstSpentAt: undefined,
        cluster_id: undefined,
        linked: false,
      },
  );

  // Load what the linkage needs: the inputs' clusters, their other members and exposures.
  const clusterIds = [...new Set(inputs.flatMap((p) => (p.cluster_id ? [p.cluster_id] : [])))];
  const clusters = (await Promise.all(clusterIds.map((id) => context.Cluster.get(id)))).filter(
    (c): c is Cluster => c !== undefined,
  );
  const inputIds = new Set(inputs.map((p) => p.id));
  const memberIds = [...new Set(clusters.flatMap((c) => c.pieceIds))].filter(
    (id) => !inputIds.has(id),
  );
  const [members, exposures] = await Promise.all([
    Promise.all(memberIds.map((id) => context.Piece.get(id))),
    Promise.all(
      clusters.flatMap((c) => c.runIds.map((r) => context.Exposure.get(exposureId(c.id, r)))),
    ),
  ]);

  const result = link({
    paymentId: intentHash,
    timestamp,
    volume: total,
    inputs,
    clusters,
    members: members.filter((p): p is Piece => p !== undefined),
    exposures: exposures.filter((e): e is Exposure => e !== undefined && e.active),
  });

  // Runs whose numbers move: the inputs' (spent) and the cluster's (linked, exposed).
  const runIds = [
    ...new Set([...inputs.flatMap((p) => (p.run_id ? [p.run_id] : [])), ...result.cluster.runIds]),
  ];
  const denominationIds = [
    ...new Set(
      inputs.filter((p) => p.source === "PAYROLL" && p.spendCount === 0).map((p) => `${p.amount}`),
    ),
  ];
  const [runList, denominationList, moved] = await Promise.all([
    Promise.all(runIds.map((id) => context.PayrollRun.get(id))),
    Promise.all(denominationIds.map((id) => context.Denomination.get(id))),
    Promise.all(result.movedPayments.map((id) => context.Spend.get(id))),
  ]);
  const runs = new Map<string, PayrollRun>();
  runList.forEach((r) => r && runs.set(r.id, r));
  const denominations = new Map<string, Denomination>();
  denominationList.forEach((d) => d && denominations.set(d.id, d));

  // ---- spend accounting per input
  const pieces = new Map(result.pieces.map((p) => [p.id, p]));
  let piecesSpent = 0;
  let partialInputs = 0;
  pulls.forEach((pull, i) => {
    const before = inputs[i]!;
    const piece = pieces.get(before.id)!;
    const spentAmount = piece.spentAmount + pull.amount;
    const emptied = piece.amount > 0n && spentAmount >= piece.amount;
    if (!emptied) partialInputs += 1;
    pieces.set(piece.id, {
      ...piece,
      spentAmount,
      spendCount: piece.spendCount + 1,
      firstSpentAt: piece.firstSpentAt ?? timestamp,
    });
    context.SpendInput.set({
      id: `${intentHash}-${i}`,
      spend_id: intentHash,
      piece_id: piece.id,
      amount: pull.amount,
      emptied,
    });
    if (before.spendCount > 0 || before.source !== "PAYROLL") return;
    piecesSpent += 1;
    const run = before.run_id ? runs.get(before.run_id) : undefined;
    if (run) runs.set(run.id, { ...run, piecesSpent: run.piecesSpent + 1 });
    const d = denominations.get(`${before.amount}`);
    if (d) denominations.set(d.id, { ...d, spent: d.spent + 1 });
  });

  // ---- linkage per run
  const newlyLinkedPayroll = result.newlyLinked.filter((p) => p.source === "PAYROLL");
  for (const p of newlyLinkedPayroll) {
    const run = p.run_id ? runs.get(p.run_id) : undefined;
    if (run) runs.set(run.id, { ...run, linkedPieces: run.linkedPieces + 1 });
  }
  for (const e of result.exposures) {
    const run = runs.get(e.run_id);
    if (run && e.active)
      runs.set(run.id, { ...run, largestExposure: maxBig(run.largestExposure, e.amount) });
  }
  for (const run of runs.values()) {
    context.PayrollRun.set({
      ...run,
      unlinkedShare: unlinkedShare(run.linkedPieces, run.pieceCount),
    });
  }
  for (const d of denominations.values()) context.Denomination.set(d);
  for (const p of pieces.values()) context.Piece.set(p);
  for (const e of result.exposures) context.Exposure.set(e);
  for (const c of result.absorbed) context.Cluster.set(c);
  context.Cluster.set(result.cluster);
  for (const s of moved) if (s) context.Spend.set({ ...s, cluster_id: result.cluster.id });

  // ---- the payment
  const inputRuns = new Set(inputs.flatMap((p) => (p.run_id ? [p.run_id] : [])));
  context.Spend.set({
    id: intentHash,
    kind,
    txHash,
    blockNumber: event.block.number,
    timestamp,
    recipient: to,
    destination_id: to,
    total,
    amountOut,
    inputCount: pulls.length,
    partialInputs,
    runsLinked: inputRuns.size,
    newlyLinkedPieces: newlyLinkedPayroll.length,
    cluster_id: result.cluster.id,
  });
  context.Destination.set({
    id: to,
    spends: (destination?.spends ?? 0) + 1,
    received: (destination?.received ?? 0n) + (kind === "COLLECT" ? amountOut : 0n),
    ctkReceived: (destination?.ctkReceived ?? 0n) + (kind === "SEND_HOME" ? amountOut : 0n),
    firstSeenAt: destination?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
  });

  context.DailyActivity.set({
    ...day,
    spends: day.spends + 1,
    spentVolume: day.spentVolume + total,
    sendHomes: day.sendHomes + (kind === "SEND_HOME" ? 1 : 0),
  });

  const wasMulti = (c: Cluster | undefined, field: "runCount" | "employerCount") =>
    c !== undefined && c[field] >= 2 ? 1 : 0;
  const before = result.created ? undefined : clusters.find((c) => c.id === result.cluster.id);
  const multiDelta = (field: "runCount" | "employerCount") =>
    wasMulti(result.cluster, field) -
    wasMulti(before, field) -
    clusters.filter((c) => c.id !== result.cluster.id).reduce((n, c) => n + wasMulti(c, field), 0);
  const linkedPieces = stats.linkedPieces + newlyLinkedPayroll.length;
  context.NetworkStats.set({
    ...stats,
    spends: stats.spends + 1,
    collects: stats.collects + (kind === "COLLECT" ? 1 : 0),
    sendHomes: stats.sendHomes + (kind === "SEND_HOME" ? 1 : 0),
    spentVolume: stats.spentVolume + total,
    sendHomeVolume: stats.sendHomeVolume + (kind === "SEND_HOME" ? total : 0n),
    ctkDelivered: stats.ctkDelivered + (kind === "SEND_HOME" ? amountOut : 0n),
    piecesSpent: stats.piecesSpent + piecesSpent,
    linkedPieces,
    unlinkedShare: unlinkedShare(linkedPieces, stats.pieces),
    clusters: stats.clusters + (result.created ? 1 : 0) - result.absorbed.length,
    largestCluster: Math.max(stats.largestCluster, result.cluster.size),
    multiRunClusters: stats.multiRunClusters + multiDelta("runCount"),
    multiEmployerClusters: stats.multiEmployerClusters + multiDelta("employerCount"),
    reusedDestinations: stats.reusedDestinations + (destination?.spends === 1 ? 1 : 0),
    updatedAt: timestamp,
  });
});
