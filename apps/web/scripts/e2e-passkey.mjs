// End-to-end passkey test in headless Chromium with a virtual *platform* authenticator (like
// Touch ID / Face ID / Android biometrics) that supports PRF. Creates a company account through
// the real UI, then reloads and signs back in with the remembered passkey.
// Usage: pnpm e2e:passkey [baseUrl] [screenshotDir]   (needs `pnpm dev` running for localhost)
// Chromium: CHROME_BIN, or the Playwright headless shell (npx playwright install chromium-headless-shell).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [base = "http://localhost:3000", outDir = process.env.TMPDIR ?? "/tmp"] =
  process.argv.slice(2);
const bin =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const port = 9334;
const chrome = spawn(
  bin,
  [`--remote-debugging-port=${port}`, "--window-size=1280,900", "about:blank"],
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
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
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
  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder="Company name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(company)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(300);
  await evaluate(
    `[...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Create with")).click()`,
  );
  check("company created and dashboard opened", await waitFor("Payroll balance"), company);
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
  await evaluate(
    `[...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Continue with")).click()`,
  );
  check("signed back in to the same company", await waitFor(company));
  await shot("e2e-signed-back-in");

  ws.close();
} finally {
  chrome.kill();
}
