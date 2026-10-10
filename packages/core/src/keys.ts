// Key schedule derived from Mera passkey PRF outputs (SPEC.md §6, .claude/skills/mera).
//
// WARNING: every label below is part of the account identity. Changing a label or the
// derivation path silently produces different keys and orphans existing accounts.

import { mapHashToField } from "@noble/curves/abstract/modular.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
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
/** PRF salt (namespace) for employer admins: treasury account and roster key. */
export const SALT_EMPLOYER = sha256(utf8("sigilo/employer/v1"));

export const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

// Retired (Unlink was removed): "sigilo/unlink/v1". Never reuse a retired label.
const LABEL_STEALTH_SPEND = "sigilo/stealth-spend/v1";
const LABEL_STEALTH_VIEW = "sigilo/stealth-view/v1";
const LABEL_PAYSLIPS = "sigilo/payslips/v1";
const LABEL_PASSPORT_SECRET = "sigilo/passport-secret/v1";
const LABEL_EMPLOYER_TREASURY = "sigilo/employer-treasury/v1";
const LABEL_EMPLOYER_ROSTER = "sigilo/employer-roster/v1";

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

/** secp256k1 scalar in [1, n): 48 HKDF bytes reduced without bias (RFC 9380 hash_to_field). */
function deriveSecp256k1Scalar(prfAccount: Uint8Array, label: string): Uint8Array {
  const wide = hkdf(sha256, prfAccount, undefined, utf8(label), 48);
  return mapHashToField(wide, secp256k1.Point.Fn.ORDER);
}

/** Spend and view keys behind every one-time account (SPEC.md §6.1). */
export function deriveStealthKeys(prfAccount: Uint8Array): {
  spendKey: Uint8Array;
  viewKey: Uint8Array;
} {
  assertPrf(prfAccount);
  return {
    spendKey: deriveSecp256k1Scalar(prfAccount, LABEL_STEALTH_SPEND),
    viewKey: deriveSecp256k1Scalar(prfAccount, LABEL_STEALTH_VIEW),
  };
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
    stealth: deriveStealthKeys(prfAccount),
    payslip: derivePayslipKeypair(prfAccount),
  };
}

/**
 * Everything derivable from the EMPLOYER namespace (one prompt): the treasury account that pays
 * payroll, and the symmetric key the roster is encrypted with (SPEC.md §6, "blind server").
 */
export function deriveEmployerKeys(prfEmployer: Uint8Array): {
  treasuryKey: Uint8Array;
  rosterKey: Uint8Array;
} {
  assertPrf(prfEmployer);
  return {
    treasuryKey: deriveSecp256k1Scalar(prfEmployer, LABEL_EMPLOYER_TREASURY),
    rosterKey: hkdf(sha256, prfEmployer, undefined, utf8(LABEL_EMPLOYER_ROSTER), 32),
  };
}
