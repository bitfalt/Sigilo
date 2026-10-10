"use client";

// Employer dashboard (SPEC.md F2, F3, blind server): the admin's passkey holds the treasury and the
// roster key; names and salaries are decrypted and payroll is built only in this browser.
// Unstyled until the UI pass.

import { fieldToHex, randomField } from "@sigilo/core/field";
import { decryptRosterEntry, encryptRosterEntry, newInviteCode } from "@sigilo/core/roster";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { Button } from "@/components/ui/button";
import { ausdBalances, publicClient } from "@/lib/chain";
import { EXPLORER_URL } from "@/lib/config";
import { type EmployerKeys, employerKeysFromPrf } from "@/lib/identity";
import { createPasskey, getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { type PayrollStep, runPayroll } from "@/lib/payroll-client";
import { periodLabel, recentPeriods } from "@/lib/periods";
import { saveIdentity, useBiometricName, useKnownIdentity } from "@/lib/public-identity";
import { formatCents, formatUsd } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";

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
  const biometric = useBiometricName();
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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {signingIn
          ? `Welcome back${known.displayName ? `, ${known.displayName}` : ""}`
          : "Sigilo for employers"}
      </h1>
      {signingIn ? (
        <>
          <Button size="lg" onClick={() => open("known")} disabled={busy}>
            {busy ? "Opening your company…" : `Continue with ${biometric}`}
          </Button>
          <button className="text-sm underline" onClick={() => setMode("create")} disabled={busy}>
            Create another company
          </button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Create your company account. Your {biometric} keeps your payroll and your team&apos;s
            salaries private, even from us.
          </p>
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Company name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <Button
            size="lg"
            onClick={() => open("create")}
            disabled={busy || company.trim().length < 2}
          >
            {busy ? "Creating your company…" : `Create with ${biometric}`}
          </Button>
          <button className="text-sm underline" onClick={() => open("any")} disabled={busy}>
            I already have a company account
          </button>
        </>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
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

  if (employer === undefined) return <p className="p-10 text-sm">Opening your company…</p>;
  if (employer === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-sm">
        <p>{pendingName ? "Creating your company…" : "No company found for this passkey."}</p>
        <Button variant="ghost" onClick={lock}>
          Lock
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{employer.name}</h1>
          <p className="text-muted-foreground text-sm">
            {employer.verified
              ? "Verified employer"
              : "Verification pending: payroll works, but won't count toward Income Passports yet."}
          </p>
        </div>
        <Button variant="ghost" onClick={lock}>
          Lock
        </Button>
      </header>
      <Treasury address={keys.address} />
      <Employees keys={keys} employerId={employer.employerId} />
      <Payroll keys={keys} employer={employer} />
    </main>
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
      setMessage(e instanceof Error ? e.message : "Couldn't add funds.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex items-end justify-between rounded-lg border p-4">
      <div>
        <p className="text-muted-foreground text-sm">Payroll balance</p>
        <p className="text-2xl font-semibold">{balance ? formatUsd(balance.ausd) : "…"}</p>
        <p className="text-muted-foreground text-xs">Digital dollars (AUSD)</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" onClick={addFunds} disabled={busy}>
          {busy ? "Adding funds…" : "Add test funds"}
        </Button>
        {message && <p className="text-muted-foreground text-xs">{message}</p>}
      </div>
    </section>
  );
}

function Employees({ keys, employerId }: { keys: EmployerKeys; employerId: string }) {
  const roster = useQuery(api.employees.list);
  const add = useMutation(api.employees.add);
  const [name, setName] = useState("");
  const [salary, setSalary] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function addEmployee() {
    const cents = Math.round(Number(salary) * 100);
    if (!name.trim() || !Number.isFinite(cents) || cents <= 0) return;
    const invite = newInviteCode();
    await add({
      roster: encryptRosterEntry(
        { name: name.trim(), monthlySalaryCents: cents },
        keys.rosterKey,
        employerId,
      ),
      inviteCodeHash: invite.hash,
    });
    setInviteLink(`${window.location.origin}/app/invite/${invite.code}`);
    setName("");
    setSalary("");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Team</h2>
      <div className="flex flex-col divide-y rounded-lg border">
        {(roster ?? []).map((row) => {
          const entry = decryptRosterEntry(row.roster, keys.rosterKey, employerId);
          return (
            <div key={row._id} className="flex justify-between p-3 text-sm">
              <span>{entry.name}</span>
              <span className="text-muted-foreground">
                {formatCents(entry.monthlySalaryCents)}/mo ·{" "}
                {row.status === "active"
                  ? row.passportCommitment
                    ? "Joined · Passport active"
                    : "Joined"
                  : "Invited"}
              </span>
            </div>
          );
        })}
        {roster?.length === 0 && <p className="text-muted-foreground p-3 text-sm">No one yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-36 rounded-md border px-3 py-2 text-sm"
          placeholder="Monthly salary (USD)"
          inputMode="decimal"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
        <Button onClick={addEmployee}>Add</Button>
      </div>
      {inviteLink && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Invite link (copy it now, it&apos;s shown only once)</p>
          <code className="break-all text-xs">{inviteLink}</code>
        </div>
      )}
    </section>
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
      setError(e instanceof Error ? e.message : "Payroll didn't go through.");
      setStep(null);
    }
  }

  const stepCopy: Record<PayrollStep, string> = {
    preparing: "Preparing private payslips…",
    approving: "Authorizing the payroll payment…",
    paying: "Paying your team privately…",
    recording: "Recording payslips…",
    done: "Payroll sent.",
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Payroll</h2>
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border px-3 py-2 text-sm"
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
        >
          {recentPeriods(4).map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
        <Button onClick={pay} disabled={step !== null && step !== "done"}>
          Run payroll
        </Button>
        {step && <span className="text-muted-foreground text-sm">{stepCopy[step]}</span>}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex flex-col divide-y rounded-lg border">
        {(runs ?? []).map((run) => (
          <div key={run._id} className="flex justify-between p-3 text-sm">
            <span>{periodLabel(run.period)}</span>
            <span className="text-muted-foreground">
              {formatCents(run.totalNetCents)} · {run.status}
              {run.payoutTxHash && (
                <>
                  {" · "}
                  <a
                    className="underline"
                    href={`${EXPLORER_URL}/tx/${run.payoutTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View payment
                  </a>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
