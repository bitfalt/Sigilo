// A worker's money, rebuilt on the device from encrypted receipts (SPEC.md F4): decrypt each
// receipt, re-derive every one-time account it names, and read all balances in one multicall.
// The worker sees one number; the pieces stay internal.

import { decryptReceipt, type Receipt } from "@sigilo/core/receipts";
import { oneTimeAccountKey } from "@sigilo/core/stealth";
import type { Address, Hex } from "viem";

import { ausdBalances } from "./chain";
import type { WorkerKeys } from "./identity";

export interface StoredReceipt {
  _id: string;
  _creationTime: number;
  ciphertext: string;
}

export interface OwnedPiece {
  account: Address;
  privateKey: Hex;
  balance: bigint;
}

export interface Wallet {
  /** AUSD base units across every piece. */
  balance: bigint;
  pieces: OwnedPiece[];
  receipts: { id: string; createdAt: number; receipt: Receipt }[];
}

export async function loadWallet(
  stored: readonly StoredReceipt[],
  keys: WorkerKeys,
): Promise<Wallet> {
  const receipts: Wallet["receipts"] = [];
  const owned = new Map<Address, Hex>();
  for (const row of stored) {
    let receipt: Receipt;
    try {
      receipt = decryptReceipt(row.ciphertext, keys.receiptKeys.secretKey);
    } catch {
      continue; // Not ours or corrupted: ignore rather than break the wallet.
    }
    receipts.push({ id: row._id, createdAt: row._creationTime, receipt });
    if (receipt.token !== "AUSD") continue;
    for (const piece of receipt.pieces) {
      const key = oneTimeAccountKey(keys.stealth, piece.ephemeralPubKey as Hex);
      if (key.address === piece.account) owned.set(key.address, key.privateKey);
    }
  }

  const accounts = [...owned.keys()];
  const balances = await ausdBalances(accounts);
  const pieces = accounts.map((account, i) => ({
    account,
    privateKey: owned.get(account)!,
    balance: balances[i]!,
  }));
  return { balance: balances.reduce((a, b) => a + b, 0n), pieces, receipts };
}

/** "$2,400.00" from AUSD base units (6 decimals). */
export function formatUsd(ausd: bigint): string {
  const cents = Number(ausd / 10_000n);
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatCents(cents: bigint | number | string): string {
  return (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "$1,500" for whole dollars, "$1,500.50" otherwise (thresholds and limits). */
export function formatAmount(cents: bigint | number | string): string {
  const n = Number(cents);
  return (n / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 100 === 0 ? 0 : 2,
  });
}
