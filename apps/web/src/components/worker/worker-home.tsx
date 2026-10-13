"use client";

// Worker app (SPEC.md F4, F9): sign in with a passkey, then one balance and the payslips, all rebuilt
// from the passkey plus encrypted receipts. Screens are drawn by worker-views.tsx.

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import { DashboardView, UnlockView } from "@/components/worker/worker-views";
import type { WorkerKeys } from "@/lib/identity";
import { finishFirstRun, startFirstRun, takeFirstRun } from "@/lib/first-run";
import { passkeyErrorMessage } from "@/lib/passkeys";
import { loadWallet, type Wallet } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";

export function WorkerHome() {
  const keys = useKeys("worker");
  return keys ? <WorkerDashboard keys={keys} /> : <WorkerUnlock />;
}

/** Sign in or create an account; shown wherever an unlocked worker account is needed. */
export function WorkerUnlock() {
  const { known, create, signIn } = useWorkerAccess();
  // "Use a different account": show the new-account screen even though one is remembered.
  const [another, setAnother] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UnlockView
      known={another ? null : known}
      name={name}
      onNameChange={setName}
      busy={busy}
      error={error}
      onCreate={() =>
        run(() => {
          startFirstRun();
          return create(name);
        })
      }
      onSignInKnown={() => run(() => signIn(true))}
      onSignInAny={() => run(() => signIn(false))}
      onUseAnother={() => {
        setError(null);
        setAnother(true);
      }}
    />
  );
}

function WorkerDashboard({ keys }: { keys: WorkerKeys }) {
  const { lock } = useSigilo();
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.accounts.register);
  const [registered, setRegistered] = useState(false);
  const [firstRun, setFirstRun] = useState<{ ms: number; taps: number } | null>(null);

  useEffect(() => {
    if (!isAuthenticated || registered) return;
    register({ paymentProfile: keys.paymentProfile, receiptPublicKey: keys.receiptPublicKey })
      .then(() => {
        finishFirstRun();
        setFirstRun(takeFirstRun());
        setRegistered(true);
      })
      .catch(() => setRegistered(false));
  }, [isAuthenticated, registered, register, keys]);

  const stored = useQuery(api.receipts.mine, registered ? {} : "skip");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    loadWallet(stored, keys).then((w) => !cancelled && setWallet(w));
    return () => {
      cancelled = true;
    };
  }, [stored, keys]);

  const payslips = wallet
    ? wallet.receipts.flatMap(({ id, receipt }) =>
        receipt.kind === "payslip" ? [{ id, receipt }] : [],
      )
    : null;

  const transfers = wallet
    ? wallet.receipts.flatMap(({ id, receipt }) =>
        receipt.kind === "transfer" || receipt.kind === "advance" ? [{ id, receipt }] : [],
      )
    : [];

  return (
    <DashboardView
      balance={wallet ? wallet.balance : null}
      payslips={payslips}
      transfers={transfers}
      notice={
        firstRun
          ? `Your account was ready in ${(firstRun.ms / 1000).toFixed(1)} seconds, with ${firstRun.taps === 1 ? "1 tap" : `${firstRun.taps} taps`}. No app to install, no password.`
          : undefined
      }
      onLock={lock}
    />
  );
}
