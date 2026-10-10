// SigiloPay spend intents (SPEC.md §9). A worker spends several pieces at once: each piece signs
// an AUSD ERC-3009 ReceiveWithAuthorization whose nonce commits to the whole intent, so the
// relayer can't change the recipient, the amount or the action, and can't replay it.
//
// Must match SigiloPay.sol: intentHash = keccak256(abi.encode(action, to, total, minOut, deadline,
// salt)); nonce = keccak256(abi.encode(intentHash, from)).

import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { AGORA_TESTNET, MONAD_TESTNET_CHAIN_ID } from "./constants";

export const PayAction = { Collect: 0, SendHome: 1 } as const;
export type PayAction = (typeof PayAction)[keyof typeof PayAction];

export interface PayIntent {
  action: PayAction;
  /** Final recipient of the money (or of the swapped CTK for SendHome). */
  to: Address;
  /** Sum of all authorizations, in AUSD base units. */
  total: bigint;
  /** Minimum CTK out for SendHome; 0 for Collect. */
  minOut: bigint;
  /** Unix seconds; also each authorization's `validBefore`. */
  deadline: bigint;
  salt: Hex;
}

export interface ReceiveAuthorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

/** EIP-712 domain of testnet AUSD. Its `name()` returns "AUSD", but the domain says otherwise. */
export const AUSD_TESTNET_DOMAIN = {
  name: "Agora Dollar",
  version: "1",
  chainId: MONAD_TESTNET_CHAIN_ID,
  verifyingContract: AGORA_TESTNET.ausd,
} as const;

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function intentHash(intent: PayIntent): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [intent.action, intent.to, intent.total, intent.minOut, intent.deadline, intent.salt],
    ),
  );
}

export function authorizationNonce(hash: Hex, from: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [hash, from]));
}

/** Sign one authorization per piece for `intent`; amounts must sum to `intent.total`. */
export async function signIntentAuthorizations(args: {
  intent: PayIntent;
  pieces: readonly { privateKey: Hex; amount: bigint }[];
  /** The SigiloPay contract (ERC-3009 payee). */
  payee: Address;
  domain?: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
}): Promise<ReceiveAuthorization[]> {
  const { intent, pieces, payee, domain = AUSD_TESTNET_DOMAIN } = args;
  const sum = pieces.reduce((s, p) => s + p.amount, 0n);
  if (sum !== intent.total)
    throw new Error(`pieces sum to ${sum}, intent total is ${intent.total}`);

  const hash = intentHash(intent);
  return Promise.all(
    pieces.map(async ({ privateKey, amount }) => {
      const signer = privateKeyToAccount(privateKey);
      const message = {
        from: signer.address,
        to: payee,
        value: amount,
        validAfter: 0n,
        validBefore: intent.deadline,
        nonce: authorizationNonce(hash, signer.address),
      };
      const signature = await signer.signTypedData({
        domain,
        types: RECEIVE_WITH_AUTHORIZATION_TYPES,
        primaryType: "ReceiveWithAuthorization",
        message,
      });
      return { ...message, signature };
    }),
  );
}
