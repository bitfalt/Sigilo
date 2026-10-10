// Move everything out (SPEC.md F10, Advanced settings). Every AUSD piece with a balance signs an
// ERC-3009 authorization bound to a PayAction.Collect intent (core/intent.ts) whose recipient is
// an external address the person chose, so SigiloPay.collect forwards the whole sum there. A
// relayer can submit it but can't redirect it. SigiloPay takes at most MAX_PIECES pieces per
// call, so larger balances are split into several intents.

import { type Address, getAddress, type Hex, isAddress, toHex, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { AGORA_TESTNET } from "./constants";
import { SIGILO_TESTNET } from "./deployments";
import {
  PayAction,
  type PayIntent,
  type ReceiveAuthorization,
  signIntentAuthorizations,
} from "./intent";

/** SigiloPay.MAX_PIECES: authorizations per call. */
export const COLLECT_MAX_PIECES = 64;
/** Authorizations stay valid this long. */
export const COLLECT_DEADLINE_SECONDS = 10 * 60;

export interface PreparedCollect {
  intent: PayIntent;
  auths: ReceiveAuthorization[];
}

export class CollectDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectDestinationError";
  }
}

/** Addresses money must never be swept to: it would be stuck there. */
const CONTRACTS = new Set(
  [SIGILO_TESTNET.sigiloPay, AGORA_TESTNET.ausd, AGORA_TESTNET.ctk, zeroAddress].map((a) =>
    a.toLowerCase(),
  ),
);

/**
 * Checksummed destination, or throws: malformed, a bad checksum, a contract that would trap the
 * money, or one of the person's own pieces (`own`).
 */
export function collectDestination(to: string, own: readonly Address[] = []): Address {
  if (!isAddress(to, { strict: false })) throw new CollectDestinationError("invalid address");
  if (!isAddress(to)) throw new CollectDestinationError("checksum mismatch");
  const lower = to.toLowerCase();
  if (CONTRACTS.has(lower)) throw new CollectDestinationError("not a personal account");
  if (own.some((a) => a.toLowerCase() === lower))
    throw new CollectDestinationError("one of your own one-time accounts");
  return getAddress(to);
}

/**
 * Sign a Collect of every AUSD piece with a balance to `to`, in batches of at most
 * COLLECT_MAX_PIECES (one intent and one SigiloPay.collect call per batch).
 */
export async function prepareCollect(args: {
  /** AUSD pieces with their one-time keys; empty ones are skipped. */
  pieces: readonly { privateKey: Hex; balance: bigint }[];
  to: string;
  now?: number;
}): Promise<{ total: bigint; batches: PreparedCollect[] }> {
  const { now = Date.now() } = args;

  // One authorization per account: a repeated piece would reuse its nonce and revert.
  const unique = new Map<Address, { privateKey: Hex; amount: bigint }>();
  for (const p of args.pieces) {
    if (p.balance <= 0n) continue;
    unique.set(privateKeyToAddress(p.privateKey), { privateKey: p.privateKey, amount: p.balance });
  }
  const to = collectDestination(args.to, [...unique.keys()]);
  const pieces = [...unique.values()];
  if (pieces.length === 0) throw new RangeError("nothing to move");

  const deadline = BigInt(Math.floor(now / 1000) + COLLECT_DEADLINE_SECONDS);
  const batches: PreparedCollect[] = [];
  for (let i = 0; i < pieces.length; i += COLLECT_MAX_PIECES) {
    const batch = pieces.slice(i, i + COLLECT_MAX_PIECES);
    const intent: PayIntent = {
      action: PayAction.Collect,
      to,
      total: batch.reduce((s, p) => s + p.amount, 0n),
      minOut: 0n,
      deadline,
      salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
    };
    const auths = await signIntentAuthorizations({
      intent,
      pieces: batch,
      payee: SIGILO_TESTNET.sigiloPay,
    });
    batches.push({ intent, auths });
  }
  return { total: batches.reduce((s, b) => s + b.intent.total, 0n), batches };
}
