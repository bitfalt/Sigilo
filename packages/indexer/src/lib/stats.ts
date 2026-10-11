// Network-wide aggregates: the NetworkStats singleton and one DailyActivity row per UTC day.

import type { DailyActivity, EvmOnEventContext, NetworkStats } from "envio";

export type Context = EvmOnEventContext;

export const STATS_ID = "sigilo";

export function emptyStats(): NetworkStats {
  return {
    id: STATS_ID,
    verifiedEmployers: 0,
    rootsPublished: 0,
    latestRoot: undefined,
    passportAttestations: 0,
    employers: 0,
    payrollRuns: 0,
    pieces: 0,
    paidVolume: 0n,
    spends: 0,
    collects: 0,
    sendHomes: 0,
    spentVolume: 0n,
    sendHomeVolume: 0n,
    ctkDelivered: 0n,
    piecesSpent: 0,
    linkedPieces: 0,
    unlinkedShare: 1,
    clusters: 0,
    largestCluster: 0,
    multiRunClusters: 0,
    multiEmployerClusters: 0,
    reusedDestinations: 0,
    advancesIssued: 0,
    advancesActive: 0,
    advancesClosed: 0,
    advancedVolume: 0n,
    repaidVolume: 0n,
    advancesTiedToEmployer: 0,
    updatedAt: 0,
  };
}

export async function loadStats(context: Context): Promise<NetworkStats> {
  return (await context.NetworkStats.get(STATS_ID)) ?? emptyStats();
}

const DAY = 86_400;

/** YYYY-MM-DD (UTC) of a unix timestamp. */
export const dayId = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);

export async function loadDay(context: Context, timestamp: number): Promise<DailyActivity> {
  const id = dayId(timestamp);
  return (
    (await context.DailyActivity.get(id)) ?? {
      id,
      dayStart: timestamp - (timestamp % DAY),
      payrollRuns: 0,
      pieces: 0,
      paidVolume: 0n,
      spends: 0,
      spentVolume: 0n,
      sendHomes: 0,
      advancesIssued: 0,
      advancedVolume: 0n,
      repaidVolume: 0n,
    }
  );
}

/** Entity ids are lowercase (config.yaml `address_format: lowercase`); normalize anything else. */
export const lower = (value: string) => value.toLowerCase();

export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
