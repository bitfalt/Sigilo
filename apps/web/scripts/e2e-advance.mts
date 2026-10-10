// Salary advance through the real UI, in headless Chromium with a virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:advance [baseUrl] [screenshotDir]
// María joins and is paid for three months (script side), passes Fondo Quincena's check in the
// browser, the lender offers $4.50 over 2 paychecks from the console, María takes it on her phone
// (vault proof sealed in the browser, deduction signed with her session key), and the employer's
// next payroll (the real runPayroll, script side) repays the first installment.

import { currentPeriod } from "@sigilo/core";

import { api } from "../convex/_generated/api.js";
import type { EmployerKeys } from "../src/lib/identity";
import { runPayroll } from "../src/lib/payroll-client";
import { openBrowser } from "./lib/browser.mjs";
import { check, sleep, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const GROSS = 2_000n;

const employer = await verifiedEmployer("Acme Labs (advance e2e)", GROSS * 5n * 10_000n);
const invite = await employer.invite("María Test", Number(GROSS));
const keys = {
  account: employer.treasury,
  rosterKey: employer.rosterKey,
} as unknown as EmployerKeys;
async function payroll(period: number) {
  await runPayroll({
    api: {
      start: (a) => employer.client.mutation(api.runs.start, a),
      submit: (a) => employer.client.mutation(api.runs.submit, a as never),
      abort: (a) => employer.client.mutation(api.runs.abort, a as never),
      recordRepayment: (a) => employer.client.mutation(api.advances.recordRepayment, a as never),
    },
    keys,
    employer: { name: employer.name, employerId: employer.employerId },
    period,
    roster: await employer.client.query(api.employees.list, {}),
    mandates: await employer.client.query(api.advances.forPayroll, {}),
  });
  for (let i = 0; i < 60; i++) {
    const run = (await employer.client.query(api.runs.list, {})).find((r) => r.period === period);
    if (run?.status === "done") return true;
    await sleep(1_500);
  }
  return false;
}

const b = await openBrowser(9337, outDir);
try {
  await b.phone();
  await b.goto(`${base}/app/invite/${invite.code}`);
  check("invite offers to create an account", await b.waitFor("Create my account"));
  check("name accepted", await b.fill("#invite-name", "María Test", "Create my account"));
  await b.click("Create my account");
  check("joined", await b.waitFor("Activate Income Passport", 30_000));
  await b.click("Activate Income Passport");
  check("account opened", await b.waitFor("Digital dollars (AUSD)", 30_000));

  const now = currentPeriod();
  for (const p of [now - 3, now - 2, now - 1]) check(`paid for ${p}`, await payroll(p));

  // Lender check, answered and verified.
  await b.desktop();
  await b.goto(`${base}/lender`);
  check("lender console opens", await b.waitFor("New income check"));
  await b.fill('input[inputmode="decimal"]', "15", "Create income check");
  await b.click("Create income check");
  const created = await b.waitFor("Waiting for the applicant…", 30_000);
  check("check created", created, created ? "" : (await b.text()).slice(0, 600));
  const link: string = await b.evaluate(`document.querySelector("input[readonly]").value`);
  await b.phone();
  await b.goto(link);
  await b.waitFor("wants to confirm your income");
  await b.click("Sign in with passkey to answer");
  await b.waitFor("Share my Income Passport");
  await b.click("Share my Income Passport");
  check("Income Passport sent", await b.waitFor("Sent to Fondo Quincena", 120_000));
  await b.desktop();
  await b.goto(`${base}/lender`);
  await b.waitFor("Ready to verify");
  await b.click("Verify for $0.10");
  check("verified", await b.waitFor("Income verified", 60_000));

  // The lender offers an advance.
  check("offer form shown", await b.waitFor("Offer a salary advance"));
  check("amount set", await b.fill("#offer-amount", "4.50", "Offer"));
  await b.shot("advance-lender-offer");
  await b.click("Offer $4.50");
  check("offer sent", await b.waitFor("Waiting for the applicant to accept…"));

  // María takes it on her phone (fresh page: sign in again).
  await b.phone();
  await b.goto(link);
  check("María sees the offer", await b.waitFor("offers you $4.50 now", 30_000));
  await b.shot("advance-worker-offer");
  await b.click("Sign in with passkey");
  check("can take it", await b.waitFor("Take $4.50", 30_000));
  await b.click("Take $4.50");
  const taken = await b.waitFor("The money is yours", 180_000);
  check("advance received", taken, taken ? "" : (await b.text()).slice(-300));
  await b.shot("advance-worker-done");

  // Next payroll repays the first installment; the lender sees it.
  check("payroll with the deduction", await payroll(now));
  await b.desktop();
  await b.goto(`${base}/lender`);
  check("lender sees the repayment", await b.waitFor("Repaid $2.30 of $4.59", 30_000));
  await b.shot("advance-lender-repaid");
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
