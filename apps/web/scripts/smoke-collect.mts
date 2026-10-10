// Advanced settings, "Move everything to another account", on the configured Convex deployment
// and Monad testnet:
//   pnpm smoke:collect
// A verified employer pays María $20. Her pieces sign ERC-3009 authorizations bound to a Collect
// intent, an unauthenticated relay submits SigiloPay.collect, and a fresh external account ends
// up with exactly $20 while every piece is empty.

import {
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
  prepareCollect,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import { type Address, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";
import {
  ausdBalance,
  check,
  cloudUrl,
  randomPrf,
  signIn,
  verifiedEmployer,
} from "./lib/testnet.mjs";

const employer = await verifiedEmployer("Acme Labs (collect smoke test)", 20_000_000n);

const prf = randomPrf();
const keys = deriveAccountKeys(prf);
const receipts = derivePayslipKeypair(prf);
const maria = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(prf))));
await maria.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(keys.stealth)),
  receiptPublicKey: toHex(receipts.publicKey),
});
const invite = await employer.invite("María", 2_000);
await maria.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
await maria.mutation(api.employees.setPassportCommitment, {
  commitment: fieldToHex(commitment(derivePassportSecret(randomPrf()))),
});
check("María paid $20", (await employer.pay(currentPeriod(), 2_000n)) === "done");

// María's pieces, rebuilt from her receipts.
const pieces: { privateKey: `0x${string}`; balance: bigint; account: Address }[] = [];
for (const row of await maria.query(api.receipts.mine, {})) {
  const r = decryptReceipt(row.ciphertext, receipts.secretKey);
  for (const p of r.pieces) {
    const k = oneTimeAccountKey(keys.stealth, p.ephemeralPubKey);
    pieces.push({
      privateKey: k.privateKey,
      balance: await ausdBalance(k.address),
      account: k.address,
    });
  }
}
check(
  "María has $20 in pieces",
  pieces.reduce((s, p) => s + p.balance, 0n) === 20_000_000n,
  `${pieces.length} pieces`,
);

// A fresh account outside Sigilo, e.g. one she manages in her own app.
const external = privateKeyToAccount(generatePrivateKey()).address;
const { total, batches } = await prepareCollect({ pieces, to: external });
check("one Collect intent for all of it", batches.length === 1 && total === 20_000_000n);

const anonymous = new ConvexHttpClient(cloudUrl);
const started = Date.now();
for (const { intent, auths } of batches) {
  const { txHash } = await anonymous.action(api.transfers.collect, {
    auths: auths.map((a) => ({ from: a.from, value: a.value.toString(), signature: a.signature })),
    intent: {
      to: intent.to,
      total: intent.total.toString(),
      deadline: Number(intent.deadline),
      salt: intent.salt,
    },
  });
  check(
    "relay moved it without knowing whose it was",
    true,
    `${Date.now() - started} ms, ${txHash}`,
  );
}

check("external account received exactly $20", (await ausdBalance(external)) === 20_000_000n);
const left = await Promise.all(pieces.map((p) => ausdBalance(p.account)));
check(
  "every piece is empty",
  left.every((b) => b === 0n),
);

// Replaying the same signed move is refused before it costs anything.
await anonymous
  .action(api.transfers.collect, {
    auths: batches[0]!.auths.map((a) => ({
      from: a.from,
      value: a.value.toString(),
      signature: a.signature,
    })),
    intent: {
      to: batches[0]!.intent.to,
      total: batches[0]!.intent.total.toString(),
      deadline: Number(batches[0]!.intent.deadline),
      salt: batches[0]!.intent.salt,
    },
  })
  .then(
    () => check("replay refused", false),
    (e: { data?: unknown }) =>
      check("replay refused", /didn't go through/.test(String(e.data ?? e))),
  );
console.log("\nAll checks passed.");
