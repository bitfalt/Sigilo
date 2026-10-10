"use client";

// Worker app (SPEC.md F4, F9): unlock with Face ID, then one balance and the payslips, all rebuilt
// from the passkey plus encrypted receipts. Unstyled until the UI pass.

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { Button } from "@/components/ui/button";
import { type WorkerKeys, workerKeysFromPrf } from "@/lib/identity";
import { getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { periodLabel } from "@/lib/periods";
import { loadIdentity, saveIdentity } from "@/lib/public-identity";
import { formatCents, formatUsd, loadWallet, type Wallet } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";

export function WorkerHome() {
  const keys = useKeys("worker");
  return keys ? <WorkerDashboard keys={keys} /> : <WorkerUnlock />;
}

function WorkerUnlock() {
  const { setKeys } = useSigilo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const known = loadIdentity("worker");
      const { credentialId, prf } = await getPrf("account", known?.credentialId);
      const keys = workerKeysFromPrf(prf);
      saveIdentity({
        role: "worker",
        credentialId,
        address: keys.address,
        displayName: known?.displayName ?? "",
      });
      setKeys(keys);
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Your Sigilo account</h1>
      <Button size="lg" onClick={unlock} disabled={busy}>
        {busy ? "Opening your account…" : "Continue with Face ID"}
      </Button>
      <p className="text-muted-foreground max-w-xs text-sm">
        New here? Open the invite link your employer sent you.
      </p>
      {error && <p className="text-destructive max-w-xs text-sm">{error}</p>}
    </main>
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

  const payslips = (wallet?.receipts ?? []).filter((r) => r.receipt.kind === "payslip");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <section className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">Balance</p>
        <p className="text-4xl font-semibold tracking-tight">
          {wallet ? formatUsd(wallet.balance) : "…"}
        </p>
        <p className="text-muted-foreground text-xs">Digital dollars (AUSD)</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Payslips</h2>
        {payslips.length === 0 && (
          <p className="text-muted-foreground text-sm">Your first payslip will show up here.</p>
        )}
        {payslips.map(({ id, receipt }) =>
          receipt.kind === "payslip" ? (
            <div key={id} className="flex justify-between border-b py-2 text-sm">
              <span>
                You got paid · {receipt.employer.name} · {periodLabel(receipt.period)}
              </span>
              <span className="font-medium">{formatCents(receipt.netCents)}</span>
            </div>
          ) : null,
        )}
      </section>

      <Button variant="ghost" onClick={lock} className="self-start">
        Lock
      </Button>
    </main>
  );
}
