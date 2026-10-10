"use client";

// "What the internet sees" (SPEC.md §13): everything a stranger can read about one payroll payment,
// straight from the public record. A company account paid N same-sized pieces to N brand-new
// accounts; nothing says which pieces belong to whom. Shown next to María's phone in the demo.

import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { useEffect, useState } from "react";
import { type Address, decodeFunctionData, type Hex, parseAbi } from "viem";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { publicClient } from "@/lib/chain";
import { EXPLORER_URL } from "@/lib/config";
import { formatUsd } from "@/lib/wallet";

const disperseAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

interface Record {
  from: Address;
  at: Date;
  pieces: { to: Address; amount: bigint }[];
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function PublicRecord({ tx }: { tx: string }) {
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx);
  const [loaded, setRecord] = useState<Record | null | "missing">(null);
  const record = valid ? loaded : "missing";

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await publicClient.getTransaction({ hash: tx as Hex });
        if (t.to?.toLowerCase() !== SIGILO_TESTNET.sigiloPay.toLowerCase()) throw new Error();
        const { functionName, args } = decodeFunctionData({ abi: disperseAbi, data: t.input });
        if (functionName !== "disperse") throw new Error();
        const block = await publicClient.getBlock({ blockNumber: t.blockNumber! });
        const [to, amounts] = args;
        if (!cancelled) {
          setRecord({
            from: t.from,
            at: new Date(Number(block.timestamp) * 1000),
            pieces: to.map((a, i) => ({ to: a, amount: amounts[i]! })),
          });
        }
      } catch {
        if (!cancelled) setRecord("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tx, valid]);

  if (record === null) {
    return (
      <AppShell wide>
        <p className="text-muted-foreground py-24 text-center">Reading the public record…</p>
      </AppShell>
    );
  }
  if (record === "missing") {
    return (
      <AppShell wide>
        <p className="text-muted-foreground py-24 text-center">
          This isn&apos;t a Sigilo payroll payment.
        </p>
      </AppShell>
    );
  }

  const total = record.pieces.reduce((s, p) => s + p.amount, 0n);
  const sizes = new Set(record.pieces.map((p) => p.amount.toString())).size;

  return (
    <AppShell wide>
      <div className="flex flex-col gap-8 pt-4 pb-12">
        <header className="flex max-w-3xl flex-col gap-3">
          <p className="text-muted-foreground text-[0.9375rem]">Public record</p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] text-balance sm:text-6xl">
            What the internet sees
          </h1>
          <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
            Anyone can look up this payroll. On{" "}
            {record.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}, a
            company account ({short(record.from)}) paid {formatUsd(total)} in {record.pieces.length}{" "}
            payments of {sizes} different sizes, each to an account that had never been used before.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <section className="bg-card rounded-md p-2 shadow-[0_18px_40px_-26px_rgba(15,42,32,0.5)] sm:p-4">
            <ol className="divide-foreground/10 divide-y">
              {record.pieces.map((p, i) => (
                <li
                  key={`${p.to}-${i}`}
                  className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-2.5 text-sm tabular-nums"
                >
                  <span className="text-muted-foreground">{i + 1}</span>
                  <span className="truncate">to a new account {short(p.to)}</span>
                  <span className="font-semibold">{formatUsd(p.amount)}</span>
                </li>
              ))}
            </ol>
          </section>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-8">
            <div className="bg-foreground text-background rounded-md p-6">
              <p className="font-wide text-2xl leading-tight">Which of these are María&apos;s?</p>
              <p className="mt-3 text-[1.0625rem] leading-relaxed opacity-85">
                There&apos;s no way to tell. Every payment goes to a brand-new account, everyone is
                paid in the same few sizes, and the list is shuffled. Only María&apos;s phone knows
                which ones are hers, and it shows her one balance.
              </p>
            </div>
            <Perforation />
            <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
              <li>Visible to anyone: that this company paid, the total, and when.</li>
              <li>Never visible: who got paid, or how much any one person earns.</li>
            </ul>
            <a
              href={`${EXPLORER_URL}/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold underline underline-offset-4"
            >
              Check it yourself on the Monad explorer
            </a>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
