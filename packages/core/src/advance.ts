// Salary advances repaid from payroll (SPEC.md F7). The worker proves her income with the
// AdvanceVault's own scope and a nonce that commits to where the money goes, so the relayer that
// submits the request can't redirect it. She then signs a DeductionMandate with her session key,
// which tells her employer's payroll to repay the advance in installments.
//
// Must match AdvanceVault.sol: nonce = uint256(keccak256(abi.encode(recipient, amount, deadline,
// salt))) mod r; scope = uint256(keccak256(abi.encode(vault, chainId))) mod r; maxAdvance =
// thresholdCents * 1e4 * maxRatioBps / 1e4; owed = amount + ceil(amount * feeBps / 1e4).

import {
  type Address,
  encodeAbiParameters,
  type Hex,
  hexToBigInt,
  keccak256,
  recoverTypedDataAddress,
} from "viem";

import { BN254_R, MONAD_TESTNET_CHAIN_ID } from "./constants";
import { AUSD_PER_CENT } from "./pieces";
import { verifierScope } from "./scope";
import { PASSPORT_MAX_AGE_MONTHS } from "./verify";

const BPS = 10_000n;

/** Terms of the demo vault (script/DeployAdvanceVault.s.sol): up to 30% of a month, 2% fee. */
export const DEMO_ADVANCE_TERMS = { maxRatioBps: 3000, feeBps: 200 } as const;

/** AdvanceVault.MAX_PASSPORT_AGE_MONTHS: the newest proven month may be this far back. */
export const ADVANCE_MAX_AGE_MONTHS = PASSPORT_MAX_AGE_MONTHS;

/**
 * The nonce an advance request must prove with: binds the recipient, amount (AUSD base units),
 * deadline (unix seconds) and a random salt. In the rare case it is 0, pick another salt (the
 * circuit rejects a zero nonce).
 */
export function advanceNonce(recipient: Address, amount: bigint, deadline: bigint, salt: Hex) {
  const hash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [recipient, amount, deadline, salt],
    ),
  );
  return hexToBigInt(hash) % BN254_R;
}

/** The vault's scope (AdvanceVault.scope()); the passport must be proven with it. */
export function vaultScope(vault: Address, chainId: number | bigint = MONAD_TESTNET_CHAIN_ID) {
  return verifierScope(vault, chainId);
}

/** Largest advance, in AUSD base units, for a proven monthly threshold in USD cents. */
export function maxAdvance(thresholdCents: bigint, maxRatioBps: number | bigint): bigint {
  return (thresholdCents * AUSD_PER_CENT * BigInt(maxRatioBps)) / BPS;
}

/** Principal plus the fee, rounded up, in AUSD base units. */
export function advanceOwed(amount: bigint, feeBps: number | bigint): bigint {
  return amount + (amount * BigInt(feeBps) + BPS - 1n) / BPS;
}

/** Equal installments that cover `owed`; the vault never pulls more than is still owed. */
export function installmentFor(owed: bigint, installments: number): bigint {
  if (!Number.isInteger(installments) || installments < 1 || installments > 255) {
    throw new RangeError(`installments must be 1..255, got ${installments}`);
  }
  const n = BigInt(installments);
  return (owed + n - 1n) / n;
}

// ---------------------------------------------------------------- deduction mandate

/** The worker's consent to repay an advance from her payroll (SPEC.md F7.3). */
export interface DeductionMandate {
  vault: Address;
  advanceId: bigint;
  /** AUSD base units deducted per payroll run. */
  installment: bigint;
  installments: number;
  /** Unix seconds; the employer ignores the mandate after it. */
  deadline: bigint;
}

export const MANDATE_DOMAIN = {
  name: "Sigilo",
  version: "1",
  chainId: MONAD_TESTNET_CHAIN_ID,
} as const;

export const MANDATE_TYPES = {
  DeductionMandate: [
    { name: "vault", type: "address" },
    { name: "advanceId", type: "uint256" },
    { name: "installment", type: "uint256" },
    { name: "installments", type: "uint8" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** EIP-712 payload for `account.signTypedData` (the worker's session EVM key). */
export function mandateTypedData(mandate: DeductionMandate) {
  return {
    domain: MANDATE_DOMAIN,
    types: MANDATE_TYPES,
    primaryType: "DeductionMandate" as const,
    message: mandate,
  };
}

/** The account that signed `mandate`. Throws on a malformed signature. */
export function recoverMandateSigner(args: {
  mandate: DeductionMandate;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({ ...mandateTypedData(args.mandate), signature: args.signature });
}
