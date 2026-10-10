// Headless Chromium over CDP for the UI tests: a fresh profile, a virtual *platform* passkey
// authenticator with PRF (like iCloud Keychain or Google Password Manager), and small helpers
// that find things by their visible text, as a person would.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser(port: number, outDir: string) {
  const bin =
    process.env.CHROME_BIN ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
  const profile = mkdtempSync(join(tmpdir(), "sigilo-e2e-"));
  // Extra flags, e.g. CHROME_ARGS=--disable-web-security for a dev server on another port.
  const extra = (process.env.CHROME_ARGS ?? "").split(/\s+/).filter(Boolean);
  const chrome = spawn(
    bin,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...extra, "about:blank"],
    { stdio: "ignore" },
  );

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
  if (!target) throw new Error("Chromium didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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

  return {
    send,
    evaluate,
    text,
    pageErrors,
    goto: (url: string) => send("Page.navigate", { url }),
    async waitFor(needle: string, ms = 20_000) {
      for (let t = 0; t < ms; t += 250) {
        if ((await text()).includes(needle)) return true;
        await sleep(250);
      }
      return false;
    },
    /** Click the first enabled button or link whose text contains `label`. */
    click: (label: string): Promise<boolean> =>
      evaluate(`(() => {
        const el = [...document.querySelectorAll("button, a")].find((b) => b.innerText.trim().includes(${JSON.stringify(label)}) && !b.disabled);
        if (el) el.click();
        return !!el;
      })()`),
    /** React ignores values typed before hydration: clear and retype until `button` enables. */
    async fill(selector: string, value: string, button: string) {
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
    },
    async shot(name: string) {
      await evaluate("document.querySelector('nextjs-portal')?.remove()");
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, "base64"));
    },
    phone: () =>
      send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      }),
    desktop: () =>
      send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    async close() {
      ws.close();
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await exited;
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Leftover temp profile.
      }
    },
  };
}
