// Send home through the real UI, in headless Chromium with a virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:sendhome [baseUrl] [screenshotDir]
// María joins her employer in the browser and gets paid $20 (script side). She opens Mom's
// "send to" link, sends $15, and sees it delivered. Mom (script side) finds the money through
// her receipt; María keeps $5.

import {
  AGORA_TESTNET,
  currentPeriod,
  decryptReceipt,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePayslipKeypair,
  encodePaymentProfile,
  oneTimeAccountKey,
  paymentProfile,
} from "@sigilo/core";
import { erc20Abi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";
import { openBrowser } from "./lib/browser.mjs";
import { chain, check, randomPrf, signIn, sleep, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);

const employer = await verifiedEmployer("Acme Labs (send home e2e)", 20_000_000n);
const invite = await employer.invite("María Test", 2_000);

// Mom: a Sigilo account of her own.
const momPrf = randomPrf();
const momKeys = deriveAccountKeys(momPrf);
const momReceipts = derivePayslipKeypair(momPrf);
const mom = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(momPrf))));
const momAccount = await mom.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(momKeys.stealth)),
  receiptPublicKey: toHex(momReceipts.publicKey),
});
check("Mom has a Sigilo account", true);

const b = await openBrowser(9336, outDir);
try {
  await b.phone();
  await b.goto(`${base}/app/invite/${invite.code}`);
  check("invite offers to create an account", await b.waitFor("Create my account"));
  check("name accepted", await b.fill("#invite-name", "María Test", "Create my account"));
  await b.click("Create my account");
  check("joined", await b.waitFor("Activate Income Passport", 30_000));
  await b.click("Activate Income Passport");
  check("account opened", await b.waitFor("Digital dollars (AUSD)", 30_000));

  check("María paid $20", (await employer.pay(currentPeriod(), 2_000n)) === "done");

  await b.goto(`${base}/app/send?to=${momAccount}&name=Mam%C3%A1`);
  check("send page asks to sign in", await b.waitFor("Sign in with passkey"));
  await b.click("Sign in with passkey");
  check(
    "send page shows Mom and the balance",
    await b.waitFor("You can send up to $20.00", 30_000),
  );
  check("amount entered", await b.fill("#send-amount", "15", "to Mamá"));
  await b.shot("sendhome-form");
  await b.click("Send $15 to Mamá");
  const delivered = await b.waitFor("Delivered in", 60_000);
  check("delivered", delivered, delivered ? "" : (await b.text()).slice(-300));
  await b.shot("sendhome-delivered");

  // Mom's side: her receipt names María and her fresh account holds the money.
  const inbox = await mom.query(api.receipts.mine, {});
  const receipt = decryptReceipt(inbox[0]!.ciphertext, momReceipts.secretKey);
  check("Mom's receipt is from María", receipt.kind === "transfer" && receipt.from === "María");
  const account = oneTimeAccountKey(momKeys.stealth, receipt.pieces[0]!.ephemeralPubKey).address;
  const ctk = await chain.readContract({
    address: AGORA_TESTNET.ctk,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  check("Mom holds $15 in local money", ctk === 15n * 10n ** 18n);

  await b.click("Back to my account");
  await sleep(500);
  check("María's balance shows $5", await b.waitFor("$5", 30_000));
  await b.shot("sendhome-after");
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
