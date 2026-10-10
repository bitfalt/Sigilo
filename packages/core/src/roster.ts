// Employer roster encryption and invite codes ("blind server", SPEC.md §5). Names and salaries
// are encrypted in the employer's browser with the passkey-derived roster key; the server stores
// ciphertext and a hash of each invite code, never the code itself.
//
// Entry envelope = base64url(version ‖ nonce(24) ‖ XChaCha20-Poly1305(rosterKey, nonce, AAD)).
// AAD = "sigilo/roster/v1" ‖ employerId, so an entry can't be moved to another employer.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";

const VERSION = 1;
const AAD_PREFIX = new TextEncoder().encode("sigilo/roster/v1");

export interface RosterEntry {
  name: string;
  /** Gross monthly salary, USD cents. */
  monthlySalaryCents: number;
}

export class RosterDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterDecryptionError";
  }
}

const aad = (employerId: string) =>
  concatBytes(AAD_PREFIX, new TextEncoder().encode(employerId.toLowerCase()));

export function encryptRosterEntry(
  entry: RosterEntry,
  rosterKey: Uint8Array,
  employerId: string,
  nonce: Uint8Array = randomBytes(24),
): string {
  if (!Number.isSafeInteger(entry.monthlySalaryCents) || entry.monthlySalaryCents < 0) {
    throw new RangeError("salary must be a non-negative integer number of cents");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(entry));
  const ciphertext = xchacha20poly1305(rosterKey, nonce, aad(employerId)).encrypt(plaintext);
  return base64urlnopad.encode(concatBytes(Uint8Array.of(VERSION), nonce, ciphertext));
}

export function decryptRosterEntry(
  envelope: string,
  rosterKey: Uint8Array,
  employerId: string,
): RosterEntry {
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(envelope);
  } catch {
    throw new RosterDecryptionError("malformed roster entry");
  }
  if (bytes.length < 1 + 24 + 16 || bytes[0] !== VERSION) {
    throw new RosterDecryptionError("unsupported roster entry");
  }
  try {
    const plaintext = xchacha20poly1305(rosterKey, bytes.subarray(1, 25), aad(employerId)).decrypt(
      bytes.subarray(25),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as RosterEntry;
  } catch {
    throw new RosterDecryptionError("cannot decrypt roster entry");
  }
}

/** A fresh 128-bit invite code for the link, and the hash the server stores. */
export function newInviteCode(): { code: string; hash: string } {
  const code = base64urlnopad.encode(randomBytes(16));
  return { code, hash: hashInviteCode(code) };
}

export function hashInviteCode(code: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`sigilo/invite/v1:${code}`)));
}
