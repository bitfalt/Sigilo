// Encrypted receipts (SPEC.md F3.6): payslips and other incoming-payment notes, readable only by
// the recipient's X25519 key (derivePayslipKeypair). The server stores ciphertext only.
//
// Envelope = base64url(version ‖ ephemeralPub ‖ nonce ‖ ciphertext+tag):
//   shared = X25519(ephemeralSecret, recipientPub)
//   key    = HKDF-SHA256(shared, salt = ephemeralPub ‖ recipientPub, info = "sigilo/receipt/v1")
//   AEAD   = XChaCha20-Poly1305(key, nonce), AAD = version ‖ ephemeralPub
//
// WARNING: the envelope format is part of every stored receipt. Pinned in receipts.test.ts.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import type { Address, Hex } from "viem";

import type { MerklePath } from "./merkle";
import type { PassportPayslip } from "./passport";

const VERSION = 1;
const INFO = new TextEncoder().encode("sigilo/receipt/v1");
const HEADER = 1 + 32 + 24;

/** One fixed-size piece sent to a one-time account (core/stealth.ts). */
export interface ReceiptPiece {
  account: Address;
  ephemeralPubKey: Hex;
  /** Token base units, as a decimal string. */
  amount: string;
}

export interface PayslipReceipt {
  v: 1;
  kind: "payslip";
  employer: { name: string; employerId: Hex };
  /** Month index (core/period.ts). */
  period: number;
  grossCents: string;
  deductions: { label: string; amountCents: string }[];
  netCents: string;
  token: "AUSD";
  pieces: ReceiptPiece[];
  payoutTxHash: Hex;
  /**
   * Everything the Income Passport needs for this period (core/passport.ts). Absent when the
   * worker had not activated their passport before the run.
   */
  commitment?: {
    salt: Hex;
    runRoot: Hex;
    runPath: { siblings: Hex[]; isRight: boolean[] };
  };
  /** Unix milliseconds. */
  issuedAt: number;
}

/** Money that isn't payroll: a salary advance or a payment from another Sigilo account. */
export interface TransferReceipt {
  v: 1;
  kind: "advance" | "transfer";
  from: string;
  memo?: string;
  token: "AUSD" | "CTK";
  pieces: ReceiptPiece[];
  txHash: Hex;
  issuedAt: number;
}

export type Receipt = PayslipReceipt | TransferReceipt;

export class ReceiptDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptDecryptionError";
  }
}

function deriveKey(shared: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array) {
  if (shared.every((b) => b === 0)) throw new ReceiptDecryptionError("low-order public key");
  return hkdf(sha256, shared, concatBytes(ephemeralPub, recipientPub), INFO, 32);
}

/** Encrypt `receipt` to `recipientPublicKey`. `ephemeralSecret` and `nonce` are for tests only. */
export function encryptReceipt(
  receipt: Receipt,
  recipientPublicKey: Uint8Array,
  opts: { ephemeralSecret?: Uint8Array; nonce?: Uint8Array } = {},
): string {
  const ephemeralSecret = opts.ephemeralSecret ?? x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralSecret);
  const nonce = opts.nonce ?? randomBytes(24);
  const key = deriveKey(
    x25519.getSharedSecret(ephemeralSecret, recipientPublicKey),
    ephemeralPub,
    recipientPublicKey,
  );
  const header = concatBytes(Uint8Array.of(VERSION), ephemeralPub);
  const plaintext = new TextEncoder().encode(JSON.stringify(receipt));
  const ciphertext = xchacha20poly1305(key, nonce, header).encrypt(plaintext);
  return base64urlnopad.encode(concatBytes(header, nonce, ciphertext));
}

/** Decrypt with the recipient's X25519 secret key. Throws on any tampering or wrong key. */
export function decryptReceipt(envelope: string, secretKey: Uint8Array): Receipt {
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(envelope);
  } catch {
    throw new ReceiptDecryptionError("malformed envelope");
  }
  if (bytes.length < HEADER + 16) throw new ReceiptDecryptionError("envelope too short");
  if (bytes[0] !== VERSION) throw new ReceiptDecryptionError(`unknown version ${bytes[0]}`);

  const header = bytes.subarray(0, 33);
  const ephemeralPub = bytes.subarray(1, 33);
  const nonce = bytes.subarray(33, HEADER);
  const key = deriveKey(
    x25519.getSharedSecret(secretKey, ephemeralPub),
    ephemeralPub,
    x25519.getPublicKey(secretKey),
  );
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, nonce, header).decrypt(bytes.subarray(HEADER));
  } catch {
    throw new ReceiptDecryptionError("cannot decrypt receipt");
  }
  const receipt = JSON.parse(new TextDecoder().decode(plaintext)) as Receipt;
  if (receipt.v !== 1 || !["payslip", "advance", "transfer"].includes(receipt.kind)) {
    throw new ReceiptDecryptionError("unexpected receipt contents");
  }
  return receipt;
}

/** What `buildPassportInputs` needs from a payslip. */
export function payslipToPassportPayslip(r: PayslipReceipt): PassportPayslip {
  if (!r.commitment) throw new Error(`payslip ${r.period} has no passport commitment`);
  const runPath: MerklePath = {
    siblings: r.commitment.runPath.siblings.map(BigInt),
    isRight: r.commitment.runPath.isRight,
  };
  return {
    period: r.period,
    gross: BigInt(r.grossCents),
    salt: BigInt(r.commitment.salt),
    runRoot: BigInt(r.commitment.runRoot),
    runPath,
  };
}
