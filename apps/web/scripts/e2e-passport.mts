// Income Passport through the real UI, in headless Chromium with a virtual platform authenticator
// that supports PRF (as in e2e-passkey.mjs):
//   pnpm dev   (other terminal)
//   pnpm e2e:passport [baseUrl] [screenshotDir]
// A verified test employer (script side) invites María; she joins and activates her Income
// Passport in the browser; the employer pays her for the last three months on testnet; the
// lender console opens an income check; María answers it on a phone-sized screen (proved in the
// browser); the lender pays $0.10 through MPP and sees "Income verified".

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentPeriod } from "@sigilo/core";

import { check, sleep, verifiedEmployer } from "./lib/testnet.mjs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const bin =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const port = 9335;
const GROSS_CENTS = 2_000n;

// ---------------------------------------------------------------- employer + invite (script side)
const employer = await verifiedEmployer("Acme Labs (e2e)", GROSS_CENTS * 3n * 10_000n);
const invite = await employer.invite("María Test", Number(GROSS_CENTS));
check("verified employer invited María", true);

const profile = mkdtempSync(join(tmpdir(), "sigilo-e2e-passport-"));
const chrome = spawn(
  bin,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);

try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .then((l: { type: string; webSocketDebuggerUrl: string }[]) =>
        l.find((t) => t.type === "page"),
      )
      .catch(() => undefined);
  }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<
    number,
    (msg: { result?: unknown; error?: { message: string } }) => void
  >();
  const pageErrors: string[] = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
      );
    }
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
    new Promise<{ result?: unknown; error?: { message: string } }>((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    }).then((msg) => {
      if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
      return msg.result;
    });
  const evaluate = async (expression: string) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result
      .value;
  const text = async (): Promise<string> =>
    (await evaluate('document.body ? document.body.innerText : ""').catch(() => "")) ?? "";
  const waitFor = async (needle: string, ms = 20_000) => {
    for (let t = 0; t < ms; t += 250) {
      if ((await text()).includes(needle)) return true;
      await sleep(250);
    }
    return false;
  };
  const click = (label: string) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim().includes(${JSON.stringify(label)}) && !b.disabled);
      if (b) b.click();
      return !!b;
    })()`);
  // React ignores values typed before hydration: clear and retype until the button enables.
  const fill = async (selector: string, value: string, button: string) => {
    for (let t = 0; t < 20_000; t += 250) {
      const ok = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim().includes(${JSON.stringify(button)}));
        if (!input || !b) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        if (input.value !== ${JSON.stringify(value)} || b.disabled) {
          setter.call(input, "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          setter.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return !b.disabled;
      })()`);
      if (ok) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name: string) => {
    await evaluate("document.querySelector('nextjs-portal')?.remove()");
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, "base64"));
  };
  const phone = () =>
    send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
  const desktop = () =>
    send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("WebAuthn.enable", { enableUI: false });
  await send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });

  // ---------------------------------------------------------------- María joins on her phone
  await phone();
  await send("Page.navigate", { url: `${base}/app/invite/${invite.code}` });
  check("invite offers to create an account", await waitFor("Create my account"));
  check("name accepted", await fill("#invite-name", "María Test", "Create my account"));
  await click("Create my account");
  check(
    "joined; asked to activate the passport",
    await waitFor("Activate Income Passport", 30_000),
  );
  await click("Activate Income Passport");
  check("Income Passport active, account opened", await waitFor("Digital dollars (AUSD)", 30_000));

  // ---------------------------------------------------------------- three months of pay (script side)
  const now = currentPeriod();
  for (const period of [now - 3, now - 2, now - 1]) {
    check(`paid María for ${period}`, (await employer.pay(period, GROSS_CENTS)) === "done");
  }

  // ---------------------------------------------------------------- lender opens a check
  await desktop();
  await send("Page.navigate", { url: `${base}/lender` });
  check("lender console opens", await waitFor("New income check"));
  check("amount entered", await fill('input[inputmode="decimal"]', "15", "Create income check"));
  await click("Create income check");
  check("check created, waiting for the applicant", await waitFor("Waiting for the applicant…"));
  await sleep(500);
  await shot("passport-lender-open");
  const link: string = await evaluate(`document.querySelector("input[readonly]").value`);
  check("lender has a link to send", link.includes("/v/"), link);

  // ---------------------------------------------------------------- María answers
  await phone();
  await send("Page.navigate", { url: link });
  check("María sees who is asking", await waitFor("wants to confirm your income"));
  await shot("passport-worker-ask");
  await click("Sign in with passkey to answer");
  check("signed in; can share", await waitFor("Share my Income Passport"));
  const started = Date.now();
  await click("Share my Income Passport");
  check("shows progress", await waitFor("Sealing your Income Passport", 30_000));
  await shot("passport-worker-sealing");
  const sent = await waitFor("Sent to Fondo Quincena", 120_000);
  const tail = (await text()).slice(-400);
  check("Income Passport sent", sent, sent ? `${Date.now() - started} ms` : tail);
  await shot("passport-worker-sent");

  // ---------------------------------------------------------------- lender verifies (MPP)
  await desktop();
  await send("Page.navigate", { url: `${base}/lender` });
  check("lender sees it's ready", await waitFor("Ready to verify"));
  await click("Verify for $0.10");
  check("lender paid and sees Income verified", await waitFor("Income verified", 60_000));
  await sleep(800);
  await shot("passport-lender-verified");
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  ws.close();
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Leftover temp profile.
  }
}
