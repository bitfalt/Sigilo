// A payout's pieces only exist in the calldata of SigiloPay.disperse(to[], amounts[]); the
// Dispersed event carries just the count and the total. Decode the transaction input and check it
// against the event, so a payout made through another contract is never mis-attributed.

import { decodeFunctionData, parseAbi } from "viem";

const disperseAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

export interface PayoutPiece {
  account: string;
  amount: bigint;
}

/**
 * The payout's pieces, or null if the transaction didn't call `disperse` on `sigiloPay` directly
 * or its calldata doesn't match the event.
 */
export function decodePayout(args: {
  input: string;
  txTo: string | undefined;
  sigiloPay: string;
  pieces: bigint;
  total: bigint;
}): PayoutPiece[] | null {
  if (args.txTo?.toLowerCase() !== args.sigiloPay.toLowerCase()) return null;
  let to: readonly string[];
  let amounts: readonly bigint[];
  try {
    const call = decodeFunctionData({ abi: disperseAbi, data: args.input as `0x${string}` });
    [to, amounts] = call.args;
  } catch {
    return null;
  }
  if (to.length !== amounts.length || BigInt(to.length) !== args.pieces) return null;
  const sum = amounts.reduce((s, a) => s + a, 0n);
  if (sum !== args.total) return null;
  return to.map((account, i) => ({ account: account.toLowerCase(), amount: amounts[i]! }));
}
