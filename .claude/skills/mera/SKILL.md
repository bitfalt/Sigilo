---
name: mera
description: How Sigilo uses Mera (@category-labs/mera) for passkey accounts — creating and signing in with passkeys, PRF salts as key namespaces, deriving the EVM key / Unlink seed / payslip key / passport secret, Mera signing sessions with viem on Monad, step-up prompts, the "stateless test", and authenticator caveats. Use whenever touching onboarding, sign-in, key derivation, signing, or anything under packages/core/src/keys or the worker auth flow.
---

# Mera in Sigilo

Mera (by Category Labs, Monad ecosystem) turns a **passkey** into deterministic key material via the WebAuthn **PRF extension**. There is no seed phrase, no extension, no MPC and no custody backend: the same passkey + rpId + salt always returns the same 32 bytes on every synced device.

- Package: `@category-labs/mera` (v0.2.x). viem adapter: `@category-labs/mera/viem` (viem is an optional peer dep).
- Docs: https://mera.category.xyz — there is **no llms.txt**; raw markdown lives at
  `https://raw.githubusercontent.com/category-labs/mera/main/docs/src/content/docs/<path>.md(x)`
  (e.g. `reference/get-passkey-prf-output.md`, `recipes/send-a-transaction-with-viem.md`).
- Reference demos: `github.com/category-labs/mera/tree/main/demos/web` (locked/unlocked account pattern).

Two hackathon bounties depend on doing this right — see "Bounty checklist" at the bottom.

## Core API (verified against docs, 2026-10)

```ts
import {
  createPasskeyWithPrfOutput, // sign-up: create passkey + evaluate PRF (1 prompt, 2 on some authenticators)
  getPasskeyPrfOutput,        // sign-in / step-up: 1 assertion ceremony = 1 prompt
  createSecp256k1SigningSession,
  getEvmAddress,
  MeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";

// Sign-up
const { credentialId, transports, prfSalt, prfOutput } = await createPasskeyWithPrfOutput({
  rp: { id: RP_ID, name: "Sigilo" },
  user: { name: displayName, displayName },
  prfSalt: SALT_ACCOUNT,          // 32 bytes; optional (defaults to sha256("mera.prf.salt.v1"))
});

// Sign-in (or step-up with a different salt)
const { credentialId, prfOutput } = await getPasskeyPrfOutput({
  rpId: RP_ID,
  prfSalt: SALT_ACCOUNT,          // must be exactly 32 bytes
  credential: { credentialId },   // optional: restrict to a known passkey
});

// Signing session (holds the key in memory; zeroed by end())
const session = createSecp256k1SigningSession({ privateKey }); // 32-byte valid secp256k1 scalar
const address = getEvmAddress(session.publicKey);
const account = toViemAccount(session); // viem LocalAccount: signTransaction, signMessage, signTypedData, signAuthorization (7702)
// ... later
session.end(); // permanent; signing afterwards throws MeraError SESSION_ENDED
```

Error codes (`MeraError.code`): `PRF_UNAVAILABLE`, `INPUT_INVALID`, `CRYPTO_UNAVAILABLE`, `PASSKEY_OPERATION_FAILED` (unavailable / **user cancelled** / unexpected credential), `SESSION_ENDED`. Map `PASSKEY_OPERATION_FAILED` to a friendly "Face ID was cancelled — try again", and `PRF_UNAVAILABLE` to an "unsupported device/password manager" screen (see caveats).

Every ceremony requires user verification (biometric/PIN) — not configurable.

## Sigilo key schedule (source of truth: SPEC.md §6)

Salts are **namespaces**: a different salt yields unrelated output. Each salt costs one prompt, so Sigilo uses exactly two:

| Salt (32 bytes) | Prompted | Derived |
|---|---|---|
| `SALT_ACCOUNT = sha256("sigilo/account/v1")` | sign-up / sign-in (once per session) | EVM key, stealth spend + view keys, payslip X25519 keypair |
| `SALT_PASSPORT = sha256("sigilo/passport/v1")` | **step-up** only (share passport, accept advance, first passport activation) | `passportSecret` (BN254 field element) |

Derivations from a PRF output (`prf`, 32 bytes):

```ts
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const enc = new TextEncoder();
export const SALT_ACCOUNT = sha256(enc.encode("sigilo/account/v1"));
export const SALT_PASSPORT = sha256(enc.encode("sigilo/passport/v1"));

// 1) EVM key — Mera's standard mapping (BIP-39 entropy -> seed -> BIP-32 path), so the
//    account is reproducible with standard tooling.
export function deriveEvmPrivateKey(prfAccount: Uint8Array): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfAccount, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("derivation produced no key");
  return node.privateKey;
}

// 2) Stealth spend + view keys — secp256k1 scalars behind every one-time account (SPEC §6.1).
//    48 HKDF bytes reduced without bias: mapHashToField(wide, secp256k1.Point.Fn.ORDER).
//    Labels "sigilo/stealth-spend/v1" and "sigilo/stealth-view/v1". The label "sigilo/unlink/v1"
//    is retired (Unlink was removed); never reuse it.
//    Real implementation: deriveStealthKeys in packages/core/src/keys.ts.

// 3) Payslip keypair — X25519 secret; employer encrypts payslips to the public key.
export const derivePayslipSecret = (prfAccount: Uint8Array) =>
  hkdf(sha256, prfAccount, undefined, enc.encode("sigilo/payslips/v1"), 32);
//    public key: x25519.getPublicKey(secret) from "@noble/curves/ed25519.js"

// 4) Passport secret — BN254 field element from the PASSPORT namespace.
//    Take 64 bytes and reduce mod r to avoid modulo bias.
export const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export function derivePassportSecret(prfPassport: Uint8Array): bigint {
  const wide = hkdf(sha256, prfPassport, undefined, enc.encode("sigilo/passport-secret/v1"), 64);
  return BigInt("0x" + Buffer.from(wide).toString("hex")) % BN254_R; // use a browser-safe hex helper in app code
}
```

Rules:
- **Never persist secrets** (PRF outputs, private keys, seeds, passport secret) to localStorage, IndexedDB, cookies, or the server. Keep them in memory; zero/`end()` on logout.
- It is fine to cache **public identity** (EVM address, payment profile, payslip public key, credentialId) in localStorage to render a "locked" state after reload; unlocking re-runs `getPasskeyPrfOutput` (see `demos/web/src/account.ts` pattern: `none | locked | unlocked`).
- Wipe `prf` byte arrays (`.fill(0)`) after deriving.
- Keep derivation code in `packages/core` with unit tests that pin outputs for a fixed fake PRF value (regression guard: changing a label silently orphans every account).

## rpId / domain

- Passkeys are bound to the **rpId** (a domain). `RP_ID` = the production hostname (e.g. `sigilo.example`), read from env (`NEXT_PUBLIC_RP_ID`). Changing it later orphans all accounts — lock the domain early.
- Dev: `localhost` works (secure context). Vercel preview URLs are different rpIds → passkeys created there won't work in prod.
- Requires HTTPS or localhost.

## Monad + viem

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { monadTestnet } from "viem/chains"; // chain id 10143

const wallet = createWalletClient({ account: toViemAccount(session), chain: monadTestnet, transport: http(RPC_URL) });
```
Signing via the session never shows a passkey prompt — that's what makes "prompt-free signing" possible inside a session. Gas on Monad is charged on gas *limit* (see the `gas` skill); estimate carefully.

## Session design (Mera UX bounty criterion)

- **Prompt-free inside a session:** viewing balance/payslips, low-risk signatures (session auth, payslip decryption).
- **Re-prompt (step-up with `SALT_PASSPORT`):** sharing an Income Passport, accepting an advance / signing a deduction mandate.
- Session expiry: end the signing session after inactivity (e.g. 15 min) or on tab close; show a clear "Unlock with Face ID" state, not an error.

## Authenticator caveats (affects demo devices)

- Works: iCloud Keychain (Safari/Chrome on iOS 18+ & macOS 15+), Google Password Manager (Chrome Android, Chrome desktop signed-in), 1Password, Windows 11 25H2+, Proton Pass, YubiKey 5.
- **Desktop Chrome local profile has no PRF** — if "Offer to save passkeys" is off or a password-manager extension intercepts (e.g. Bitwarden, Dashlane: unsupported), `createPasskeyWithPrfOutput` fails with `PRF_UNAVAILABLE`.
- Demo plan: iPhone (Safari) + Mac (Safari/Chrome with iCloud Keychain) — passkeys sync, so the cross-device test works.

## Bounty checklist

**Best Mera-Powered UX ($2.5k)** — Mera is the *entire* account layer for the worker:
- [ ] One-prompt onboarding (single passkey ceremony; no seed phrase, extension, email/OTP)
- [ ] Prompt-free signing via a Mera signing session with a clearly scoped session
- [ ] **Stateless test:** judges clear local storage / open a fresh device mid-demo → identity and access fully reconstruct from the passkey (+ untrusted storage)
- [ ] Measure time-to-first-transaction (taps + seconds) and show it
- [ ] Bonus: gas sponsorship, recovery, smart-account patterns
- Do **not** add Privy/Dynamic for the worker — it would no longer be "the entire account layer".

**Mera: One Passkey, Many Keys ($2.5k)** — non-wallet use of PRF namespaces:
- [ ] At least one namespace does non-account work, live: `SALT_PASSPORT` → per-verifier unlinkable pseudonyms; payslip decryption keys; Unlink private account seed
- [ ] Salts genuinely namespaced; encryption vs derivation used appropriately; nothing sensitive persisted
- [ ] **Cross-device test:** a second device / fresh browser profile reproduces the same keys and decrypts the same payslips, live
