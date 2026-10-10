import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { env } from "../_generated/server";

// On-chain writes by the Sigilo operator (actions only). Monad charges the gas *limit*, so every
// write uses the estimate plus a 15% margin instead of a generous default.

export const registryAbi = parseAbi([
  "function publishRoot(bytes32 root)",
  "function setEmployerVerified(bytes32 employerId, bool verified)",
]);

const passportVerifierAbi = parseAbi([
  "function verify(bytes proof, bytes32[] publicInputs) view returns (bool)",
]);

const sigiloPayAbi = parseAbi([
  "event Dispersed(address indexed payer, uint256 pieces, uint256 total)",
  "event Paid(bytes32 indexed intentHash, uint8 indexed action, address indexed to, uint256 total, uint256 amountOut)",
  "struct Intent { uint8 action; address to; uint256 total; uint256 minOut; uint256 deadline; bytes32 salt; }",
  "struct Authorization { address from; uint256 value; bytes signature; }",
  "function sendHome(Authorization[] auths, Intent intent) returns (uint256 amountOut)",
  "function collect(Authorization[] auths, Intent intent) returns (bytes32 hash)",
]);

function clients() {
  const transport = http(env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as Hex);
  return {
    account,
    publicClient: createPublicClient({ chain: monadTestnet, transport }),
    walletClient: createWalletClient({ account, chain: monadTestnet, transport }),
  };
}

export async function registryWrite(
  functionName: "publishRoot" | "setEmployerVerified",
  args: readonly unknown[],
): Promise<Hex> {
  const { account, publicClient, walletClient } = clients();
  const request = {
    address: SIGILO_TESTNET.registry,
    abi: registryAbi,
    functionName,
    args,
    account,
  } as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are checked by the ABI at runtime
  const gas = await publicClient.estimateContractGas(request as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await walletClient.writeContract({ ...(request as any), gas: (gas * 115n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
}

/** The AUSD total a confirmed SigiloPay.disperse paid from `treasury`, or null if none. */
export async function dispersedTotal(txHash: Hex, treasury: string): Promise<bigint | null> {
  const { publicClient } = clients();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SIGILO_TESTNET.sigiloPay.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: sigiloPayAbi, data: log.data, topics: log.topics });
      if (
        event.eventName === "Dispersed" &&
        event.args.payer.toLowerCase() === treasury.toLowerCase()
      ) {
        return event.args.total;
      }
    } catch {
      // Not a Dispersed event.
    }
  }
  return null;
}

/** IncomePassportVerifier.verify: a free view call (known registry root + valid proof). */
export async function passportIsValid(proof: Hex, publicInputs: readonly Hex[]): Promise<boolean> {
  const { publicClient } = clients();
  return publicClient.readContract({
    address: SIGILO_TESTNET.passportVerifier,
    abi: passportVerifierAbi,
    functionName: "verify",
    args: [proof, publicInputs],
  });
}

export interface SendHomeArgs {
  auths: { from: Hex; value: bigint; signature: Hex }[];
  intent: { action: number; to: Hex; total: bigint; minOut: bigint; deadline: bigint; salt: Hex };
}

/**
 * Relay SigiloPay.sendHome for the signed pieces. Simulated first, so a bad signature or an
 * expired intent costs nothing. Returns the transaction and the CTK delivered.
 */
export async function relaySendHome({ auths, intent }: SendHomeArgs) {
  const { account, publicClient, walletClient } = clients();
  const request = {
    address: SIGILO_TESTNET.sigiloPay,
    abi: sigiloPayAbi,
    functionName: "sendHome",
    args: [auths, intent],
    account,
  } as const;
  await publicClient.simulateContract(request);
  const gas = await publicClient.estimateContractGas(request);
  const hash = await walletClient.writeContract({ ...request, gas: (gas * 115n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  let amountOut = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SIGILO_TESTNET.sigiloPay.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: sigiloPayAbi, data: log.data, topics: log.topics });
      if (event.eventName === "Paid") amountOut = event.args.amountOut;
    } catch {
      // Another event.
    }
  }
  return { hash, amountOut };
}

/**
 * Relay SigiloPay.collect (Advanced settings: move everything to another account). Same checks
 * as relaySendHome; the signed intent fixes the recipient and the total, so the operator can't
 * redirect the money.
 */
export async function relayCollect({ auths, intent }: SendHomeArgs): Promise<{ hash: Hex }> {
  const { account, publicClient, walletClient } = clients();
  const request = {
    address: SIGILO_TESTNET.sigiloPay,
    abi: sigiloPayAbi,
    functionName: "collect",
    args: [auths, intent],
    account,
  } as const;
  await publicClient.simulateContract(request);
  const gas = await publicClient.estimateContractGas(request);
  const hash = await walletClient.writeContract({ ...request, gas: (gas * 115n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return { hash };
}

const advanceVaultAbi = parseAbi([
  "function requestAdvance(bytes proof, bytes32[] publicInputs, uint256 amount, address recipient, uint256 deadline, bytes32 salt) returns (uint256 advanceId)",
  "event AdvanceIssued(uint256 indexed advanceId, uint256 indexed pseudonym, address indexed recipient, uint256 amount, uint256 owed)",
]);

/**
 * Relay AdvanceVault.requestAdvance (simulated first). Verifying the proof on-chain costs ~5.4M
 * gas, so the limit is the estimate plus 15% (Monad charges the limit).
 */
export async function relayRequestAdvance(args: {
  proof: Hex;
  publicInputs: Hex[];
  amount: bigint;
  recipient: Hex;
  deadline: bigint;
  salt: Hex;
}) {
  const { account, publicClient, walletClient } = clients();
  const request = {
    address: SIGILO_TESTNET.advanceVault,
    abi: advanceVaultAbi,
    functionName: "requestAdvance",
    args: [args.proof, args.publicInputs, args.amount, args.recipient, args.deadline, args.salt],
    account,
  } as const;
  await publicClient.simulateContract(request);
  const gas = await publicClient.estimateContractGas(request);
  const hash = await walletClient.writeContract({ ...request, gas: (gas * 115n) / 100n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SIGILO_TESTNET.advanceVault.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: advanceVaultAbi, data: log.data, topics: log.topics });
      if (event.eventName === "AdvanceIssued") {
        return { hash, advanceId: event.args.advanceId, owed: event.args.owed };
      }
    } catch {
      // Another event.
    }
  }
  throw new Error(`no AdvanceIssued event in ${hash}`);
}
