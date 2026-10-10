"use client";

// Employer dashboard (SPEC.md F2, F3, blind server): the admin's passkey holds the treasury and the
// roster key; names and salaries are decrypted and payroll is built only in this browser.
// This file holds the data flow; the views it renders are props-only (see dev-preview/employer).

import { fieldToHex, randomField } from "@sigilo/core/field";
import { decryptRosterEntry, encryptRosterEntry, newInviteCode } from "@sigilo/core/roster";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { Button } from "@/components/ui/button";
import { ausdBalances, publicClient } from "@/lib/chain";
import { EXPLORER_URL } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { type EmployerKeys, employerKeysFromPrf } from "@/lib/identity";
import { createPasskey, getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { type PayrollStep, runPayroll } from "@/lib/payroll-client";
import { periodLabel, recentPeriods } from "@/lib/periods";
import { saveIdentity, useKnownIdentity } from "@/lib/public-identity";
import { formatCents, formatUsd } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";
import { DashboardView } from "./dashboard-view";
import { ConsoleNotice, secondaryPill } from "./parts";
import { type PeriodOption, PayrollEnvelope, type RunEntry } from "./payroll-envelope";
import { AddPersonForm, type TeamMember, TeamRegister } from "./team-register";
import { TreasuryCard } from "./treasury-card";
import { UnlockView } from "./unlock-view";

export function EmployerConsole() {
  const keys = useKeys("employer");
  const [pendingName, setPendingName] = useState<string | null>(null);
  return keys ? (
    <EmployerDashboard keys={keys} pendingName={pendingName} />
  ) : (
    <EmployerUnlock onCreate={setPendingName} />
  );
}

function EmployerUnlock({ onCreate }: { onCreate(name: string): void }) {
  const { setKeys } = useSigilo();
  const known = useKnownIdentity("employer");
  const [mode, setMode] = useState<"auto" | "create">("auto");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create: new passkey on this device. known: straight to the remembered passkey. otherwise:
  // any Sigilo company passkey the browser can reach (e.g. synced from another device).
  async function open(how: "create" | "known" | "any") {
    setBusy(true);
    setError(null);
    try {
      const result =
        how === "create"
          ? await createPasskey("employer", company.trim())
          : await getPrf("employer", how === "known" && known ? known : undefined);
      const keys = employerKeysFromPrf(result.prf);
      saveIdentity({
        role: "employer",
        credentialId: result.credentialId,
        ...(result.transports ? { transports: result.transports } : {}),
        address: keys.address,
        displayName: how === "create" ? company.trim() : (known?.displayName ?? ""),
      });
      if (how === "create") onCreate(company.trim());
      setKeys(keys);
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const signingIn = known && mode === "auto";

  return (
    <UnlockView
      mode={signingIn ? "welcome" : "create"}
      {...(signingIn && known.displayName ? { knownName: known.displayName } : {})}
      company={company}
      onCompanyChange={setCompany}
      busy={busy}
      error={error}
      onCreate={() => open("create")}
      onSignInKnown={() => open("known")}
      onSignInAny={() => open("any")}
      onCreateAnother={() => setMode("create")}
    />
  );
}

function EmployerDashboard({
  keys,
  pendingName,
}: {
  keys: EmployerKeys;
  pendingName: string | null;
}) {
  const { lock } = useSigilo();
  const { isAuthenticated } = useConvexAuth();
  const employer = useQuery(api.employers.mine, isAuthenticated ? {} : "skip");
  const register = useMutation(api.employers.register);

  useEffect(() => {
    if (employer === null && pendingName) {
      register({ name: pendingName, employerId: fieldToHex(randomField()) }).catch(() => {});
    }
  }, [employer, pendingName, register]);

  if (employer === undefined) return <ConsoleNotice busy>Opening your company…</ConsoleNotice>;
  if (employer === null) {
    return (
      <ConsoleNotice
        busy={Boolean(pendingName)}
        action={
          <Button variant="outline" onClick={lock} className={secondaryPill}>
            Lock
          </Button>
        }
      >
        {pendingName ? "Creating your company…" : "No company found for this passkey."}
      </ConsoleNotice>
    );
  }

  return (
    <DashboardView
      name={employer.name}
      verified={employer.verified}
      onLock={lock}
      treasury={<Treasury address={keys.address} />}
      team={<Employees keys={keys} employerId={employer.employerId} />}
      payroll={<Payroll keys={keys} employer={employer} />}
    />
  );
}

function Treasury({ address }: { address: `0x${string}` }) {
  const fund = useAction(api.faucet.fundTreasury);
  const [balance, setBalance] = useState<{ ausd: bigint; mon: bigint } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([ausdBalances([address]), publicClient.getBalance({ address })]).then(
        ([[ausd], mon]) => {
          if (alive) setBalance({ ausd: ausd!, mon });
        },
      );
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [address, version]);

  async function addFunds() {
    setBusy(true);
    setMessage(null);
    try {
      await fund({});
      setMessage("Funds added.");
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage(errorMessage(e, "Couldn't add test funds. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TreasuryCard
      balance={balance ? formatUsd(balance.ausd) : null}
      empty={balance?.ausd === 0n}
      busy={busy}
      message={message}
      onAddFunds={addFunds}
    />
  );
}

function Employees({ keys, employerId }: { keys: EmployerKeys; employerId: string }) {
  const roster = useQuery(api.employees.list);
  const add = useMutation(api.employees.add);
  const [name, setName] = useState("");
  const [salary, setSalary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addEmployee() {
    const cents = Math.round(Number(salary.replace(/[$,\s]/g, "")) * 100);
    if (!name.trim()) return setError("Add the person's name.");
    if (!Number.isFinite(cents) || cents <= 0) return setError("Add a monthly salary in USD.");
    setError(null);
    setBusy(true);
    try {
      // The code goes inside the encrypted roster entry so the link can be shared again later;
      // the server only ever sees its hash.
      const invite = newInviteCode();
      await add({
        roster: encryptRosterEntry(
          { name: name.trim(), monthlySalaryCents: cents, inviteCode: invite.code },
          keys.rosterKey,
          employerId,
        ),
        inviteCodeHash: invite.hash,
      });
      setName("");
      setSalary("");
    } catch (e) {
      setError(errorMessage(e, "Couldn't add this person. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const members: TeamMember[] | undefined = roster?.map((row) => {
    const entry = decryptRosterEntry(row.roster, keys.rosterKey, employerId);
    return {
      id: row._id,
      name: entry.name,
      salary: formatCents(entry.monthlySalaryCents),
      status:
        row.status === "active" ? (row.passportCommitment ? "passport" : "joined") : "invited",
      ...(entry.inviteCode ? { inviteCode: entry.inviteCode } : {}),
    };
  });

  return (
    <TeamRegister members={members}>
      <AddPersonForm
        name={name}
        salary={salary}
        onNameChange={setName}
        onSalaryChange={setSalary}
        onSubmit={addEmployee}
        busy={busy}
        error={error}
      />
    </TeamRegister>
  );
}

function Payroll({
  keys,
  employer,
}: {
  keys: EmployerKeys;
  employer: { name: string; employerId: string };
}) {
  const roster = useQuery(api.employees.list);
  const runs = useQuery(api.runs.list);
  const start = useMutation(api.runs.start);
  const submit = useMutation(api.runs.submit);
  const abort = useMutation(api.runs.abort);
  const [period, setPeriod] = useState(() => recentPeriods(1)[0]!);
  const [step, setStep] = useState<PayrollStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!roster) return;
    setError(null);
    try {
      await runPayroll({
        api: {
          start: (a) => start(a),
          submit: (a) => submit(a as Parameters<typeof submit>[0]),
          abort: (a) => abort(a as Parameters<typeof abort>[0]),
        },
        keys,
        employer,
        period,
        roster,
        onStep: setStep,
      });
    } catch (e) {
      setError(errorMessage(e, "Payroll didn't go through. Try again."));
      setStep(null);
    }
  }

  // Who this run would pay: the same people runPayroll pays (joined, with an account).
  const summary = useMemo(() => {
    if (!roster) return undefined;
    const payable = roster.filter((row) => row.status === "active" && row.account);
    const cents = payable.reduce(
      (sum, row) =>
        sum +
        decryptRosterEntry(row.roster, keys.rosterKey, employer.employerId).monthlySalaryCents,
      0,
    );
    return {
      people: payable.length,
      total: formatCents(cents),
      waiting: roster.filter((row) => row.status === "invited").length,
    };
  }, [roster, keys.rosterKey, employer.employerId]);

  const paidPeriods = new Set(
    (runs ?? [])
      .filter((run) => run.status === "done" || run.status === "committing" || run.payoutTxHash)
      .map((run) => run.period),
  );

  const periods: PeriodOption[] = recentPeriods(4).map((p) => {
    const label = periodLabel(p);
    const [month = label, year = ""] = label.split(" ");
    return { value: p, label, month, year, paid: paidPeriods.has(p) };
  });

  const entries: RunEntry[] | undefined = runs?.map((run) => ({
    id: run._id,
    period: periodLabel(run.period),
    total: run.payoutTxHash ? formatCents(run.totalNetCents) : null,
    status: run.status,
    paymentUrl: run.payoutTxHash ? `${EXPLORER_URL}/tx/${run.payoutTxHash}` : null,
  }));

  return (
    <PayrollEnvelope
      periods={periods}
      period={period}
      onPeriodChange={setPeriod}
      summary={summary}
      step={step}
      error={error}
      onRun={pay}
      runs={entries}
    />
  );
}
