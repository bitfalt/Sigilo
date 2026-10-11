// Live public numbers from Sigilo's Envio indexer (packages/indexer, see its schema.graphql).
// Everything it serves is public data read off the chain. Every call resolves to null when the
// endpoint isn't configured yet or doesn't answer, so each consumer hides or waits instead of
// breaking.

import { ENVIO_GRAPHQL_URL } from "./config";

export const indexerConfigured = ENVIO_GRAPHQL_URL !== "";

/** The indexer's GraphQL (Hasura) returns BigInt columns as strings, small ones maybe as numbers. */
type Raw = string | number | null | undefined;

const big = (v: Raw): bigint => {
  if (v === null || v === undefined) return 0n;
  if (typeof v === "number") return BigInt(Math.round(v));
  try {
    return BigInt(v);
  } catch {
    return BigInt(Math.round(Number(v)));
  }
};
const num = (v: Raw) => Number(v ?? 0);

async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!indexerConfigured) return null;
  try {
    const res = await fetch(ENVIO_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T; errors?: unknown };
    return body.errors || !body.data ? null : body.data;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ network

export interface NetworkStats {
  verifiedEmployers: number;
  rootsPublished: number;
  employers: number;
  payrollRuns: number;
  /** Payrolls of a single piece: the whole amount visibly went to one person. */
  singlePieceRuns: number;
  pieces: number;
  /** AUSD base units (6 decimals), like every amount below unless noted. */
  paidVolume: bigint;
  spends: number;
  collects: number;
  sendHomes: number;
  spentVolume: bigint;
  sendHomeVolume: bigint;
  piecesSpent: number;
  linkedPieces: number;
  /** Share of payroll pieces nobody can tie to anything else, 0..1. */
  unlinkedShare: number;
  clusters: number;
  largestCluster: number;
  multiRunClusters: number;
  multiEmployerClusters: number;
  reusedDestinations: number;
  advancesIssued: number;
  advancesActive: number;
  advancesClosed: number;
  advancedVolume: bigint;
  repaidVolume: bigint;
  advancesTiedToEmployer: number;
  /** Unix seconds of the last indexed event. */
  updatedAt: number;
}

export interface RunSummary {
  txHash: string;
  employer: string;
  timestamp: number;
  pieceCount: number;
  total: bigint;
  distinctAmounts: number;
  largestGroup: number;
  largestGroupAmount: bigint;
  uniquePieces: number;
  meanAnonymitySet: number;
  piecesSpent: number;
  linkedPieces: number;
  unlinkedShare: number;
  largestExposure: bigint;
}

export interface DenominationRow {
  amount: bigint;
  issued: number;
  spent: number;
}

export interface ClusterRow {
  id: string;
  size: number;
  payrollPieces: number;
  spendCount: number;
  volume: bigint;
  runCount: number;
  employerCount: number;
  includesAdvance: boolean;
  largestExposure: bigint;
}

export interface NetworkOverview {
  stats: NetworkStats | null;
  runs: RunSummary[];
  denominations: DenominationRow[];
  clusters: ClusterRow[];
}

const RUN_FIELDS = `txHash employer_id timestamp pieceCount total distinctAmounts largestGroup
  largestGroupAmount uniquePieces meanAnonymitySet piecesSpent linkedPieces unlinkedShare
  largestExposure`;

type RawRun = Record<keyof Omit<RunSummary, "employer">, Raw> & { employer_id: string };

const toRun = (r: RawRun): RunSummary => ({
  txHash: String(r.txHash),
  employer: r.employer_id,
  timestamp: num(r.timestamp),
  pieceCount: num(r.pieceCount),
  total: big(r.total),
  distinctAmounts: num(r.distinctAmounts),
  largestGroup: num(r.largestGroup),
  largestGroupAmount: big(r.largestGroupAmount),
  uniquePieces: num(r.uniquePieces),
  meanAnonymitySet: num(r.meanAnonymitySet),
  piecesSpent: num(r.piecesSpent),
  linkedPieces: num(r.linkedPieces),
  unlinkedShare: num(r.unlinkedShare),
  largestExposure: big(r.largestExposure),
});

const NETWORK_QUERY = `query SigiloNetwork($runs: Int!) {
  NetworkStats(where: { id: { _eq: "sigilo" } }) {
    verifiedEmployers rootsPublished employers payrollRuns singlePieceRuns pieces paidVolume spends collects
    sendHomes spentVolume sendHomeVolume piecesSpent linkedPieces unlinkedShare clusters
    largestCluster multiRunClusters multiEmployerClusters reusedDestinations advancesIssued
    advancesActive advancesClosed advancedVolume repaidVolume advancesTiedToEmployer updatedAt
  }
  PayrollRun(order_by: { timestamp: desc }, limit: $runs) { ${RUN_FIELDS} }
  Denomination(order_by: { amount: desc }) { amount issued spent }
  Cluster(
    where: { active: { _eq: true }, size: { _gt: 1 } }
    order_by: [{ size: desc }, { volume: desc }]
    limit: 6
  ) {
    id size payrollPieces spendCount volume runCount employerCount includesAdvance largestExposure
  }
}`;

export async function fetchNetworkOverview(runs = 40): Promise<NetworkOverview | null> {
  const data = await request<{
    NetworkStats: Record<string, Raw>[];
    PayrollRun: RawRun[];
    Denomination: Record<string, Raw>[];
    Cluster: Record<string, Raw | boolean>[];
  }>(NETWORK_QUERY, { runs });
  if (!data) return null;
  const s = data.NetworkStats[0];
  return {
    stats: s
      ? {
          verifiedEmployers: num(s.verifiedEmployers),
          rootsPublished: num(s.rootsPublished),
          employers: num(s.employers),
          payrollRuns: num(s.payrollRuns),
          singlePieceRuns: num(s.singlePieceRuns),
          pieces: num(s.pieces),
          paidVolume: big(s.paidVolume),
          spends: num(s.spends),
          collects: num(s.collects),
          sendHomes: num(s.sendHomes),
          spentVolume: big(s.spentVolume),
          sendHomeVolume: big(s.sendHomeVolume),
          piecesSpent: num(s.piecesSpent),
          linkedPieces: num(s.linkedPieces),
          unlinkedShare: num(s.unlinkedShare),
          clusters: num(s.clusters),
          largestCluster: num(s.largestCluster),
          multiRunClusters: num(s.multiRunClusters),
          multiEmployerClusters: num(s.multiEmployerClusters),
          reusedDestinations: num(s.reusedDestinations),
          advancesIssued: num(s.advancesIssued),
          advancesActive: num(s.advancesActive),
          advancesClosed: num(s.advancesClosed),
          advancedVolume: big(s.advancedVolume),
          repaidVolume: big(s.repaidVolume),
          advancesTiedToEmployer: num(s.advancesTiedToEmployer),
          updatedAt: num(s.updatedAt),
        }
      : null,
    runs: data.PayrollRun.map(toRun),
    denominations: data.Denomination.map((d) => ({
      amount: big(d.amount),
      issued: num(d.issued),
      spent: num(d.spent),
    })),
    clusters: data.Cluster.map((c) => ({
      id: String(c.id),
      size: num(c.size as Raw),
      payrollPieces: num(c.payrollPieces as Raw),
      spendCount: num(c.spendCount as Raw),
      volume: big(c.volume as Raw),
      runCount: num(c.runCount as Raw),
      employerCount: num(c.employerCount as Raw),
      includesAdvance: c.includesAdvance === true,
      largestExposure: big(c.largestExposure as Raw),
    })),
  };
}

// ------------------------------------------------------------------ lender

export interface LenderPortfolio {
  advancesIssued: number;
  activeAdvances: number;
  closedAdvances: number;
  borrowers: number;
  repeatBorrowers: number;
  lent: bigint;
  owedTotal: bigint;
  repaid: bigint;
  outstanding: bigint;
  /** repaid / owed, 0..1 */
  repaymentRate: number;
  deposits: bigint;
  withdrawn: bigint;
  /** The vault's AUSD balance: what's available to lend. */
  liquidity: bigint;
  lastActivityAt: number;
}

/** The vault's portfolio; `portfolio` is null while the vault has no activity yet. */
export async function fetchLenderPortfolio(
  vault: string,
): Promise<{ portfolio: LenderPortfolio | null } | null> {
  const data = await request<{ LenderPortfolio: Record<string, Raw>[] }>(
    `query SigiloLenderPortfolio($id: String!) {
      LenderPortfolio(where: { id: { _eq: $id } }) {
        advancesIssued activeAdvances closedAdvances borrowers repeatBorrowers lent owedTotal
        repaid outstanding repaymentRate deposits withdrawn liquidity lastActivityAt
      }
    }`,
    { id: vault.toLowerCase() },
  );
  if (!data) return null;
  const p = data.LenderPortfolio[0];
  if (!p) return { portfolio: null };
  return {
    portfolio: {
      advancesIssued: num(p.advancesIssued),
      activeAdvances: num(p.activeAdvances),
      closedAdvances: num(p.closedAdvances),
      borrowers: num(p.borrowers),
      repeatBorrowers: num(p.repeatBorrowers),
      lent: big(p.lent),
      owedTotal: big(p.owedTotal),
      repaid: big(p.repaid),
      outstanding: big(p.outstanding),
      repaymentRate: num(p.repaymentRate),
      deposits: big(p.deposits),
      withdrawn: big(p.withdrawn),
      liquidity: big(p.liquidity),
      lastActivityAt: num(p.lastActivityAt),
    },
  };
}

// ------------------------------------------------------------------ one payroll

export interface RunPiece {
  account: string;
  amount: bigint;
  spendCount: number;
  /** Tied by a payment to at least one other account. */
  linked: boolean;
  /** The group of accounts proven to share an owner, if spent. */
  cluster: string | null;
}

export interface RunInsight {
  run: RunSummary;
  pieces: RunPiece[];
  /** What each group of linked accounts reveals about this payroll, largest first. */
  exposures: { cluster: string; pieces: number; amount: bigint }[];
}

/** The indexed view of one payroll payment; `undefined` if the indexer doesn't know it (yet). */
export async function fetchRunInsight(tx: string): Promise<RunInsight | null | undefined> {
  const id = tx.toLowerCase();
  const data = await request<{
    PayrollRun: RawRun[];
    Piece: Record<string, Raw | boolean>[];
    Exposure: Record<string, Raw>[];
  }>(
    `query SigiloRun($tx: String!) {
      PayrollRun(where: { txHash: { _eq: $tx } }) { ${RUN_FIELDS} }
      Piece(where: { run_id: { _eq: $tx } }) { id amount spendCount linked cluster_id }
      Exposure(where: { run_id: { _eq: $tx }, active: { _eq: true } }, order_by: { amount: desc }) {
        cluster_id pieces amount
      }
    }`,
    { tx: id },
  );
  if (!data) return null;
  const run = data.PayrollRun[0];
  if (!run) return undefined;
  return {
    run: toRun(run),
    pieces: data.Piece.map((p) => ({
      account: String(p.id).toLowerCase(),
      amount: big(p.amount as Raw),
      spendCount: num(p.spendCount as Raw),
      linked: p.linked === true,
      cluster: typeof p.cluster_id === "string" ? p.cluster_id : null,
    })),
    exposures: data.Exposure.map((e) => ({
      cluster: String(e.cluster_id),
      pieces: num(e.pieces),
      amount: big(e.amount),
    })),
  };
}
