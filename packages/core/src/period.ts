// Payroll periods are month indexes (year * 12 + month - 1), so consecutive months are
// consecutive integers across year boundaries; the circuit checks periods[k] == periods[0] + k.
// This encoding is part of every payroll leaf: do not change it.

export interface YearMonth {
  year: number;
  /** 1..12 */
  month: number;
}

export function periodIndex({ year, month }: YearMonth): number {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError("bad year");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("bad month");
  return year * 12 + (month - 1);
}

export function periodFromIndex(index: number): YearMonth {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("bad period index");
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
