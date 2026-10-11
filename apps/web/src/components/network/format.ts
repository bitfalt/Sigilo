// Formatting for the public-record pages. Amounts are AUSD base units (6 decimals).

/** "$48,210" for whole dollars, "$12.50" otherwise; "$1.2M" past a million. */
export function usd(ausd: bigint): string {
  const cents = Number(ausd / 10_000n);
  const dollars = cents / 100;
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  }
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export const count = (n: number) => n.toLocaleString("en-US");

/** "1 payment", "3 payments". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${count(n)} ${n === 1 ? one : many}`;

export const percent = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;

/** "0x96A7…7f8F": enough of a public account to recognize it, not to read it out. */
export const shortAccount = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const day = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const dateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
