// The payroll run as a sealed envelope in ultramarine security ink: pick the month, see who gets
// paid, run it, and watch each step. Past runs sit on the paper stub below.

import { cn } from "cn";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PayrollStep } from "@/lib/payroll-client";

export interface PeriodOption {
  value: number;
  /** "Oct 2026" */
  label: string;
  month: string;
  year: string;
  paid: boolean;
}

export interface PayrollSummary {
  /** People who joined and will be paid. */
  people: number;
  /** Formatted total of their monthly salaries. */
  total: string;
  /** Invited people who haven't joined yet. */
  waiting: number;
}

export type RunStatus = "pending" | "paying" | "committing" | "done" | "failed";

export interface RunEntry {
  id: string;
  period: string;
  /** Formatted amount paid, or null if nothing was paid. */
  total: string | null;
  status: RunStatus;
  paymentUrl: string | null;
}

export interface PayrollEnvelopeProps {
  periods: PeriodOption[];
  period: number;
  onPeriodChange(value: number): void;
  /** Undefined while the team loads. */
  summary: PayrollSummary | undefined;
  step: PayrollStep | null;
  error: string | null;
  onRun(): void;
  /** Undefined while past runs load. */
  runs: RunEntry[] | undefined;
}

const STEPS: { step: Exclude<PayrollStep, "done">; copy: string }[] = [
  { step: "preparing", copy: "Preparing private payslips" },
  { step: "approving", copy: "Authorizing the payroll payment" },
  { step: "paying", copy: "Paying your team privately" },
  { step: "recording", copy: "Recording payslips" },
];

export function PayrollEnvelope({
  periods,
  period,
  onPeriodChange,
  summary,
  step,
  error,
  onRun,
  runs,
}: PayrollEnvelopeProps) {
  const running = step !== null && step !== "done";
  const selected = periods.find((p) => p.value === period);

  return (
    <section aria-labelledby="payroll-title" className="em-slip overflow-clip">
      <div className="em-envelope em-tear px-5 pt-6 pb-8 sm:px-7 sm:pt-7 sm:pb-9">
        <h2 id="payroll-title" className="font-wide text-2xl">
          Payroll
        </h2>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold opacity-85">Month</legend>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {periods.map((p) => (
              <label key={p.value} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name="payroll-period"
                  value={p.value}
                  checked={p.value === period}
                  aria-label={p.paid ? `${p.label}, paid` : p.label}
                  onChange={() => onPeriodChange(p.value)}
                  className="peer sr-only"
                />
                <span className="flex flex-col items-center rounded-xl px-1 py-2 ring-[1.5px] ring-[#f4f6ff]/35 transition-colors ring-inset peer-checked:bg-[#f4f6ff] peer-checked:text-primary peer-checked:ring-[#f4f6ff] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[#f4f6ff] hover:ring-[#f4f6ff]/70">
                  <span className="font-wide text-base leading-tight">{p.month}</span>
                  <span className="text-xs opacity-75">{p.year}</span>
                </span>
                {p.paid && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-[#f4f6ff] text-primary ring-2 ring-primary"
                  >
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-7 min-h-[7.5rem]" aria-live="polite">
          {step === "done" && selected?.paid ? (
            <p className="em-stamp em-stamp-in ml-1 px-5 py-3">
              <span className="font-wide text-2xl">Payroll sent.</span>
              <span className="mt-1 text-sm opacity-90">
                Payslips are in everyone&apos;s account.
              </span>
            </p>
          ) : selected?.paid ? (
            <>
              <p className="font-wide text-2xl">{selected.label} is paid</p>
              <p className="mt-2 text-sm text-pretty opacity-85">
                Pick another month to run payroll.
              </p>
            </>
          ) : summary === undefined ? (
            <p className="text-sm opacity-85">Counting your team…</p>
          ) : summary.people === 0 ? (
            <>
              <p className="font-wide text-2xl">Nobody to pay yet</p>
              <p className="mt-2 text-sm text-pretty opacity-85">
                {summary.waiting > 0
                  ? "People appear here once they open their invite link and join."
                  : "Add people to your team and send each one their invite link."}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm opacity-85">
                {`Paying ${summary.people === 1 ? "1 person" : `${summary.people} people`} for ${selected?.label ?? "this month"}`}
              </p>
              <p className="mt-1 font-display text-[clamp(2.4rem,6vw,3rem)]">{summary.total}</p>
              {summary.waiting > 0 && (
                <p className="mt-2 text-sm text-pretty opacity-85">
                  {summary.waiting === 1
                    ? "1 more person is invited and hasn't joined yet."
                    : `${summary.waiting} more people are invited and haven't joined yet.`}
                </p>
              )}
            </>
          )}
        </div>

        <Button
          onClick={onRun}
          disabled={running}
          className="mt-5 h-12 w-full rounded-full bg-[#f4f6ff] text-[0.975rem] font-semibold text-primary hover:bg-white focus-visible:ring-0 disabled:opacity-60"
        >
          Run payroll
        </Button>

        {step !== null && step !== "done" && <Progress step={step} />}

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg bg-[#f4f6ff] px-4 py-3 text-sm text-pretty text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <RunLedger runs={runs} />
    </section>
  );
}

function Progress({ step }: { step: Exclude<PayrollStep, "done"> }) {
  const current = STEPS.findIndex((s) => s.step === step);
  return (
    <ol className="mt-6 flex flex-col gap-3" aria-label="Payroll progress">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={s.step}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 text-[0.95rem]",
              state === "todo" && "opacity-55",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                state === "done" && "bg-[#f4f6ff] text-primary",
                state === "current" && "em-pulse border-2 border-[#f4f6ff]",
                state === "todo" && "border-[1.5px] border-[#f4f6ff]/60",
              )}
            >
              {state === "done" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn(state === "current" && "font-semibold")}>
              {state === "current" ? `${s.copy}…` : s.copy}
              {state === "done" && <span className="sr-only">, done</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunLedger({ runs }: { runs: RunEntry[] | undefined }) {
  return (
    <div className="px-5 pt-5 pb-3 sm:px-7">
      <h3 className="font-wide text-lg">Past payroll</h3>
      {runs === undefined ? (
        <p role="status" className="py-4 text-sm text-muted-foreground">
          Loading past payroll…
        </p>
      ) : runs.length === 0 ? (
        <p className="py-4 text-sm text-pretty text-muted-foreground">
          Each month you pay shows up here, with a link to the payment.
        </p>
      ) : (
        <ol className="mt-1">
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex items-start justify-between gap-4 border-b border-foreground/10 py-3.5 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="font-semibold">{run.period}</p>
                <RunStatusLine run={run} />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {run.total && <p className="font-wide">{run.total}</p>}
                {run.paymentUrl && (
                  <a
                    className="rounded-sm text-sm font-semibold text-primary underline decoration-[1.5px] underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    href={run.paymentUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View payment
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RunStatusLine({ run }: { run: RunEntry }) {
  const paid = (
    <span className="-rotate-3 rounded-[5px] border-[1.5px] border-primary px-1.5 py-px font-wide text-xs text-primary">
      Paid
    </span>
  );
  const note = (text: string) => <span className="text-xs text-muted-foreground">{text}</span>;

  switch (run.status) {
    case "done":
      return <span className="flex">{paid}</span>;
    case "committing":
      return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {paid}
          {note("Updating Income Passports…")}
        </span>
      );
    case "failed":
      return run.paymentUrl ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {paid}
          {note("Doesn't count toward Income Passports")}
        </span>
      ) : (
        <span className="text-sm font-semibold text-destructive">Didn&apos;t go through</span>
      );
    case "paying":
      return note("Paying your team…");
    case "pending":
      return note("Not finished. Run payroll again to finish it.");
  }
}
