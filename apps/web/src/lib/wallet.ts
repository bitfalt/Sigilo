// A worker's money, rebuilt on the device from encrypted receipts (SPEC.md F4): decrypt each
// receipt, re-derive every one-time account it names, and read all balances in one multicall.
// The worker sees one number; the pieces stay internal.

import { AGORA_TESTNET } from "@sigilo/core/constants";
import { decryptReceipt, type Receipt } from "@sigilo/core/receipts";
import { oneTimeAccountKey } from "@sigilo/core/stealth";
import type { Address, Hex } from "viem";

import { tokenBalances } from "./chain";
import type { WorkerKeys } from "./identity";

export interface StoredReceipt {
  _id: string;
  _creationTime: number;
  ciphertext: string;
}

export interface OwnedPiece {
  account: Address;
  privateKey: Hex;
  token: "AUSD" | "CTK";
  /** Token base units (AUSD 6 decimals, CTK 18). */
  balance: bigint;
}

export interface Wallet {
  /** Everything the person holds, in AUSD base units (CTK counts 1:1, as Agora prices it). */
  balance: bigint;
  /** What can be spent with Sigilo today: AUSD pieces. */
  spendable: bigint;
  pieces: OwnedPiece[];
  receipts: { id: string; createdAt: number; receipt: Receipt }[];
}

const CTK_TO_AUSD = 10n ** 12n;

export async function loadWallet(
  stored: readonly StoredReceipt[],
  keys: WorkerKeys,
): Promise<Wallet> {
  const receipts: Wallet["receipts"] = [];
  const owned = new Map<Address, { privateKey: Hex; token: OwnedPiece["token"] }>();
  for (const row of stored) {
    let receipt: Receipt;
    try {
      receipt = decryptReceipt(row.ciphertext, keys.receiptKeys.secretKey);
    } catch {
      continue; // Not ours or corrupted: ignore rather than break the wallet.
    }
    receipts.push({ id: row._id, createdAt: row._creationTime, receipt });
    const token = receipt.kind === "payslip" ? "AUSD" : receipt.token;
    for (const piece of receipt.pieces) {
      const key = oneTimeAccountKey(keys.stealth, piece.ephemeralPubKey as Hex);
      if (key.address === piece.account)
        owned.set(key.address, { privateKey: key.privateKey, token });
    }
  }

  const entries = [...owned.entries()];
  const byToken = (t: OwnedPiece["token"]) => entries.filter(([, v]) => v.token === t);
  const [ausd, ctk] = [byToken("AUSD"), byToken("CTK")];
  const [ausdBal, ctkBal] = await Promise.all([
    tokenBalances(
      AGORA_TESTNET.ausd,
      ausd.map(([a]) => a),
    ),
    tokenBalances(
      AGORA_TESTNET.ctk,
      ctk.map(([a]) => a),
    ),
  ]);
  const pieces: OwnedPiece[] = [
    ...ausd.map(([account, v], i) => ({ account, ...v, balance: ausdBal[i]! })),
    ...ctk.map(([account, v], i) => ({ account, ...v, balance: ctkBal[i]! })),
  ];
  const spendable = ausdBal.reduce((a, b) => a + b, 0n);
  const received = ctkBal.reduce((a, b) => a + b, 0n) / CTK_TO_AUSD;
  return { balance: spendable + received, spendable, pieces, receipts };
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
