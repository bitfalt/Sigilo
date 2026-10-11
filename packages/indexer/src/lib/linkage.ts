// The indexer plays the adversary: what does spending reveal?
//
// Every input of a SigiloPay payment is signed by the same person (her pieces sign one intent),
// so a payment proves its inputs share an owner. Those accounts form a cluster. When a later
// payment spends an account that is already in a cluster (the remainder of a partially spent
// piece, say), the two clusters are one owner: they merge (union-find, smaller into larger).
//
// A cluster that holds two or more pieces of one payout reveals that one person received at
// least their sum in it: an Exposure. Pieces that were never spent, or only spent alone, stay
// unlinked: nobody can tell whose they are.

import type { Cluster, Exposure, Piece } from "envio";

export interface LinkArgs {
  /** The payment (Spend id) doing the linking. */
  paymentId: string;
  timestamp: number;
  /** AUSD the payment moved. */
  volume: bigint;
  /** The payment's inputs as they are before this payment. */
  inputs: readonly Piece[];
  /** Existing clusters of those inputs, each once. */
  clusters: readonly Cluster[];
  /** Pieces of those clusters that aren't inputs. */
  members: readonly Piece[];
  /** Active exposures of those clusters. */
  exposures: readonly Exposure[];
}

export interface LinkResult {
  /** The surviving cluster, updated. */
  cluster: Cluster;
  /** The payment started a new cluster. */
  created: boolean;
  /** Clusters merged into `cluster`, now inactive. */
  absorbed: Cluster[];
  /** Every piece of the cluster, pointing at it. */
  pieces: Piece[];
  /** Pieces this payment tied to another account for the first time. */
  newlyLinked: Piece[];
  /** The cluster's exposures, plus the absorbed clusters' ones, deactivated. */
  exposures: Exposure[];
  /** Earlier payments of the absorbed clusters, to re-point at `cluster`. */
  movedPayments: string[];
}

export const exposureId = (clusterId: string, runId: string) => `${clusterId}-${runId}`;

const unique = <T>(values: Iterable<T>) => [...new Set(values)];

/** The cluster that survives a merge: the largest, then the oldest. */
function survivorOf(clusters: readonly Cluster[]): Cluster | undefined {
  return [...clusters].sort(
    (a, b) => b.size - a.size || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )[0];
}

export function link(args: LinkArgs): LinkResult {
  const { paymentId, timestamp, volume } = args;
  const previous = survivorOf(args.clusters);
  const absorbed = args.clusters.filter((c) => c !== previous);

  const base: Cluster = previous ?? {
    id: paymentId,
    active: true,
    mergedInto_id: undefined,
    size: 0,
    payrollPieces: 0,
    spendCount: 0,
    volume: 0n,
    runCount: 0,
    employerCount: 0,
    includesAdvance: false,
    largestExposure: 0n,
    pieceIds: [],
    spendIds: [],
    runIds: [],
    employerIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const byId = new Map<string, Piece>();
  for (const p of [...args.members, ...args.inputs]) byId.set(p.id, p);
  const owned = [...byId.values()];
  const payroll = owned.filter((p) => p.source === "PAYROLL");
  const size = owned.length;

  // Exposure per payout, from scratch: the cluster's payroll pieces grouped by run. One piece
  // alone reveals nothing its payout didn't already show; two or more add up to a person's pay.
  const perRun = new Map<string, { pieces: number; amount: bigint }>();
  for (const p of payroll) {
    if (!p.run_id) continue;
    const e = perRun.get(p.run_id) ?? { pieces: 0, amount: 0n };
    perRun.set(p.run_id, { pieces: e.pieces + 1, amount: e.amount + p.amount });
  }
  const revealing = [...perRun.entries()].filter(([, e]) => e.pieces >= 2);
  const exposures: Exposure[] = revealing.map(([runId, e]) => ({
    id: exposureId(base.id, runId),
    cluster_id: base.id,
    run_id: runId,
    pieces: e.pieces,
    amount: e.amount,
    active: true,
  }));
  const absorbedIds = new Set(absorbed.map((c) => c.id));
  for (const e of args.exposures) {
    if (absorbedIds.has(e.cluster_id)) exposures.push({ ...e, active: false });
  }
  const largestExposure = exposures
    .filter((e) => e.active)
    .reduce((max, e) => (e.amount > max ? e.amount : max), 0n);

  const spendIds = unique([...base.spendIds, ...absorbed.flatMap((c) => c.spendIds), paymentId]);
  const runIds = unique(payroll.flatMap((p) => (p.run_id ? [p.run_id] : [])));
  const employerIds = unique(owned.flatMap((p) => (p.employer_id ? [p.employer_id] : [])));

  const cluster: Cluster = {
    ...base,
    active: true,
    size,
    payrollPieces: payroll.length,
    spendCount: spendIds.length,
    volume: base.volume + absorbed.reduce((s, c) => s + c.volume, 0n) + volume,
    runCount: runIds.length,
    employerCount: employerIds.length,
    includesAdvance: owned.some((p) => p.source === "ADVANCE"),
    largestExposure,
    pieceIds: owned.map((p) => p.id),
    spendIds,
    runIds,
    employerIds,
    updatedAt: timestamp,
  };

  const newlyLinked: Piece[] = [];
  const pieces = owned.map((p) => {
    const linked = p.linked || size >= 2;
    const next: Piece = { ...p, cluster_id: cluster.id, linked };
    if (linked && !p.linked) newlyLinked.push(next);
    return next;
  });

  return {
    cluster,
    created: previous === undefined,
    absorbed: absorbed.map((c) => ({
      ...c,
      active: false,
      mergedInto_id: cluster.id,
      updatedAt: timestamp,
    })),
    pieces,
    newlyLinked,
    exposures,
    movedPayments: absorbed.flatMap((c) => c.spendIds),
  };
}
