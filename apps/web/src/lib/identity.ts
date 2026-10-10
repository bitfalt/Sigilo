// In-memory key material for a signed-in worker or employer admin (SPEC.md §6). Derived from a
// passkey PRF output on every unlock; nothing here is ever persisted. `lock()` ends the Mera
// signing session and wipes the secrets.

import { createSecp256k1SigningSession, type Secp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { deriveAccountKeys, deriveEmployerKeys, derivePassportSecret } from "@sigilo/core/keys";
import { encodePaymentProfile, paymentProfile, type StealthKeys } from "@sigilo/core/stealth";
import { type LocalAccount, toHex } from "viem";

interface Session {
  session: Secp256k1SigningSession;
  account: LocalAccount;
  address: `0x${string}`;
}

export interface WorkerKeys extends Session {
  role: "worker";
  stealth: StealthKeys;
  receiptKeys: { secretKey: Uint8Array; publicKey: Uint8Array };
  /** Public keys registered with Convex (accounts.register). */
  paymentProfile: `0x${string}`;
  receiptPublicKey: `0x${string}`;
}

export interface EmployerKeys extends Session {
  role: "employer";
  rosterKey: Uint8Array;
}

export type Keys = WorkerKeys | EmployerKeys;

function openSession(privateKey: Uint8Array): Session {
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  const account = toViemAccount(session);
  return { session, account, address: account.address };
}

/** Worker keys from the ACCOUNT namespace. Wipes `prf`. */
export function workerKeysFromPrf(prf: Uint8Array): WorkerKeys {
  const derived = deriveAccountKeys(prf);
  prf.fill(0);
  return {
    role: "worker",
    ...openSession(derived.evmPrivateKey),
    stealth: derived.stealth,
    receiptKeys: derived.payslip,
    paymentProfile: encodePaymentProfile(paymentProfile(derived.stealth)),
    receiptPublicKey: toHex(derived.payslip.publicKey),
  };
}

/** Employer admin keys from the EMPLOYER namespace. Wipes `prf`. */
export function employerKeysFromPrf(prf: Uint8Array): EmployerKeys {
  const derived = deriveEmployerKeys(prf);
  prf.fill(0);
  return { role: "employer", ...openSession(derived.treasuryKey), rosterKey: derived.rosterKey };
}

/** Passport secret from a step-up PRF output. Wipes `prf`; the caller drops the secret ASAP. */
export function passportSecretFromPrf(prf: Uint8Array): bigint {
  const secret = derivePassportSecret(prf);
  prf.fill(0);
  return secret;
}

/** End the signing session and wipe every secret held by `keys`. */
export function lock(keys: Keys): void {
  keys.session.end();
  if (keys.role === "worker") {
    keys.stealth.spendKey.fill(0);
    keys.stealth.viewKey.fill(0);
    keys.receiptKeys.secretKey.fill(0);
  } else {
    keys.rosterKey.fill(0);
  }
}
