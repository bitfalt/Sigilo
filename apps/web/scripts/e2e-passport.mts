// Income Passport through the real UI, in headless Chromium with a virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:passport [baseUrl] [screenshotDir]
// A verified test employer (script side) invites María; she joins and activates her Income
// Passport in the browser; the employer pays her for the last three months on testnet; the
// lender console opens an income check; María answers it on a phone-sized screen (proved in the
// browser); the lender pays $0.10 through MPP and sees "Income verified".

import { currentPeriod } from "@sigilo/core";

import { openBrowser } from "./lib/browser.mjs";
import { check, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const GROSS_CENTS = 2_000n;

const employer = await verifiedEmployer("Acme Labs (e2e)", GROSS_CENTS * 3n * 10_000n);
const invite = await employer.invite("María Test", Number(GROSS_CENTS));
check("verified employer invited María", true);

const b = await openBrowser(9335, outDir);
try {
  // María joins on her phone.
  await b.phone();
  await b.goto(`${base}/app/invite/${invite.code}`);
  check("invite offers to create an account", await b.waitFor("Create my account"));
  check("name accepted", await b.fill("#invite-name", "María Test", "Create my account"));
  await b.click("Create my account");
  check(
    "joined; asked to activate the passport",
    await b.waitFor("Activate Income Passport", 30_000),
  );
  await b.click("Activate Income Passport");
  check(
    "Income Passport active, account opened",
    await b.waitFor("Digital dollars (AUSD)", 30_000),
  );

  // Three months of pay (script side).
  const now = currentPeriod();
  for (const period of [now - 3, now - 2, now - 1]) {
    check(`paid María for ${period}`, (await employer.pay(period, GROSS_CENTS)) === "done");
  }

  // The lender opens a check.
  await b.desktop();
  await b.goto(`${base}/lender`);
  check("lender console opens", await b.waitFor("New income check"));
  check("amount entered", await b.fill('input[inputmode="decimal"]', "15", "Create income check"));
  await b.click("Create income check");
  check("check created, waiting for the applicant", await b.waitFor("Waiting for the applicant…"));
  await b.shot("passport-lender-open");
  const link: string = await b.evaluate(`document.querySelector("input[readonly]").value`);
  check("lender has a link to send", link.includes("/v/"), link);

  // María answers.
  await b.phone();
  await b.goto(link);
  check("María sees who is asking", await b.waitFor("wants to confirm your income"));
  await b.shot("passport-worker-ask");
  await b.click("Sign in with passkey to answer");
  check("signed in; can share", await b.waitFor("Share my Income Passport"));
  const started = Date.now();
  await b.click("Share my Income Passport");
  check("shows progress", await b.waitFor("Sealing your Income Passport", 30_000));
  await b.shot("passport-worker-sealing");
  const sent = await b.waitFor("Sent to Fondo Quincena", 120_000);
  check(
    "Income Passport sent",
    sent,
    sent ? `${Date.now() - started} ms` : (await b.text()).slice(-400),
  );
  await b.shot("passport-worker-sent");

  // The lender verifies (MPP).
  await b.desktop();
  await b.goto(`${base}/lender`);
  check("lender sees it's ready", await b.waitFor("Ready to verify"));
  await b.click("Verify for $0.10");
  check("lender paid and sees Income verified", await b.waitFor("Income verified", 60_000));
  await b.shot("passport-lender-verified");
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
