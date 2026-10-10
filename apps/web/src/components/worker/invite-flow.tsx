"use client";

// Accept an employer invite (SPEC.md F1): one passkey prompt creates the account, a second one
// activates the Income Passport. Only public keys and the passport commitment leave the device.

import { commitment } from "@sigilo/core/hash";
import { fieldToHex } from "@sigilo/core/field";
import { hashInviteCode } from "@sigilo/core/roster";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useKeys } from "@/components/sigilo-provider";
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import { Button } from "@/components/ui/button";
import { passportSecretFromPrf } from "@/lib/identity";
import { getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { loadIdentity } from "@/lib/public-identity";

import { api } from "../../../convex/_generated/api";

type Step = "welcome" | "joining" | "passport" | "activating" | "done";

export function InviteFlow({ code }: { code: string }) {
  const router = useRouter();
  const inviteCodeHash = useMemo(() => hashInviteCode(code), [code]);
  const info = useQuery(api.employees.inviteInfo, { inviteCodeHash });
  const keys = useKeys("worker");
  const { known, create, signIn } = useWorkerAccess();
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.accounts.register);
  const accept = useMutation(api.employees.acceptInvite);
  const activate = useMutation(api.employees.setPassportCommitment);

  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);

  // One passkey per person: reuse the account already open in this tab or remembered on this
  // device, and only create a new one for first-timers.
  async function join(how: "open" | "known" | "any" | "create") {
    setError(null);
    try {
      if (how === "known") await signIn(true);
      else if (how === "any") await signIn(false);
      else if (how === "create") await create(name);
      setStep("joining");
    } catch (e) {
      setError(passkeyErrorMessage(e));
    }
  }

  // Once Convex has a session for the account: register its keys and accept the invite.
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
          {keys ? (
            <Button size="lg" onClick={() => join("open")}>
              Join {info.employerName}
            </Button>
          ) : known ? (
            <>
              <Button size="lg" onClick={() => join("known")}>
                Sign in with passkey to join
              </Button>
              <button className="text-sm underline" onClick={() => join("any")}>
                Use a different account
              </button>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Your name
                <input
                  className="rounded-md border px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <Button size="lg" onClick={() => join("create")} disabled={name.trim().length < 2}>
                Create my account
              </Button>
              <button className="text-sm underline" onClick={() => join("any")}>
                I already have a Sigilo account
              </button>
            </>
          )}
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
