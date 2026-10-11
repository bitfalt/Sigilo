// Builders for simulated Sigilo activity, shaped like the real transactions on Monad testnet.

import type { TestIndexerProcessConfig } from "envio";
import { encodeFunctionData, keccak256, parseAbi, toHex } from "viem";

export const CHAIN_ID = 10143;

/** One simulated event, as `indexer.process({ chains: { 10143: { simulate } } })` takes it. */
export type SimulateItem = NonNullable<
  NonNullable<TestIndexerProcessConfig["chains"][typeof CHAIN_ID]>["simulate"]
>[number];

/** An event of `contract` with loosely typed params (for table-driven tests). */
export function event(
  contract: SimulateItem["contract"],
  name: string,
  step: number,
  params: Record<string, unknown>,
  srcAddress?: string,
): SimulateItem {
  return {
    contract,
    event: name,
    ...(srcAddress ? { srcAddress } : {}),
    block: at(step),
    transaction: { hash: txHash(`${contract}-${name}-${step}`) },
    params,
  } as SimulateItem;
}
export const SIGILO_PAY = "0xbedbfae158ed456e546bc0ee2c2b1405f8abb701";
export const VAULT = "0xdb38a7f37f45934a42f4ddd740d8f69414de7734";
export const AUSD = "0xa9012a055bd4e0edff8ce09f960291c09d5322dc";
export const AGORA_PAIR = "0x1aa8958aa34cec8096ef4381cb335effe977b0ae";

/** USD to AUSD base units (6 decimals). */
export const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

/** A deterministic, lowercase account for a label ("maria-1", "acme"…). */
export const account = (label: string) =>
  keccak256(toHex(label)).slice(0, 42).toLowerCase() as `0x${string}`;

export const txHash = (label: string) => keccak256(toHex(`tx:${label}`));
export const intent = (label: string) => keccak256(toHex(`intent:${label}`));

const disperseAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

const START = 69_800_000;
const T0 = 1_791_000_000;

/** Block and time `n` steps into the simulation (blocks every ~0.4 s on Monad). */
export const at = (n: number) => ({ number: START + n * 10, timestamp: T0 + n * 4 });

export interface PieceSpec {
  account: `0x${string}`;
  amount: bigint;
}

/** SigiloPay.disperse from `payer`: one payroll run. */
export function payroll(args: {
  step: number;
  payer: `0x${string}`;
  pieces: PieceSpec[];
  hash?: `0x${string}`;
  /** Override the transaction's target (e.g. a payout made through another contract). */
  txTo?: `0x${string}`;
}) {
  const total = args.pieces.reduce((s, p) => s + p.amount, 0n);
  return {
    contract: "SigiloPay" as const,
    event: "Dispersed" as const,
    srcAddress: SIGILO_PAY as `0x${string}`,
    block: at(args.step),
    transaction: {
      hash: args.hash ?? txHash(`payroll-${args.step}`),
      to: (args.txTo ?? SIGILO_PAY) as `0x${string}`,
      input: encodeFunctionData({
        abi: disperseAbi,
        functionName: "disperse",
        args: [args.pieces.map((p) => p.account), args.pieces.map((p) => p.amount)],
      }),
    },
    params: { payer: args.payer, pieces: BigInt(args.pieces.length), total },
  };
}

/**
 * SigiloPay.collect / sendHome: an AUSD Transfer piece → SigiloPay per pulled piece, then Paid,
 * all in one transaction.
 */
export function payment(args: {
  step: number;
  kind: "collect" | "sendHome";
  id: `0x${string}`;
  to: `0x${string}`;
  pulls: PieceSpec[];
  amountOut?: bigint;
}) {
  const block = at(args.step);
  const hash = txHash(`payment-${args.step}`);
  const total = args.pulls.reduce((s, p) => s + p.amount, 0n);
  return [
    ...args.pulls.map((p) => ({
      contract: "AUSD" as const,
      event: "Transfer" as const,
      srcAddress: AUSD as `0x${string}`,
      block,
      transaction: { hash },
      params: { from: p.account, to: SIGILO_PAY as `0x${string}`, value: p.amount },
    })),
    {
      contract: "SigiloPay" as const,
      event: "Paid" as const,
      srcAddress: SIGILO_PAY as `0x${string}`,
      block,
      transaction: { hash },
      params: {
        intentHash: args.id,
        action: args.kind === "collect" ? 0n : 1n,
        to: args.to,
        total,
        amountOut: args.amountOut ?? total,
      },
    },
  ];
}

/** A plain AUSD transfer (deposits into the vault, advances paid out, repayments…). */
export function ausdTransfer(args: {
  step: number;
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  label?: string;
}) {
  return {
    contract: "AUSD" as const,
    event: "Transfer" as const,
    srcAddress: AUSD as `0x${string}`,
    block: at(args.step),
    transaction: { hash: txHash(args.label ?? `transfer-${args.step}`) },
    params: { from: args.from, to: args.to, value: args.value },
  };
}
