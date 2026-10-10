// Send home on the configured Convex deployment and Monad testnet:
//   pnpm smoke:sendhome
// A verified employer pays María $20; she sends $15 to Mom's Sigilo account. Her pieces sign
// ERC-3009 authorizations bound to the intent, an unauthenticated relay submits
// SigiloPay.sendHome (AUSD → CTK on Agora), and Mom finds the money through her receipt.

import {
  AGORA_TESTNET,
  commitment,
  currentPeriod,
  decryptReceipt,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePaymentProfile,
  fieldToHex,
  oneTimeAccountKey,
  paymentProfile,
  prepareSendHome,
  type Receipt,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import { type Address, erc20Abi, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";
import {
  ausdBalance,
  chain,
  check,
  cloudUrl,
  randomPrf,
  signIn,
  verifiedEmployer,
} from "./lib/testnet.mjs";

const pairAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);

async function person(name: string) {
  const prf = randomPrf();
  const keys = deriveAccountKeys(prf);
  const receipts = derivePayslipKeypair(prf);
  const client = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(prf))));
  const account = await client.mutation(api.accounts.register, {
    paymentProfile: encodePaymentProfile(paymentProfile(keys.stealth)),
    receiptPublicKey: toHex(receipts.publicKey),
  });
  return { name, keys, receipts, client, account };
}

const employer = await verifiedEmployer("Acme Labs (send home smoke test)", 20_000_000n);
const maria = await person("María");
const mom = await person("Mom");
const invite = await employer.invite("María", 2_000);
await maria.client.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
await maria.client.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(derivePassportSecret(randomPrf()))),
});
check("María paid $20", (await employer.pay(currentPeriod(), 2_000n)) === "done");

// María's wallet, rebuilt from her receipts.
const pieces: { privateKey: `0x${string}`; balance: bigint; account: Address }[] = [];
for (const row of await maria.client.query(api.receipts.mine, {})) {
  const r = decryptReceipt(row.ciphertext, maria.receipts.secretKey);
  for (const p of r.pieces) {
    const k = oneTimeAccountKey(maria.keys.stealth, p.ephemeralPubKey);
    pieces.push({
      privateKey: k.privateKey,
      balance: await ausdBalance(k.address),
      account: k.address,
    });
  }
}
check("María has $20 in pieces", pieces.reduce((s, p) => s + p.balance, 0n) === 20_000_000n);

const anonymous = new ConvexHttpClient(cloudUrl);
const momProfile = (await anonymous.query(api.transfers.recipient, { account: mom.account }))!;
const sent = await prepareSendHome({
  pieces,
  amount: 15_000_000n,
  recipient: momProfile,
  from: "María",
  quote: async (ausd) =>
    (
      await chain.readContract({
        address: AGORA_TESTNET.ctkAusdPair,
        abi: pairAbi,
        functionName: "getAmountsOut",
        args: [ausd, [AGORA_TESTNET.ausd, AGORA_TESTNET.ctk]],
      })
    )[1]!,
});
const started = Date.now();
const result = await anonymous.action(api.transfers.sendHome, {
  auths: sent.auths.map((a) => ({
    from: a.from,
    value: a.value.toString(),
    signature: a.signature,
  })),
  intent: {
    to: sent.intent.to,
    total: sent.intent.total.toString(),
    minOut: sent.intent.minOut.toString(),
    deadline: Number(sent.intent.deadline),
    salt: sent.intent.salt,
  },
  recipient: mom.account,
  receipt: sent.receipt,
});
check(
  "relay delivered without knowing the sender",
  BigInt(result.amountOut) >= sent.intent.minOut,
  `${Date.now() - started} ms, ${result.txHash}`,
);

const inbox = await mom.client.query(api.receipts.mine, {});
const receipt = decryptReceipt(inbox[0]!.ciphertext, mom.receipts.secretKey) as Receipt;
check(
  "Mom's receipt says it's from María",
  receipt.kind === "transfer" && receipt.from === "María",
);
const momAccount = oneTimeAccountKey(mom.keys.stealth, receipt.pieces[0]!.ephemeralPubKey).address;
const ctk = await chain.readContract({
  address: AGORA_TESTNET.ctk,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [momAccount],
});
check("Mom's fresh account holds the CTK", ctk === BigInt(result.amountOut), `${ctk}`);
const left = (await Promise.all(pieces.map((p) => ausdBalance(p.account)))).reduce(
  (s, b) => s + b,
  0n,
);
check("María keeps the remaining $5", left === 5_000_000n);
console.log("\nAll checks passed.");
