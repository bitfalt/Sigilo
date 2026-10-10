// Send home (SPEC.md F8). Everything is prepared on the sender's device: the pieces to spend, a
// fresh one-time account for the recipient, one ERC-3009 authorization per piece bound to the
// intent (core/intent.ts), and the recipient's encrypted receipt. A relayer only has to submit
// SigiloPay.sendHome; it never needs to know who is sending.

import { hexToBytes } from "@noble/hashes/utils.js";
import { type Address, type Hex, toHex } from "viem";

import { SIGILO_TESTNET } from "./deployments";
import {
  intentHash,
  PayAction,
  type PayIntent,
  type ReceiveAuthorization,
  signIntentAuthorizations,
} from "./intent";
import { selectPieces } from "./pieces";
import { encryptReceipt, type TransferReceipt } from "./receipts";
import { createOneTimeAccount, decodePaymentProfile } from "./stealth";

/** Smallest send: keeps the relayer's fees proportionate. In AUSD base units ($1). */
export const MIN_SEND_AUSD = 1_000_000n;
/** Authorizations stay valid this long. */
export const SEND_DEADLINE_SECONDS = 10 * 60;
/** Accept up to 0.5% less CTK than quoted (the Agora pair trades at a fixed price). */
export const SEND_SLIPPAGE_BPS = 50n;

export interface PreparedSend {
  intent: PayIntent;
  auths: ReceiveAuthorization[];
  /** Encrypted TransferReceipt for the recipient (core/receipts.ts). */
  receipt: string;
  /** The recipient's fresh one-time account. */
  account: Address;
  quotedOut: bigint;
}

export async function prepareSendHome(args: {
  /** Spendable AUSD pieces with their one-time keys. */
  pieces: readonly { privateKey: Hex; balance: bigint }[];
  /** AUSD base units. */
  amount: bigint;
  recipient: { paymentProfile: string; receiptPublicKey: string };
  /** CTK the Agora pair gives for `ausd` (getAmountsOut). */
  quote(ausd: bigint): Promise<bigint>;
  /** How the recipient sees the sender ("María"). */
  from: string;
  memo?: string;
  now?: number;
}): Promise<PreparedSend> {
  const { amount, recipient, from, memo, now = Date.now() } = args;
  if (amount < MIN_SEND_AUSD) throw new RangeError("amount below the minimum");

  const selected = selectPieces(
    args.pieces.map((p) => ({ id: p.privateKey, balance: p.balance })),
    amount,
  );
  const quotedOut = await args.quote(amount);
  const oneTime = createOneTimeAccount(decodePaymentProfile(recipient.paymentProfile));
  const intent: PayIntent = {
    action: PayAction.SendHome,
    to: oneTime.address,
    total: amount,
    minOut: (quotedOut * (10_000n - SEND_SLIPPAGE_BPS)) / 10_000n,
    deadline: BigInt(Math.floor(now / 1000) + SEND_DEADLINE_SECONDS),
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const auths = await signIntentAuthorizations({
    intent,
    pieces: selected.map((s) => ({ privateKey: s.id, amount: s.amount })),
    payee: SIGILO_TESTNET.sigiloPay,
  });

  const receipt: TransferReceipt = {
    v: 1,
    kind: "transfer",
    from,
    ...(memo ? { memo } : {}),
    token: "CTK",
    pieces: [
      {
        account: oneTime.address,
        ephemeralPubKey: oneTime.ephemeralPubKey,
        amount: quotedOut.toString(),
      },
    ],
    intentHash: intentHash(intent),
    issuedAt: now,
  };
  return {
    intent,
    auths,
    receipt: encryptReceipt(receipt, hexToBytes(recipient.receiptPublicKey.slice(2))),
    account: oneTime.address,
    quotedOut,
  };
}
