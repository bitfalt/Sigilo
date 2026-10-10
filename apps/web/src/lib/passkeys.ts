// Mera passkey ceremonies (SPEC.md §6). Each call is one Face ID / Touch ID prompt. PRF outputs
// are returned to the caller, which must derive keys and wipe them immediately.

import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { SALT_ACCOUNT, SALT_EMPLOYER, SALT_PASSPORT } from "@sigilo/core/keys";

import { RP_ID, RP_NAME } from "./config";

export type Namespace = "account" | "employer" | "passport";

const SALTS: Record<Namespace, Uint8Array> = {
  account: SALT_ACCOUNT,
  employer: SALT_EMPLOYER,
  passport: SALT_PASSPORT,
};

export interface PrfResult {
  credentialId: string;
  prf: Uint8Array;
}

/** Sign-up: create a passkey and evaluate the namespace's PRF. */
export async function createPasskey(namespace: Namespace, displayName: string): Promise<PrfResult> {
  const result = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: RP_NAME },
    user: { name: displayName, displayName },
    prfSalt: SALTS[namespace],
  });
  return { credentialId: result.credentialId, prf: result.prfOutput };
}

/** Sign-in or step-up: evaluate the namespace's PRF on an existing passkey. */
export async function getPrf(namespace: Namespace, credentialId?: string): Promise<PrfResult> {
  const result = await getPasskeyPrfOutput({
    rpId: RP_ID,
    prfSalt: SALTS[namespace],
    ...(credentialId ? { credential: { credentialId } } : {}),
  });
  return { credentialId: result.credentialId, prf: result.prfOutput };
}

/** Human copy for passkey failures (SPEC.md §13: no jargon). */
export function passkeyErrorMessage(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This device's password manager can't hold a Sigilo key yet. Try Safari with iCloud Keychain, or Chrome with Google Password Manager.";
      case "PASSKEY_OPERATION_FAILED":
        return "Face ID was cancelled. Try again when you're ready.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser is missing secure features Sigilo needs. Try another browser.";
      default:
        return "Something went wrong unlocking your account. Try again.";
    }
  }
  return "Something went wrong unlocking your account. Try again.";
}
