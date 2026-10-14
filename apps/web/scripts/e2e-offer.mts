// An advance offer reaches the applicant even after they left the check's page, and they can
// say no. Real UI in headless Chromium; the check is marked verified directly on the dev backend
// (internal functions), so no payroll or testnet funds are needed:
//   pnpm dev   (other terminal)
//   pnpm e2e:offer [baseUrl] [screenshotDir]

import { execFileSync } from "node:child_process";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api.js";
import { openBrowser } from "./lib/browser.mjs";
import { check, cloudUrl } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
if (cloudUrl.includes("bold-marlin")) throw new Error("dev backend only");

const convex = new ConvexHttpClient(cloudUrl);
const run = (fn: string, args: object) =>
  execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], { stdio: "pipe" });

const request = await convex.mutation(api.requests.create, { thresholdCents: 150_000 });
const row = (await convex.query(api.requests.get, { request }))!;
run("requests:markSubmitted", { request, proof: "0x00", publicInputs: [] });
const attestation = {
  valid: true,
  thresholdCents: row.thresholdCents,
  firstPeriod: 0,
  months: row.months,
  scope: row.scope,
  nonce: row.nonce,
  pseudonym: "0x01",
  registryRoot: "0x02",
  verifiedAt: Date.now(),
};
run("requests:saveVerification", {
  request,
  attestation,
  signed: JSON.stringify({ attestation, signature: "0x" }),
});
await convex.mutation(api.advances.offer, { request, amountCents: 40_000, installments: 2 });

const b = await openBrowser(9360, outDir);
try {
  await b.phone();
  await b.goto(`${base}/app`);
  await b.waitFor("Create my account", 60_000);
  await b.fill("#worker-name", "Daniel Test", "Create my account");
  await b.click("Create my account");
  check("account open", await b.waitFor("Digital dollars (AUSD)", 30_000));
  check("no offer before answering", !(await b.text()).includes("offers you"));

  // What answering the check on this phone leaves behind.
  await b.evaluate(
    `localStorage.setItem("sigilo:answered-checks", ${JSON.stringify(JSON.stringify([request]))}); window.dispatchEvent(new Event("sigilo:answered-checks")); true`,
  );
  check("offer shows on the account", await b.waitFor("Fondo Quincena offers you $400 now"));
  await b.shot("offer-card");
  await b.click("See the offer");
  const onOffer = await b.waitFor("No thanks", 60_000);
  if (!onOffer) await b.shot("offer-page-failed");
  check("offer page", onOffer);
  await b.shot("offer-page");
  await b.click("No thanks");
  check("declined", await b.waitFor("No advance, no problem"));
  const after = await convex.query(api.requests.get, { request });
  check("lender sees the decline", after?.offerDeclined === true);
  await b.click("Open my account");
  await b.waitFor("Digital dollars (AUSD)", 30_000);
  check("offer gone from the account", !(await b.text()).includes("offers you"));
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  await b.close();
}
