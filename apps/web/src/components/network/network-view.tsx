"use client";

// "Sigilo in numbers" and "What the internet can learn": the whole public record, recomputed live
// by Sigilo's Envio indexer (packages/indexer). Shows what Sigilo hides and, honestly, what it
// can't: every payment that spends several pieces at once ties them to one owner.

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { fetchNetworkOverview, indexerConfigured, type NetworkOverview } from "@/lib/indexer";

import { count, dateTime, day, percent, plural, shortAccount, usd } from "./format";
import { PieceLegend, PieceMark, PieceStrip } from "./piece-marks";

import "@/components/employer/employer.css";

const REFRESH_MS = 30_000;
const LEDGER_ROWS = 8;

type State = NetworkOverview | "loading" | "unavailable";

export function NetworkView() {
  const [state, setState] = useState<State>(indexerConfigured ? "loading" : "unavailable");

  useEffect(() => {
    if (!indexerConfigured) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchNetworkOverview();
      if (cancelled) return;
      // Keep the last good numbers if a refresh fails.
      setState((prev) => data ?? (typeof prev === "object" ? prev : "unavailable"));
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <AppShell wide>
      <div className="flex flex-col gap-10 pt-4 pb-12 tabular-nums">
        <header className="flex max-w-3xl flex-col gap-3">
          <p className="text-muted-foreground text-[0.9375rem]">Public record</p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] text-balance sm:text-6xl">
            Sigilo in numbers
          </h1>
        </header>
        {state === "loading" && (
          <p className="text-muted-foreground py-16 text-center" role="status">
            Reading the public record…
          </p>
        )}
        {state === "unavailable" && <Unavailable />}
        {typeof state === "object" && <Overview data={state} />}
      </div>
    </AppShell>
  );
}

function Unavailable() {
  return (
    <section className="em-slip flex max-w-2xl flex-col gap-2 p-6 sm:p-8">
      <p className="font-wide text-xl">Live numbers are on their way</p>
      <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
        This page reads the public record through Sigilo&apos;s indexer, which isn&apos;t answering
        yet. Check back in a few minutes.
      </p>
    </section>
  );
}

function Overview({ data }: { data: NetworkOverview }) {
  const s = data.stats;
  if (!s || s.payrollRuns === 0) {
    return (
      <section className="em-slip flex max-w-2xl flex-col gap-2 p-6 sm:p-8">
        <p className="font-wide text-xl">No payroll yet</p>
        <p className="text-muted-foreground text-[1.0625rem]">
          The numbers start with the first company that runs payroll.
        </p>
      </section>
    );
  }

  return (
    <>
      <Statement data={data} />
      <Perforation />
      <section className="flex flex-col gap-8" aria-labelledby="learn">
        <div className="flex max-w-3xl flex-col gap-3">
          <h2 id="learn" className="font-display text-3xl sm:text-[2.75rem]">
            What the internet can learn
          </h2>
          <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
            Every payroll is public: which company account paid, the total, and when. Who got which
            piece is not. This is what a stranger can work out from the record, recomputed every
            time something happens.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <div className="flex flex-col gap-6">
            <p className="max-w-[34ch] text-[1.375rem] leading-snug sm:text-[1.625rem]">
              <span className="font-display text-[3.25rem] sm:text-7xl">
                {percent(s.unlinkedShare)}
              </span>{" "}
              of the pieces ever paid still can&apos;t be tied to anyone, or to each other.
            </p>
            <Ledger runs={data.runs} />
          </div>
          <aside className="flex flex-col gap-8 lg:sticky lg:top-8">
            <PieceLegend />
            <Sizes rows={data.denominations} />
          </aside>
        </div>

        <Revealed data={data} />
        <Unlearnable />
      </section>

      <p className="text-muted-foreground text-sm">
        Recomputed from the public record by Sigilo&apos;s indexer, built on Envio. Last activity{" "}
        {dateTime(s.updatedAt)}.
      </p>
    </>
  );
}

// ------------------------------------------------------------------ in numbers

function Figure({ children }: { children: ReactNode }) {
  return <span className="font-wide">{children}</span>;
}

function Statement({ data }: { data: NetworkOverview }) {
  const s = data.stats!;
  return (
    <section aria-label="Sigilo in numbers" className="flex flex-col gap-8">
      <p className="max-w-4xl text-[1.375rem] leading-snug text-balance sm:text-[2rem] sm:leading-tight">
        <Figure>{usd(s.paidVolume)}</Figure> paid privately in{" "}
        <Figure>{plural(s.payrollRuns, "payroll")}</Figure> from{" "}
        <Figure>{plural(s.employers, "company", "companies")}</Figure>, as{" "}
        <Figure>{plural(s.pieces, "piece")}</Figure> to as many brand-new accounts.
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Fact term="Sent home" value={usd(s.sendHomeVolume)}>
          in {plural(s.sendHomes, "payment")}
        </Fact>
        <Fact term="Salary advances" value={count(s.advancesIssued)}>
          {usd(s.advancedVolume)} lent, {count(s.advancesClosed)} repaid from payroll
        </Fact>
        <Fact term="Verified companies" value={count(s.verifiedEmployers)}>
          their payrolls back Income Passports
        </Fact>
        <Fact term="Payroll records" value={count(s.rootsPublished)}>
          published for Income Passports to check against
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ term, value, children }: { term: string; value: string; children: ReactNode }) {
  return (
    <div className="border-foreground/15 flex flex-col gap-1 border-t pt-3">
      <dt className="text-muted-foreground text-sm">{term}</dt>
      <dd className="font-wide text-2xl">{value}</dd>
      <dd className="text-muted-foreground text-sm">{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ the ledger

function Ledger({ runs }: { runs: NetworkOverview["runs"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? runs : runs.slice(0, LEDGER_ROWS);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-wide text-lg">Recent payrolls, piece by piece</h3>
      <ol className="em-slip divide-foreground/10 divide-y">
        {shown.map((r) => {
          const spentAlone = Math.max(0, r.piecesSpent - r.linkedPieces);
          const hidden = Math.max(0, r.pieceCount - r.piecesSpent);
          const summary =
            `${plural(r.pieceCount, "piece")} in ${plural(r.distinctAmounts, "size")}: ` +
            `${count(r.linkedPieces)} tied to an owner, ${count(spentAlone)} spent alone, ` +
            `${count(hidden)} never spent.`;
          return (
            <li key={r.txHash}>
              <Link
                href={`/record/${r.txHash}`}
                title={
                  r.largestExposure > 0n
                    ? `${summary} The most of this payroll tied to one person: ${usd(r.largestExposure)}.`
                    : summary
                }
                className="hover:bg-secondary/50 focus-visible:ring-ring/50 grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2.5 px-4 py-3 outline-none focus-visible:ring-3 sm:grid-cols-[4rem_6.5rem_1fr_6rem]"
              >
                <span className="text-sm font-semibold">{day(r.timestamp)}</span>
                <span className="text-muted-foreground truncate text-sm">
                  {shortAccount(r.employer)}
                </span>
                <span className="text-right text-sm font-semibold sm:order-last">
                  {usd(r.total)}
                </span>
                <PieceStrip
                  className="col-span-3 sm:col-span-1"
                  linked={r.linkedPieces}
                  spent={spentAlone}
                  hidden={hidden}
                  label={summary}
                />
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          Each mark is one piece. Open a payroll to see it the way the internet does.
        </p>
        {runs.length > LEDGER_ROWS && (
          <button
            onClick={() => setAll((v) => !v)}
            className="focus-visible:ring-ring/50 rounded-sm font-semibold underline decoration-[1.5px] underline-offset-4 outline-none focus-visible:ring-3"
          >
            {all ? "Show fewer" : `Show the last ${runs.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sizes

function Sizes({ rows }: { rows: NetworkOverview["denominations"] }) {
  const sizes = rows.filter((r) => r.issued > 0);
  const max = Math.max(1, ...sizes.map((r) => r.issued));
  if (sizes.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="sizes">
      <div>
        <h3 id="sizes" className="font-wide text-lg">
          Sizes paid
        </h3>
        <p className="text-muted-foreground text-sm">
          A piece hides among every other piece of its size.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {sizes.map((r) => {
          const unspent = Math.max(0, r.issued - r.spent);
          return (
            <li
              key={r.amount.toString()}
              title={`${usd(r.amount)} pieces: ${count(r.issued)} paid, ${count(r.spent)} spent since.`}
              className="grid grid-cols-[4.75rem_1fr_3rem] items-center gap-3"
            >
              <span className="text-right text-sm font-semibold">{usd(r.amount)}</span>
              <span className="flex h-3 gap-[2px]" aria-hidden="true">
                {unspent > 0 && (
                  <span
                    className="rounded-[2px] bg-[#3a52c9]"
                    style={{ width: `${(unspent / max) * 100}%` }}
                  />
                )}
                {r.spent > 0 && (
                  <span
                    className="rounded-[2px] border-[1.5px] border-[#4f6359]"
                    style={{ width: `${(r.spent / max) * 100}%` }}
                  />
                )}
              </span>
              <span className="text-muted-foreground text-xs">{count(r.issued)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <PieceMark state="hidden" className="h-3 w-3" /> not spent
        <PieceMark state="spent" className="ml-2 h-3 w-3" /> spent
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ what spending revealed

function Revealed({ data }: { data: NetworkOverview }) {
  const s = data.stats!;
  const limits = [
    s.singlePieceRuns > 0 &&
      `${count(s.singlePieceRuns)} of ${plural(s.payrollRuns, "payroll")} paid a single piece: whoever got it, their whole pay for that run is public. Privacy needs a crowd.`,
    s.advancesIssued > 0 &&
      `${count(s.advancesTiedToEmployer)} of ${plural(s.advancesIssued, "salary advance")} can be tied to the company account that repays ${s.advancesIssued === 1 ? "it" : "them"} from payroll.`,
    s.reusedDestinations > 0 &&
      `${plural(s.reusedDestinations, "account")} received more than one payment: a hint, not proof, that the payments came from one person.`,
    s.multiEmployerClusters > 0 &&
      `${plural(s.multiEmployerClusters, "group")} of tied pieces came from more than one company: one person with two employers.`,
  ].filter((x): x is string => typeof x === "string");

  return (
    <section className="flex flex-col gap-5" aria-labelledby="revealed">
      <div className="flex max-w-3xl flex-col gap-2">
        <h3 id="revealed" className="font-wide text-2xl">
          What spending reveals
        </h3>
        <p className="text-[1.0625rem] leading-relaxed">
          Every piece in a payment signs that same payment, so anyone can tell those pieces share an
          owner. So far payments have tied {plural(s.linkedPieces, "piece")} into{" "}
          {plural(s.clusters, "group")}
          {s.multiRunClusters > 0
            ? `, and ${count(s.multiRunClusters)} of those groups reach across more than one payroll: the same person, paid in different months.`
            : "."}
        </p>
      </div>
      {data.clusters.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.clusters.map((c) => (
            <li key={c.id} className="em-slip flex flex-col gap-3 p-5">
              <PieceStrip
                linked={c.size}
                spent={0}
                hidden={0}
                label={`${c.size} accounts with one owner`}
              />
              <p className="font-wide text-lg leading-tight">{c.size} accounts, one owner</p>
              <p className="text-muted-foreground text-sm">
                Shown by {plural(c.spendCount, "payment")}. Spans {plural(c.runCount, "payroll")}
                {c.employerCount > 1 ? ` from ${count(c.employerCount)} companies` : ""}
                {c.includesAdvance ? ", and a salary advance" : ""}.
              </p>
              {c.largestExposure > 0n && (
                <p className="text-sm">
                  Up to <span className="font-semibold">{usd(c.largestExposure)}</span> of one
                  payroll now points to one person.
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No payment has tied two pieces together yet.</p>
      )}
      {limits.length > 0 && (
        <ul className="text-muted-foreground flex max-w-3xl list-disc flex-col gap-1.5 pl-5 text-[0.9375rem]">
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Unlearnable() {
  return (
    <section className="bg-foreground text-background flex flex-col gap-4 rounded-md p-6 sm:p-8">
      <h3 className="font-wide text-2xl leading-tight">What nobody can learn from it</h3>
      <ul className="grid gap-3 text-[1.0625rem] leading-relaxed opacity-90 sm:grid-cols-2">
        <li>Who works for which company, or anyone&apos;s name.</li>
        <li>Anyone&apos;s salary, unless they spend a whole paycheck in one payment.</li>
        <li>Which pieces belong to whom, until they&apos;re spent together.</li>
        <li>Who borrowed: each lender sees a different ID for the same person.</li>
      </ul>
    </section>
  );
}
