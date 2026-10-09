// Key schedule derived from Mera passkey PRF outputs (SPEC.md §6, .claude/skills/mera).
//
// WARNING: every label below is part of the account identity. Changing a label or the
// derivation path silently produces different keys and orphans existing accounts.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { BN254_R } from "./constants";

const utf8 = (s: string) => new TextEncoder().encode(s);

/** PRF salt (namespace) evaluated at sign-up / sign-in. One prompt per session. */
export const SALT_ACCOUNT = sha256(utf8("sigilo/account/v1"));
/** PRF salt (namespace) evaluated only on step-up (share passport, accept advance). */
export const SALT_PASSPORT = sha256(utf8("sigilo/passport/v1"));

export const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

const LABEL_UNLINK = "sigilo/unlink/v1";
const LABEL_PAYSLIPS = "sigilo/payslips/v1";
const LABEL_PASSPORT_SECRET = "sigilo/passport-secret/v1";

function assertPrf(prf: Uint8Array): void {
  if (prf.length !== 32) throw new Error(`expected a 32-byte PRF output, got ${prf.length}`);
}

/** EVM private key via Mera's standard mapping: PRF entropy → BIP-39 seed → BIP-32 path. */
export function deriveEvmPrivateKey(prfAccount: Uint8Array): Uint8Array {
  assertPrf(prfAccount);
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfAccount, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(EVM_DERIVATION_PATH);
  if (!node.privateKey) throw new Error("derivation produced no key");
  return node.privateKey;
}

/** 64-byte seed for Unlink `account.fromSeed` (seed-backed accounts support `execute`). */
export function deriveUnlinkSeed(prfAccount: Uint8Array): Uint8Array {
  assertPrf(prfAccount);
  return hkdf(sha256, prfAccount, undefined, utf8(LABEL_UNLINK), 64);
}

/** X25519 keypair the employer encrypts payslips to. */
export function derivePayslipKeypair(prfAccount: Uint8Array): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  assertPrf(prfAccount);
  const secretKey = hkdf(sha256, prfAccount, undefined, utf8(LABEL_PAYSLIPS), 32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** Passport secret as a BN254 field element (64 bytes reduced mod r to avoid bias). */
export function derivePassportSecret(prfPassport: Uint8Array): bigint {
  assertPrf(prfPassport);
  const wide = hkdf(sha256, prfPassport, undefined, utf8(LABEL_PASSPORT_SECRET), 64);
  return BigInt(`0x${bytesToHex(wide)}`) % BN254_R;
}

/** Everything derivable from the ACCOUNT namespace in one pass (one passkey prompt). */
export function deriveAccountKeys(prfAccount: Uint8Array) {
  return {
    evmPrivateKey: deriveEvmPrivateKey(prfAccount),
    unlinkSeed: deriveUnlinkSeed(prfAccount),
    payslip: derivePayslipKeypair(prfAccount),
  };
}
