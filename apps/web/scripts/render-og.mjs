// Render the social share image from /og-card (dev only) into src/app/opengraph-image.jpg and
// twitter-image.jpg. Usage: `pnpm dev` in one terminal, then `pnpm og:render`.
// JPEG at 1200×630, kept small because WhatsApp drops previews over ~300 KB.
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = new URL("../src/app/opengraph-image.jpg", import.meta.url).pathname;
const bin =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const profile = mkdtempSync(join(tmpdir(), "sigilo-og-"));
const chrome = spawn(
  bin,
  ["--remote-debugging-port=9336", `--user-data-dir=${profile}`, "about:blank"],
  {
    stdio: "ignore",
  },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch("http://127.0.0.1:9336/json/list")
      .then((r) => r.json())
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 630,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Static rosette (no draw-in animation) for the still image.
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await send("Page.enable");
  await send("Page.navigate", { url: `${base}/og-card` });
  await sleep(4000); // fonts and hydration
  await send("Runtime.evaluate", {
    expression: "document.querySelector('nextjs-portal')?.remove()",
  });
  const { data } = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 88,
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
  });
  writeFileSync(out, Buffer.from(data, "base64"));
  copyFileSync(out, out.replace("opengraph-image", "twitter-image"));
  console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB) and twitter-image.jpg`);
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
