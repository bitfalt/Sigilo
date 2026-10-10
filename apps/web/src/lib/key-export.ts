// Advanced settings, "Export keys" (SPEC.md F10): everything needed to hold this person's money
// without Sigilo, as a JSON file the browser downloads. Built in memory on demand and never
// stored; the file itself is the person's responsibility once it's saved.

import { AGORA_TESTNET, MONAD_TESTNET_CHAIN_ID } from "@sigilo/core/constants";
import { EVM_DERIVATION_PATH } from "@sigilo/core/keys";
import { formatUnits, toHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import type { WorkerKeys } from "./identity";
import type { OwnedPiece } from "./wallet";

export const KEY_EXPORT_FORMAT = "sigilo-key-export";
export const KEY_EXPORT_VERSION = 1;

const DECIMALS = { AUSD: 6, CTK: 18 } as const;

export function buildKeyExport(args: {
  keys: WorkerKeys;
  /** The account's EVM private key, re-derived from the step-up passkey prompt. */
  accountKey: Uint8Array;
  pieces: readonly OwnedPiece[];
  explorerUrl: string;
  now?: number;
}): string {
  const { keys, accountKey, pieces, explorerUrl, now = Date.now() } = args;
  const accountPrivateKey = toHex(accountKey);
  if (privateKeyToAddress(accountPrivateKey) !== keys.address) {
    throw new Error("the account key doesn't match the unlocked account");
  }
  const sorted = [...pieces].sort((a, b) =>
    a.token !== b.token
      ? a.token === "AUSD"
        ? -1
        : 1
      : b.balance > a.balance
        ? 1
        : b.balance < a.balance
          ? -1
          : 0,
  );

  return JSON.stringify(
    {
      format: KEY_EXPORT_FORMAT,
      version: KEY_EXPORT_VERSION,
      exportedAt: new Date(now).toISOString(),
      warning:
        "Anyone with this file can move every balance in it and read your payslips. Keep it offline.",
      network: { name: "Monad testnet", chainId: MONAD_TESTNET_CHAIN_ID, explorer: explorerUrl },
      tokens: {
        AUSD: { address: AGORA_TESTNET.ausd, decimals: DECIMALS.AUSD },
        CTK: { address: AGORA_TESTNET.ctk, decimals: DECIMALS.CTK },
      },
      account: {
        description: "Sign-in account: passkey PRF (Mera) → BIP-39 entropy → BIP-32 path.",
        address: keys.address,
        privateKey: accountPrivateKey,
        derivationPath: EVM_DERIVATION_PATH,
      },
      oneTimeAccountKeys: {
        description:
          "ERC-5564 scheme-1 stealth keys (secp256k1). A one-time account's private key is spendKey + keccak256(compressed(viewKey · R)) mod n, where R is the ephemeral public key in its receipt.",
        spendKey: toHex(keys.stealth.spendKey),
        viewKey: toHex(keys.stealth.viewKey),
        paymentProfile: keys.paymentProfile,
      },
      receiptKey: {
        description:
          "X25519 key that opens payslips and other receipts (HKDF-SHA256 + XChaCha20-Poly1305 envelopes).",
        secretKey: toHex(keys.receiptKeys.secretKey),
        publicKey: keys.receiptPublicKey,
      },
      oneTimeAccounts: sorted.map((p) => ({
        token: p.token,
        address: p.account,
        privateKey: p.privateKey,
        balance: p.balance.toString(),
        balanceFormatted: formatUnits(p.balance, DECIMALS[p.token]),
      })),
    },
    null,
    2,
  );
}

/** "sigilo-keys-0x1a2b3c-2026-10-10.json" */
export function keyExportFilename(address: string, now = Date.now()): string {
  return `sigilo-keys-${address.slice(0, 8).toLowerCase()}-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** Hand `json` to the browser as a download; nothing is kept once the link is revoked. */
export function downloadJson(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari starts the download asynchronously; give it a moment before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
