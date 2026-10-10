// Mera passkey ceremonies (SPEC.md §6). Each call is one biometric prompt (Face ID, Touch ID,
// Android biometrics, Windows Hello). PRF outputs are returned to the caller, which must derive
// keys and wipe them immediately.

import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialTransport,
} from "@category-labs/mera";
import { SALT_ACCOUNT, SALT_EMPLOYER, SALT_PASSPORT } from "@sigilo/core/keys";

import { RP_ID, RP_NAME } from "./config";
import { deviceWebAuthnClient } from "./webauthn-client";

export type Namespace = "account" | "employer" | "passport";

const SALTS: Record<Namespace, Uint8Array> = {
  account: SALT_ACCOUNT,
  employer: SALT_EMPLOYER,
  passport: SALT_PASSPORT,
};

export interface KnownCredential {
  credentialId: string;
  transports?: readonly string[];
}

export interface PrfResult extends KnownCredential {
  prf: Uint8Array;
}

/** Sign-up: create a passkey on this device and evaluate the namespace's PRF. */
export async function createPasskey(namespace: Namespace, displayName: string): Promise<PrfResult> {
  const result = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: RP_NAME },
    user: { name: displayName, displayName },
    prfSalt: SALTS[namespace],
    webAuthnClient: deviceWebAuthnClient,
  });
  return {
    credentialId: result.credentialId,
    ...(result.transports ? { transports: result.transports } : {}),
    prf: result.prfOutput,
  };
}

/**
 * Sign-in or step-up: evaluate the namespace's PRF on an existing passkey. Without `credential`,
 * the browser offers every Sigilo passkey it can reach (including ones synced from another
 * device), which is the stateless path.
 */
export async function getPrf(
  namespace: Namespace,
  credential?: KnownCredential,
): Promise<PrfResult> {
  const result = await getPasskeyPrfOutput({
    rpId: RP_ID,
    prfSalt: SALTS[namespace],
    webAuthnClient: deviceWebAuthnClient,
    ...(credential
      ? {
          credential: {
            credentialId: credential.credentialId,
            ...(credential.transports
              ? { transports: credential.transports as PasskeyCredentialTransport[] }
              : {}),
          },
        }
      : {}),
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
        return "We couldn't open your account on this device. If you're new, create your account first; otherwise try again.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser is missing secure features Sigilo needs. Try another browser.";
      default:
        return "Something went wrong opening your account. Try again.";
    }
  }
  return "Something went wrong opening your account. Try again.";
}
