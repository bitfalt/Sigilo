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

const sigiloPayAbi = parseAbi([
  "event Dispersed(address indexed payer, uint256 pieces, uint256 total)",
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
      if (event.args.payer.toLowerCase() === treasury.toLowerCase()) return event.args.total;
    } catch {
      // Not a Dispersed event.
    }
  }
  return null;
}
