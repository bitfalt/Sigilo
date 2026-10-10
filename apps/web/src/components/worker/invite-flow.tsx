"use client";

// Accept an employer invite (SPEC.md F1): one passkey prompt creates the account, a second one
// activates the Income Passport. Only public keys and the passport commitment leave the device.

import { commitment } from "@sigilo/core/hash";
import { fieldToHex } from "@sigilo/core/field";
import { hashInviteCode } from "@sigilo/core/roster";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { Button } from "@/components/ui/button";
import { passportSecretFromPrf, workerKeysFromPrf } from "@/lib/identity";
import { createPasskey, getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { loadIdentity, saveIdentity } from "@/lib/public-identity";

import { api } from "../../../convex/_generated/api";

type Step = "welcome" | "joining" | "passport" | "activating" | "done";

export function InviteFlow({ code }: { code: string }) {
  const router = useRouter();
  const inviteCodeHash = useMemo(() => hashInviteCode(code), [code]);
  const info = useQuery(api.employees.inviteInfo, { inviteCodeHash });
  const keys = useKeys("worker");
  const { setKeys } = useSigilo();
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.accounts.register);
  const accept = useMutation(api.employees.acceptInvite);
  const activate = useMutation(api.employees.setPassportCommitment);

  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);

  async function createAccount() {
    setError(null);
    try {
      const created = await createPasskey("account", name.trim() || "Sigilo account");
      const next = workerKeysFromPrf(created.prf);
      saveIdentity({
        role: "worker",
        credentialId: created.credentialId,
        ...(created.transports ? { transports: created.transports } : {}),
        address: next.address,
        displayName: name.trim(),
      });
      setKeys(next);
      setStep("joining");
    } catch (e) {
      setError(passkeyErrorMessage(e));
    }
  }

  // Once Convex has a session for the new keys: register them and accept the invite.
  useEffect(() => {
    if (step !== "joining" || !keys || !isAuthenticated) return;
    (async () => {
      try {
        await register({
          paymentProfile: keys.paymentProfile,
          receiptPublicKey: keys.receiptPublicKey,
        });
        await accept({ inviteCodeHash });
        setStep("passport");
      } catch {
        setError("We couldn't join you to your employer. Try the link again.");
        setStep("welcome");
      }
    })();
  }, [step, keys, isAuthenticated, register, accept, inviteCodeHash]);

  async function activatePassport() {
    setError(null);
    setStep("activating");
    try {
      const { prf } = await getPrf("passport", loadIdentity("worker") ?? undefined);
      const secret = passportSecretFromPrf(prf);
      await activate({ commitment: fieldToHex(commitment(secret)) });
      setStep("done");
      router.push("/app");
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setStep("passport");
    }
  }

  if (info === undefined) return <Centered>Opening your invite…</Centered>;
  if (info === null) return <Centered>This invite link isn&apos;t valid.</Centered>;
  if (!info.open && step === "welcome") {
    return (
      <Centered>
        This invite was already used.{" "}
        <a className="underline" href="/app">
          Open your account
        </a>
      </Centered>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6">
      {step === "welcome" && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {info.employerName} pays you with Sigilo
          </h1>
          <p className="text-muted-foreground text-sm">
            Your salary stays private. Only you can see it.
          </p>
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Your name (stays on this device)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="lg" onClick={createAccount}>
            Create my account
          </Button>
        </>
      )}
      {step === "joining" && <p className="text-sm">Setting up your private account…</p>}
      {(step === "passport" || step === "activating") && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Activate your Income Passport</h1>
          <p className="text-muted-foreground text-sm">
            Prove what you earn to lenders and landlords without showing your salary or your
            employer.
          </p>
          <Button size="lg" onClick={activatePassport} disabled={step === "activating"}>
            {step === "activating" ? "Preparing your passport…" : "Activate Income Passport"}
          </Button>
        </>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 text-center text-sm">
      <p>{children}</p>
    </main>
  );
}
