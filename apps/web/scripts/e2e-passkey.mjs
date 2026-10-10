// End-to-end passkey test in headless Chromium with a virtual *platform* authenticator (like
// a built-in passkey provider) that supports PRF. Creates a company account through
// the real UI, then reloads and signs back in with the remembered passkey.
// Usage: pnpm e2e:passkey [baseUrl] [screenshotDir]   (needs `pnpm dev` running for localhost)
// Chromium: CHROME_BIN, or the Playwright headless shell (npx playwright install chromium-headless-shell).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const bin =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const port = 9334;
// A fresh profile each run: no cached pages, no passkeys from earlier runs.
const profile = mkdtempSync(join(tmpdir(), "sigilo-e2e-"));
const chrome = spawn(
  bin,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(
        msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
      );
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    }).then((msg) => {
      if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
      return msg.result;
    });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result
      .value;
  const text = async () =>
    (await evaluate('document.body ? document.body.innerText : ""').catch(() => "")) ?? "";
  const waitFor = async (needle, ms = 20000) => {
    for (let t = 0; t < ms; t += 250) {
      if ((await text()).includes(needle)) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await send("WebAuthn.addVirtualAuthenticator", {
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

  // 1. First visit: the create path is offered, not a sign-in that can't succeed.
  await send("Page.navigate", { url: `${base}/employer` });
  check("first visit offers to create a company", await waitFor("Create your company account"));

  // 2. Create the company with the platform passkey (PRF) through the real UI.
  const company = `Passkey Test ${Date.now() % 100000}`;
  // Fill the name until React has hydrated and enabled the button, then create.
  let ready = false;
  for (let t = 0; t < 20000 && !ready; t += 250) {
    ready = await evaluate(`(() => {
      const input = document.querySelector('input[placeholder="Company name"]');
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Create company account");
      if (!input || !button) return false;
      // If the name was typed before React hydrated, React treats it as the baseline and never
      // fires onChange: clear and retype until the button reacts.
      if (button.disabled) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        setter.call(input, ${JSON.stringify(company)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return !button.disabled;
    })()`);
    if (!ready) await sleep(250);
  }
  check("create button enabled after hydration", ready);
  await evaluate(
    `[...document.querySelectorAll("button")].find((b) => b.textContent === "Create company account").click()`,
  );
  const created = await waitFor("Payroll balance");
  check("company created and dashboard opened", created, company);
  if (!created) {
    console.log("page says:", (await text()).slice(0, 400).replace(/\n+/g, " | "));
    console.log("browser errors:", JSON.stringify(consoleErrors.slice(0, 8), null, 1));
  }
  check("company name shown", (await text()).includes(company));
  const creds = await send("WebAuthn.getCredentials", { authenticatorId });
  check(
    "passkey stored on the device authenticator",
    creds.credentials.length === 1,
    `${creds.credentials.length} credential(s)`,
  );
  await shot("e2e-dashboard");

  // 3. Reload (keys gone from memory) and sign back in with the remembered passkey.
  await send("Page.reload");
  check("returning visit offers to continue", await waitFor("Welcome back"));
  await sleep(1500); // let React hydrate before clicking
  await evaluate(
    `[...document.querySelectorAll("button")].find((b) => b.textContent === "Sign in with passkey").click()`,
  );
  check("signed back in to the same company", await waitFor(company));
  await shot("e2e-signed-back-in");

  ws.close();
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Leftover temp profile; the OS cleans the temp dir.
  }
}
