import { periodFromIndex, periodIndex } from "@sigilo/core/period";

/** "Oct 2026" for a month index. */
export function periodLabel(index: number): string {
  const { year, month } = periodFromIndex(index);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The current month and the `count - 1` before it, newest first. */
export function recentPeriods(count: number, now = new Date()): number[] {
  const current = periodIndex({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  return Array.from({ length: count }, (_, i) => current - i);
}
