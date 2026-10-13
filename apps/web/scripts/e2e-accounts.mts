// One phone, several Sigilo accounts, through the real UI with a virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:accounts [baseUrl] [screenshotDir]
// A company owner sets up their company on this phone, then opens the worker app: the browser
// offers the company's passkey, which the worker door refuses. They create a personal account,
// lock it, and "Use a different account" still leads to a new account instead of a dead end.

import { openBrowser } from "./lib/browser.mjs";
import { check } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);

const b = await openBrowser(9350, outDir);
try {
  await b.phone();
  await b.goto(`${base}/employer`);
  check("company sign-up", await b.waitFor("Create company account", 60_000));
  await b.fill("#company-name", "Acme Labs (accounts e2e)", "Create company account");
  await b.click("Create company account");
  check("company open", await b.waitFor("Acme Labs (accounts e2e)", 30_000));

  // Only the company's passkey exists, and the worker door must not open it.
  await b.goto(`${base}/app`);
  check("worker app looks new", await b.waitFor("Create my account"));
  await b.click("Sign in with a passkey");
  check("company passkey refused", await b.waitFor("That passkey opens a company account"));
  await b.shot("accounts-refused");

  await b.fill("#worker-name", "Daniel Test", "Create my account");
  await b.click("Create my account");
  check("personal account open", await b.waitFor("Digital dollars (AUSD)", 30_000));

  await b.click("Lock");
  check("locked, remembered", await b.waitFor("Welcome back, Daniel Test"));
  await b.click("Use a different account");
  check("different account leads to a new account", await b.waitFor("Create my account"));
  await b.shot("accounts-another");

  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
