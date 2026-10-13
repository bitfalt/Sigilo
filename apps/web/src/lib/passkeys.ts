// Mera passkey ceremonies (SPEC.md §6). Each call is one passkey prompt, unlocked however the
// person's password manager does it (biometrics or device PIN). PRF outputs are returned to the caller, which must derive
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

// Whose passkey it is, written into its user handle when it's created. One phone often holds
// both a company's passkey and a person's, and the browser offers every Sigilo passkey at
// sign-in; the tag lets each door refuse the other kind instead of opening an empty account.
// Passkeys made before the tag existed carry a random handle and are accepted anywhere.
type Owner = "company" | "person";
const OWNER_TAG: Record<Owner, Uint8Array> = {
  company: new TextEncoder().encode("sigilo/company/"),
  person: new TextEncoder().encode("sigilo/person/"),
};
const ownerOf = (namespace: Namespace): Owner => (namespace === "employer" ? "company" : "person");

function taggedUserId(owner: Owner): Uint8Array {
  const tag = OWNER_TAG[owner];
  const id = new Uint8Array(tag.length + 16);
  id.set(tag);
  crypto.getRandomValues(id.subarray(tag.length));
  return id;
}

function taggedOwner(handle: Uint8Array | null): Owner | null {
  if (!handle) return null;
  for (const owner of ["company", "person"] as const) {
    const tag = OWNER_TAG[owner];
    if (handle.length > tag.length && tag.every((b, i) => handle[i] === b)) return owner;
  }
  return null;
}

/** The person picked a passkey that belongs to the other side (a company's, or a person's). */
export class WrongPasskeyError extends Error {
  constructor(readonly expected: Owner) {
    super(`expected a ${expected} passkey`);
  }
}

export interface KnownCredential {
  credentialId: string;
  transports?: readonly string[];
}

export interface PrfResult extends KnownCredential {
  prf: Uint8Array;
}

/** Sign-up: create a passkey on this device and evaluate the namespace's PRF. */
export async function createPasskey(namespace: Namespace, displayName: string): Promise<PrfResult> {
  const owner = ownerOf(namespace);
  // What the passkey picker shows, so a company's passkey can't be mistaken for a person's.
  const label = owner === "company" ? `${displayName} (company)` : displayName;
  const result = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: RP_NAME },
    user: { name: label, displayName: label },
    prfSalt: SALTS[namespace],
    webAuthnClient: deviceWebAuthnClient({ userId: taggedUserId(owner) }),
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
  let handle: Uint8Array | null = null;
  const result = await getPasskeyPrfOutput({
    rpId: RP_ID,
    prfSalt: SALTS[namespace],
    webAuthnClient: deviceWebAuthnClient({ onUserHandle: (h) => (handle = h) }),
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
  const owner = taggedOwner(handle);
  if (owner && owner !== ownerOf(namespace)) {
    result.prfOutput.fill(0);
    throw new WrongPasskeyError(ownerOf(namespace));
  }
  return { credentialId: result.credentialId, prf: result.prfOutput };
}

/** Human copy for passkey failures (SPEC.md §13: no jargon). */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof WrongPasskeyError) {
    return error.expected === "person"
      ? "That passkey opens a company account. Choose your own passkey, or create a new account."
      : "That passkey opens a personal account. Choose your company's passkey, or create a company account.";
  }
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This password manager can't secure a Sigilo account. When your browser asks where to save the passkey, choose Passwords (iCloud Keychain) or Google Password Manager.";
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
