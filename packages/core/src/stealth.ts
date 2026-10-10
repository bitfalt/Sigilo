// One-time accounts (SPEC.md §6.1): ERC-5564 scheme-1 stealth addresses on secp256k1.
//
// The sender (payroll engine, or a worker paying someone) derives a fresh account from the
// recipient's public payment profile and a random ephemeral key. Only the ephemeral public key
// and the amount travel to the recipient, inside an encrypted receipt; nothing is announced
// on-chain. The sender learns the shared tweak `h` but never the spend key, so only the
// recipient can spend.
//
// WARNING: the hashing of the shared point is part of every account ever paid. Changing it
// strands funds. Vectors are pinned in stealth.test.ts.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { type Address, type Hex, keccak256 } from "viem";
import { privateKeyToAddress, publicKeyToAddress } from "viem/accounts";

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;

export interface StealthKeys {
  spendKey: Uint8Array;
  viewKey: Uint8Array;
}

/** Public half of the stealth keys, registered with employers (compressed points). */
export interface PaymentProfile {
  spendPubKey: Uint8Array;
  viewPubKey: Uint8Array;
}

export interface OneTimeAccount {
  address: Address;
  /** Compressed `R = r·G`; goes in the recipient's encrypted receipt. */
  ephemeralPubKey: Hex;
}

export function paymentProfile(keys: StealthKeys): PaymentProfile {
  return {
    spendPubKey: secp256k1.getPublicKey(keys.spendKey, true),
    viewPubKey: secp256k1.getPublicKey(keys.viewKey, true),
  };
}

/** 66-byte hex (spend ‖ view), as stored with the employee record. */
export function encodePaymentProfile(profile: PaymentProfile): Hex {
  return `0x${bytesToHex(profile.spendPubKey)}${bytesToHex(profile.viewPubKey)}`;
}

export function decodePaymentProfile(hex: string): PaymentProfile {
  if (!/^0x[0-9a-fA-F]{132}$/.test(hex)) throw new Error("malformed payment profile");
  const bytes = hexToBytes(hex.slice(2));
  const profile = { spendPubKey: bytes.slice(0, 33), viewPubKey: bytes.slice(33) };
  // Throws on bytes that are not points on the curve.
  Point.fromBytes(profile.spendPubKey);
  Point.fromBytes(profile.viewPubKey);
  return profile;
}

/** h = keccak256(compressed shared point) mod n. */
function tweak(sharedPoint: Uint8Array): bigint {
  const h = BigInt(keccak256(sharedPoint)) % N;
  if (h === 0n) throw new Error("degenerate shared secret");
  return h;
}

/** Sender side: a fresh account for `profile`. Pass `ephemeralKey` only in tests. */
export function createOneTimeAccount(
  profile: PaymentProfile,
  ephemeralKey: Uint8Array = secp256k1.utils.randomSecretKey(),
): OneTimeAccount {
  const h = tweak(secp256k1.getSharedSecret(ephemeralKey, profile.viewPubKey, true));
  const stealthPoint = Point.fromBytes(profile.spendPubKey).add(Point.BASE.multiply(h));
  return {
    address: publicKeyToAddress(`0x${bytesToHex(stealthPoint.toBytes(false))}`),
    ephemeralPubKey: `0x${bytesToHex(secp256k1.getPublicKey(ephemeralKey, true))}`,
  };
}

/** Owner side: the private key of the account created with `ephemeralPubKey`. */
export function oneTimeAccountKey(
  keys: StealthKeys,
  ephemeralPubKey: Hex,
): { address: Address; privateKey: Hex } {
  const R = hexToBytes(ephemeralPubKey.slice(2));
  const h = tweak(secp256k1.getSharedSecret(keys.viewKey, R, true));
  const k = (BigInt(`0x${bytesToHex(keys.spendKey)}`) + h) % N;
  if (k === 0n) throw new Error("degenerate one-time key");
  const privateKey: Hex = `0x${k.toString(16).padStart(64, "0")}`;
  return { address: privateKeyToAddress(privateKey), privateKey };
}
