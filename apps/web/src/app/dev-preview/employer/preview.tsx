"use client";

// Sample data for the employer console views (development only, see page.tsx).

import { useEffect, useState } from "react";

import { DashboardView } from "@/components/employer/dashboard-view";
import { ConsoleNotice } from "@/components/employer/parts";
import {
  PayrollEnvelope,
  type PayrollEnvelopeProps,
  type RunEntry,
} from "@/components/employer/payroll-envelope";
import { AddPersonForm, type TeamMember, TeamRegister } from "@/components/employer/team-register";
import { TreasuryCard } from "@/components/employer/treasury-card";
import { UnlockView } from "@/components/employer/unlock-view";
import { periodLabel, recentPeriods } from "@/lib/periods";

const STATES = [
  "dashboard",
  "running",
  "done",
  "new",
  "loading",
  "error",
  "create",
  "welcome",
  "opening",
] as const;
type State = (typeof STATES)[number];

const MEMBERS: TeamMember[] = [
  { id: "1", name: "María Fernández", salary: "$2,400.00", status: "passport" },
  { id: "2", name: "Andrés Quesada Rojas", salary: "$3,150.00", status: "joined" },
  { id: "3", name: "Lucía Benítez", salary: "$1,980.00", status: "joined" },
  {
    id: "4",
    name: "Tomás Herrera",
    salary: "$2,750.00",
    status: "invited",
    inviteCode: "preview-code",
  },
];

// A fixed "today" keeps the sample months stable (and the page prerenderable).
const TODAY = new Date(Date.UTC(2026, 9, 10));
const PERIODS = recentPeriods(4, TODAY);
const [current, ...past] = PERIODS;

const RUNS: RunEntry[] = [
  {
    id: "r1",
    period: periodLabel(past[0]!),
    total: "$7,530.00",
    status: "done",
    paymentUrl: "#",
  },
  {
    id: "r2",
    period: periodLabel(past[1]!),
    total: "$7,530.00",
    status: "done",
    paymentUrl: "#",
  },
  {
    id: "r3",
    period: periodLabel(past[2]!),
    total: "$4,380.00",
    status: "failed",
    paymentUrl: "#",
  },
];

function useHashState(): State {
  const [state, setState] = useState<State>("dashboard");
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      setState((STATES as readonly string[]).includes(hash) ? (hash as State) : "dashboard");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return state;
}

export function EmployerPreview() {
  const state = useHashState();
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [salary, setSalary] = useState("");
  const [period, setPeriod] = useState(current!);
  const noop = () => {};

  if (state === "create" || state === "welcome") {
    return (
      <>
        <UnlockView
          mode={state === "welcome" ? "welcome" : "create"}
          knownName="Acme Labs"
          company={company}
          onCompanyChange={setCompany}
          busy={false}
          error={null}
          onCreate={noop}
          onSignInKnown={noop}
          onSignInAny={noop}
          onCreateAnother={noop}
        />
        <PreviewNav />
      </>
    );
  }
  if (state === "opening") {
    return (
      <>
        <ConsoleNotice busy>Opening your company…</ConsoleNotice>
        <PreviewNav />
      </>
    );
  }

  const fresh = state === "new";
  const loading = state === "loading";
  const paid = state === "done";
  const runs = fresh
    ? []
    : paid
      ? [{ ...RUNS[0]!, id: "r0", period: periodLabel(current!) }, ...RUNS]
      : RUNS;

  const payroll: PayrollEnvelopeProps = {
    periods: PERIODS.map((p) => {
      const label = periodLabel(p);
      const [month = label, year = ""] = label.split(" ");
      return { value: p, label, month, year, paid: runs.some((r) => r.period === label) };
    }),
    period,
    onPeriodChange: setPeriod,
    summary: loading
      ? undefined
      : fresh
        ? { people: 0, total: "$0.00", waiting: 0 }
        : { people: 3, total: "$7,530.00", waiting: 1 },
    step: state === "running" ? "paying" : paid ? "done" : null,
    error:
      state === "error"
        ? "There isn't enough in your payroll balance for this run. Add funds and try again."
        : null,
    onRun: noop,
    runs: loading ? undefined : runs,
  };

  return (
    <>
      <DashboardView
        name={fresh ? "Pulpería Digital" : "Acme Labs"}
        verified={!fresh}
        onLock={noop}
        treasury={
          <TreasuryCard
            balance={loading ? null : fresh ? "$0.00" : "$18,640.00"}
            empty={fresh}
            busy={false}
            message={null}
            onAddFunds={noop}
          />
        }
        team={
          <TeamRegister members={loading ? undefined : fresh ? [] : MEMBERS}>
            <AddPersonForm
              name={name}
              salary={salary}
              onNameChange={setName}
              onSalaryChange={setSalary}
              onSubmit={noop}
              busy={false}
              error={state === "error" ? "Add a monthly salary in USD." : null}
            />
          </TeamRegister>
        }
        payroll={<PayrollEnvelope {...payroll} />}
      />
      <PreviewNav />
    </>
  );
}

function PreviewNav() {
  return (
    <nav
      aria-label="Preview states"
      className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-4 gap-y-2 border-t border-dashed border-foreground/20 px-5 py-6 text-sm"
    >
      {STATES.map((s) => (
        <a key={s} href={`#${s}`} className="underline underline-offset-4">
          {s}
        </a>
      ))}
    </nav>
  );
}
