// Advanced settings through the real UI, in headless Chromium with a virtual passkey (PRF):
//   pnpm dev   (other terminal)
//   pnpm e2e:settings [baseUrl] [screenshotDir]
// María joins her employer in the browser and gets paid $38 (five pieces, script side). In
// Settings → Advanced she accepts the warning, confirms with her passkey, moves everything to a
// fresh external address, and exports her keys. The script checks the chain and the file.

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { currentPeriod, encodePaymentProfile, paymentProfile } from "@sigilo/core";
import { hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { openBrowser } from "./lib/browser.mjs";
import { ausdBalance, check, sleep, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const downloads = join(outDir, `downloads-${Date.now()}`);

const employer = await verifiedEmployer("Acme Labs (settings e2e)", 38_000_000n);
const invite = await employer.invite("María Test", 3_800);
const external = privateKeyToAccount(generatePrivateKey()).address;

const b = await openBrowser(9415, outDir);
/** Type into an input as a person would (React's value tracker sees the change). */
const type = (selector: string, value: string) =>
  b.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
const scrollTo = (selector: string) =>
  b.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`,
  );

try {
  await b.phone();
  await b.goto(`${base}/app/invite/${invite.code}`);
  check("invite offers to create an account", await b.waitFor("Create my account"));
  check("name accepted", await b.fill("#invite-name", "María Test", "Create my account"));
  await b.click("Create my account");
  check("joined", await b.waitFor("Activate Income Passport", 30_000));
  await b.click("Activate Income Passport");
  check("account opened", await b.waitFor("Digital dollars (AUSD)", 30_000));

  check("María paid $38", (await employer.pay(currentPeriod(), 3_800n)) === "done");
  check("dashboard shows $38", await b.waitFor("$38", 30_000));
  await b.shot("adv-01-dashboard");

  check("dashboard links to Settings", await b.click("Settings"));
  check("settings shows the account", await b.waitFor("María Test", 15_000));
  await b.shot("adv-02-settings");

  check("Advanced is collapsed", !(await b.text()).includes("I understand"));
  await b.click("Advanced");
  check("Advanced warns first", await b.waitFor("leaves Sigilo’s protection"));
  const before = await b.text();
  check(
    "no technical words before the step-up",
    !/address|private key|AUSD|token|transaction/i.test(before.split("Advanced")[1] ?? ""),
  );
  await scrollTo("[aria-controls]");
  await b.shot("adv-03-warning");

  const confirm = () =>
    b.evaluate(
      `[...document.querySelectorAll("button")].find((x) => x.innerText.includes("Confirm with passkey"))?.disabled`,
    );
  check("passkey step needs “I understand”", (await confirm()) === true);
  await b.evaluate(`document.querySelector("#advanced-understand").click()`);
  check("“I understand” enables the step-up", (await confirm()) === false);
  await b.click("Confirm with passkey");
  check("passkey step-up opens the tools", await b.waitFor("Advanced tools are open", 20_000));
  check("tools count the AUSD", await b.waitFor("$38.00 AUSD", 30_000));
  check("five one-time accounts", (await b.text()).includes("in 5 one-time accounts"));
  await sleep(800); // Let the seal finish breaking.
  await scrollTo("[aria-controls]");
  await b.shot("adv-04-unlocked");

  // A typo only the checksum catches.
  await type("#move-to", flipCase(external));
  check("checksum typo refused", await b.waitFor("match its checksum", 5_000));
  await scrollTo("#move-title");
  await b.shot("adv-05-typo");

  await type("#move-to", external.toLowerCase());
  check("valid address is checksummed", await b.waitFor("Valid address.", 5_000));
  await scrollTo("#move-title");
  await b.shot("adv-06-valid");
  await b.click("Review move");
  check("review shows the amount", await b.waitFor("Move $38.00", 5_000));
  await scrollTo("#move-title");
  await b.shot("adv-07-review");

  await b.click("Move $38.00");
  const moved = await b.waitFor("Moved $38.00", 60_000);
  check("moved", moved, moved ? "" : (await b.text()).slice(-300));
  await scrollTo("#move-title");
  await b.shot("adv-08-moved");
  check("links to the explorer", (await b.text()).includes("View the transaction on MonadVision"));
  check("external account received exactly $38", (await ausdBalance(external)) === 38_000_000n);

  // Export keys: a second confirmation, then a file that never touches a server.
  await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  check("export asks first", await b.click("Export keys…"));
  check("export warns", await b.waitFor("This file holds private keys", 5_000));
  await scrollTo("#export-title");
  await b.shot("adv-09-export-confirm");
  await b.click("Download keys file");
  check("export saved", await b.waitFor("Saved to your downloads", 5_000));
  await scrollTo("#export-title");
  await b.shot("adv-10-export-done");
  await b.desktop();
  await scrollTo("[aria-controls]");
  await b.shot("adv-11-desktop");
  await b.phone();

  let file: string | undefined;
  for (let i = 0; i < 40 && !file; i++) {
    await sleep(250);
    file = readdirSync(downloads).find((f) => f.endsWith(".json"));
  }
  check("file downloaded", !!file, file);
  const exported = JSON.parse(readFileSync(join(downloads, file!), "utf8"));
  rmSync(downloads, { recursive: true, force: true });
  const identity = JSON.parse(
    await b.evaluate(`localStorage.getItem("sigilo:identity:worker")`),
  ) as { address: string };
  check(
    "file holds the account key",
    exported.version === 1 &&
      exported.account.address === identity.address &&
      privateKeyToAddress(exported.account.privateKey) === identity.address,
  );
  check(
    "file holds the stealth keys",
    encodePaymentProfile(
      paymentProfile({
        spendKey: hexToBytes(exported.oneTimeAccountKeys.spendKey),
        viewKey: hexToBytes(exported.oneTimeAccountKeys.viewKey),
      }),
    ) === exported.oneTimeAccountKeys.paymentProfile,
  );
  check(
    "file holds every one-time account, now empty",
    exported.oneTimeAccounts.length === 5 &&
      exported.oneTimeAccounts.every(
        (a: { token: string; address: string; privateKey: `0x${string}`; balance: string }) =>
          a.token === "AUSD" &&
          privateKeyToAddress(a.privateKey) === a.address &&
          a.balance === "0",
      ),
  );
  check("file holds the receipt key", /^0x[0-9a-f]{64}$/.test(exported.receiptKey.secretKey));

  await b.evaluate(`window.scrollTo(0, 0)`);
  await b.click("Lock");
  check("Lock locks the account", await b.waitFor("Sign in with passkey", 10_000));
  check(
    "no uncaught page errors",
    b.pageErrors.length === 0,
    b.pageErrors.join(" | ").slice(0, 300),
  );
} finally {
  rmSync(downloads, { recursive: true, force: true });
  await b.close();
}

/** The same address with one letter's case flipped: a typo only the checksum notices. */
function flipCase(address: string): string {
  const i = [...address].findIndex((c, j) => j > 1 && /[a-fA-F]/.test(c));
  const c = address[i]!;
  return (
    address.slice(0, i) +
    (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) +
    address.slice(i + 1)
  );
}
