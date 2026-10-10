"use client";

// Worker app (SPEC.md F4, F9): sign in with a passkey, then one balance and the payslips, all rebuilt
// from the passkey plus encrypted receipts. Screens are drawn by worker-views.tsx.

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import { DashboardView, UnlockView } from "@/components/worker/worker-views";
import type { WorkerKeys } from "@/lib/identity";
import { passkeyErrorMessage } from "@/lib/passkeys";
import { loadWallet, type Wallet } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";

export function WorkerHome() {
  const keys = useKeys("worker");
  return keys ? <WorkerDashboard keys={keys} /> : <WorkerUnlock />;
}

function WorkerUnlock() {
  const { known, create, signIn } = useWorkerAccess();
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
      known={known}
      name={name}
      onNameChange={setName}
      busy={busy}
      error={error}
      onCreate={() => run(() => create(name))}
      onSignInKnown={() => run(() => signIn(true))}
      onSignInAny={() => run(() => signIn(false))}
    />
  );
}

function WorkerDashboard({ keys }: { keys: WorkerKeys }) {
  const { lock } = useSigilo();
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.accounts.register);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || registered) return;
    register({ paymentProfile: keys.paymentProfile, receiptPublicKey: keys.receiptPublicKey })
      .then(() => setRegistered(true))
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

  return (
    <DashboardView balance={wallet ? wallet.balance : null} payslips={payslips} onLock={lock} />
  );
}
