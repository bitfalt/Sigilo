// The stateless / new-device test (SPEC.md F9), through the real UI in headless Chromium with a
// virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:stateless [baseUrl] [screenshotDir]
// María joins and is paid for three months. Then everything the browser stored is wiped (as on a
// new device: only the passkey survives). She signs in with "Sign in with a passkey" and gets the
// same balance and payslips back, then answers an income check, which only works if the passport
// secret re-derives to the same value.

import { currentPeriod } from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api.js";
import { openBrowser } from "./lib/browser.mjs";
import { check, cloudUrl, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const GROSS = 2_000n;
const employer = await verifiedEmployer("Acme Labs (stateless e2e)", GROSS * 3n * 10_000n);
const invite = await employer.invite("María Test", Number(GROSS));

const b = await openBrowser(9340, outDir);
try {
  await b.phone();
  await b.goto(`${base}/app/invite/${invite.code}`);
  check("invite offers to create an account", await b.waitFor("Create my account"));
  await b.fill("#invite-name", "María Test", "Create my account");
  await b.click("Create my account");
  check("joined", await b.waitFor("Activate Income Passport", 30_000));
  await b.click("Activate Income Passport");
  check("account opened", await b.waitFor("Digital dollars (AUSD)", 30_000));

  const now = currentPeriod();
  for (const p of [now - 3, now - 2, now - 1]) {
    check(`paid for ${p}`, (await employer.pay(p, GROSS)) === "done");
  }
  check("balance shows $60", await b.waitFor("$60", 60_000));
  await b.shot("stateless-before");

  // A new device: nothing stored survives, only the passkey on the authenticator.
  await b.evaluate(`(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) indexedDB.deleteDatabase(db.name);
    return true;
  })()`);
  await b.goto(`${base}/app`);
  check("looks like a first visit", await b.waitFor("Create my account"));
  await b.click("Sign in with a passkey");
  check("same balance after signing in", await b.waitFor("$60", 60_000));
  check("same payslips", (await b.text()).includes("Acme Labs (stateless e2e)"));
  await b.shot("stateless-after");

  // The passport secret must re-derive identically, or this proof can't match her payslips.
  const anonymous = new ConvexHttpClient(cloudUrl);
  const request = await anonymous.mutation(api.requests.create, { thresholdCents: 1_500 });
  await b.goto(`${base}/v/${request}`);
  await b.waitFor("wants to confirm your income");
  await b.click("Sign in with passkey to answer");
  await b.waitFor("Share my Income Passport");
  await b.click("Share my Income Passport");
  check("Income Passport still works", await b.waitFor("Sent to Fondo Quincena", 120_000));
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
