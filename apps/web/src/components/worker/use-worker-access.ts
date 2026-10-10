"use client";

// Create or open a worker account with a passkey (account namespace). Shared by /app and the
// invite page so a person ends up with one passkey, whichever door they come in through.

import { useSigilo } from "@/components/sigilo-provider";
import { type WorkerKeys, workerKeysFromPrf } from "@/lib/identity";
import { createPasskey, getPrf } from "@/lib/passkeys";
import { saveIdentity, useKnownIdentity } from "@/lib/public-identity";

export function useWorkerAccess() {
  const { setKeys } = useSigilo();
  const known = useKnownIdentity("worker");

  /** New passkey on this device. */
  async function create(displayName: string): Promise<WorkerKeys> {
    const created = await createPasskey("account", displayName.trim() || "Sigilo account");
    const keys = workerKeysFromPrf(created.prf);
    saveIdentity({
      role: "worker",
      credentialId: created.credentialId,
      ...(created.transports ? { transports: created.transports } : {}),
      address: keys.address,
      displayName: displayName.trim(),
    });
    setKeys(keys);
    return keys;
  }

  /**
   * Existing passkey: the one remembered on this device, or (when `useKnown` is false) any
   * Sigilo passkey the browser can reach, e.g. one synced from another device.
   */
  async function signIn(useKnown: boolean): Promise<WorkerKeys> {
    const credential = useKnown && known ? known : undefined;
    const result = await getPrf("account", credential);
    const keys = workerKeysFromPrf(result.prf);
    saveIdentity({
      role: "worker",
      credentialId: result.credentialId,
      address: keys.address,
      displayName: credential?.displayName ?? "",
    });
    setKeys(keys);
    return keys;
  }

  return { known, create, signIn };
}
