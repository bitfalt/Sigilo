// Monad testnet reads and writes from the browser.
//
// Monad specifics (see the gas and concepts skills):
// - Gas is charged on the gas *limit*: estimate, then add 15%.
// - Accounts under the 10 MON reserve may send ~1 transaction per 3 blocks, and a freshly funded
//   account is seen by consensus a few blocks late, so transient refusals are retried with backoff
//   and sequential sends are spaced.

import { AGORA_TESTNET } from "@sigilo/core/constants";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Hex,
  http,
  type LocalAccount,
} from "viem";
import { monadTestnet } from "viem/chains";

import { MONAD_RPC_URL } from "./config";

const transport = http(MONAD_RPC_URL);
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport,
  batch: { multicall: true },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOW_BALANCE_SPACING_MS = 1_500;
const transient = (e: unknown) => /insufficient balance|reserve|rate|nonce/i.test(String(e));

/** AUSD balances (base units) of many accounts in one Multicall3 round trip. */
export async function ausdBalances(accounts: readonly Address[]): Promise<bigint[]> {
  if (accounts.length === 0) return [];
  const results = await publicClient.multicall({
    contracts: accounts.map((a) => ({
      address: AGORA_TESTNET.ausd,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [a] as const,
    })),
    allowFailure: false,
  });
  return results as bigint[];
}

/** Send a contract call with a tight gas limit, Monad-aware retries, and receipt checking. */
export async function writeContract(
  account: LocalAccount,
  request: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  for (let attempt = 0; ; attempt++) {
    try {
      const gas = await publicClient.estimateContractGas({ ...request, account });
      const hash = await wallet.writeContract({ ...request, gas: (gas * 115n) / 100n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The payment didn't go through");
      await sleep(LOW_BALANCE_SPACING_MS);
      return hash;
    } catch (e) {
      if (attempt >= 8 || !transient(e)) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
}
