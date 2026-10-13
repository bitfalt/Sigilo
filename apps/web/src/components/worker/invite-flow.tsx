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
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import {
  InviteJoiningView,
  InviteNoticeView,
  InvitePassportView,
  InviteWelcomeView,
} from "@/components/worker/worker-views";
import { passportSecretFromPrf } from "@/lib/identity";
import { finishFirstRun, startFirstRun, tapFirstRun } from "@/lib/first-run";
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
  const { lock } = useSigilo();
  // "Use a different account": offer a new account even though one is open or remembered.
  const [another, setAnother] = useState(false);
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
      else if (how === "create") {
        startFirstRun();
        await create(name);
      }
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
        const { passportActive } = await accept({ inviteCodeHash });
        // Already has an Income Passport from another employer: nothing more to activate.
        if (passportActive) {
          finishFirstRun();
          setStep("done");
          router.push("/app");
        } else {
          setStep("passport");
        }
      } catch {
        setError("We couldn't join you to your employer. Try the link again.");
        setStep("welcome");
      }
    })();
  }, [step, keys, isAuthenticated, register, accept, inviteCodeHash, router]);

  async function activatePassport() {
    setError(null);
    setStep("activating");
    tapFirstRun();
    try {
      const { prf } = await getPrf("passport", loadIdentity("worker") ?? undefined);
      const secret = passportSecretFromPrf(prf);
      await activate({ commitment: fieldToHex(commitment(secret)) });
      finishFirstRun();
      setStep("done");
      router.push("/app");
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setStep("passport");
    }
  }

  if (info === undefined) return <InviteNoticeView waiting title="Opening your invite…" />;
  if (info === null) {
    return (
      <InviteNoticeView
        title="This invite link isn't valid."
        body="Ask your employer to send you a new one."
      />
    );
  }
  if (!info.open && step === "welcome") {
    return (
      <InviteNoticeView
        title="This invite was already used."
        body="If you joined with it, open your account. If not, ask your employer for a new link."
        action={{ href: "/app", label: "Open your account" }}
      />
    );
  }

  if (step === "joining") return <InviteJoiningView employerName={info.employerName} />;
  if (step === "passport" || step === "activating" || step === "done") {
    return (
      <InvitePassportView
        activating={step === "activating"}
        done={step === "done"}
        error={error}
        onActivate={activatePassport}
      />
    );
  }

  return (
    <InviteWelcomeView
      employerName={info.employerName}
      access={keys ? "open" : known && !another ? "known" : "new"}
      name={name}
      onNameChange={setName}
      error={error}
      onJoinOpen={() => join("open")}
      onJoinKnown={() => join("known")}
      onJoinAny={() => join("any")}
      onUseAnother={() => {
        setError(null);
        setAnother(true);
        if (keys) lock();
      }}
      onCreate={() => join("create")}
    />
  );
}
