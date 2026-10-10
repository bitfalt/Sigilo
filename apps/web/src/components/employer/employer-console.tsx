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
import { errorMessage } from "@/lib/errors";
import { type EmployerKeys, employerKeysFromPrf } from "@/lib/identity";
import { createPasskey, getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { type PayrollStep, runPayroll } from "@/lib/payroll-client";
import { periodLabel, recentPeriods } from "@/lib/periods";
import { saveIdentity, useKnownIdentity } from "@/lib/public-identity";
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
            {busy ? "Opening your company…" : "Sign in with passkey"}
          </Button>
          <button className="text-sm underline" onClick={() => setMode("create")} disabled={busy}>
            Create another company
          </button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Create your company account. It&apos;s secured with a passkey, so there&apos;s no
            password, and your team&apos;s salaries stay private, even from us.
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
            {busy ? "Creating your company…" : "Create company account"}
          </Button>
          <button className="text-sm underline" onClick={() => open("any")} disabled={busy}>
            Sign in with a passkey
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
      setMessage(errorMessage(e, "Couldn't add test funds. Try again."));
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

function inviteUrl(code: string): string {
  return `${window.location.origin}/app/invite/${code}`;
}

/** Copy (and, on phones, share) an invite link. */
function InviteActions({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowLink(true); // Clipboard blocked: show the link to copy by hand.
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {showLink && <code className="text-xs break-all">{inviteUrl(code)}</code>}
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? "Copied" : "Copy invite link"}
      </Button>
      {canShare && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigator
              .share({
                title: "Join your team on Sigilo",
                text: `${name}, get paid with Sigilo`,
                url: inviteUrl(code),
              })
              .catch(() => {})
          }
        >
          Share
        </Button>
      )}
    </span>
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Team</h2>
      <div className="flex flex-col divide-y rounded-lg border">
        {(roster ?? []).map((row) => {
          const entry = decryptRosterEntry(row.roster, keys.rosterKey, employerId);
          const status =
            row.status === "active"
              ? row.passportCommitment
                ? "Joined, Income Passport active"
                : "Joined"
              : "Invite sent";
          return (
            <div
              key={row._id}
              className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{entry.name}</p>
                <p className="text-muted-foreground">
                  {formatCents(entry.monthlySalaryCents)} a month. {status}.
                </p>
              </div>
              {row.status === "invited" && entry.inviteCode && (
                <InviteActions code={entry.inviteCode} name={entry.name} />
              )}
            </div>
          );
        })}
        {roster?.length === 0 && (
          <p className="text-muted-foreground p-3 text-sm">
            Add someone below to create their invite link.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Name
          <input
            className="rounded-md border px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:w-44">
          Monthly salary (USD)
          <input
            className="rounded-md border px-3 py-2"
            inputMode="decimal"
            placeholder="2400"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
          />
        </label>
        <Button onClick={addEmployee} disabled={busy}>
          {busy ? "Adding…" : "Add and create invite"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
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
      setError(errorMessage(e, "Payroll didn't go through. Try again."));
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
