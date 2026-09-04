/**
 * Verifies that controls inside an iframe are measured and filtered correctly.
 *
 * Run after `npm run build`:  node scripts/verify-frames.mjs
 *
 * Not part of `npm test` — that suite is deliberately browser-free and runs in
 * under a second. This one launches Chromium and serves a local page.
 *
 * firecrawl produced fNeN refs mid-session but a fresh load of the same URL does
 * not, so a local page is the only way to test this repeatably. Same-origin
 * iframe, one control above the fold and one far below, so the measurement has
 * something to get right and something to get wrong.
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { BrowserDriver } = await import("../dist/browser/driver.js");
const { pruneSnapshot, splitByViewport } = await import("../dist/browser/prune.js");

const CHILD = `<!doctype html><meta charset=utf-8><body style="margin:0;font:16px sans-serif">
  <h2>Sign up</h2>
  <label>Email <input id=email type=email></label>
  <button id=go>Create account</button>
  <div style="height:2400px"></div>
  <button id=deep>Buried in the frame</button>
</body>`;

const PARENT = `<!doctype html><meta charset=utf-8><body style="margin:0;font:16px sans-serif">
  <h1>Parent page</h1>
  <button id=top>Top level button</button>
  <iframe src="/child" style="width:600px;height:400px;border:1px solid #ccc"></iframe>
  <div style="height:3000px"></div>
  <h2>Way down the parent</h2>
  <button id=bottom>Parent footer button</button>
</body>`;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(req.url === "/child" ? CHILD : PARENT);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const tmp = mkdtempSync(join(tmpdir(), "iframe-"));
const driver = new BrowserDriver();
const NEW = /\[ref=((?:f\d+)?e\d+)\]/g;
let failures = 0;
const check = (ok, msg) => {
  console.log(`    ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};

try {
  await driver.launch({ headless: true, shotsDir: tmp });
  await driver.goto(url);
  const snap = await driver.snapshot();

  const refs = [...new Set([...snap.ariaYaml.matchAll(NEW)].map((m) => m[1]))];
  const framed = refs.filter((r) => r.startsWith("f"));
  console.log(`\n  ${url}`);
  console.log(`  refs ${refs.length}, framed ${framed.length}: ${framed.join(", ") || "(none)"}\n`);

  if (framed.length === 0) {
    console.log("  Playwright's snapshot does not descend into iframes here.");
    console.log("  Nothing to verify — the fix is inert on this page.\n");
    process.exit(2);
  }

  console.log("  measurement");
  for (const ref of framed) {
    const got = snap.visibility[ref];
    const actual = await driver.page
      .locator(`aria-ref=${ref}`)
      .evaluate((n) => {
        const r = n.getBoundingClientRect();
        return { onScreen: r.bottom > 0 && r.top < window.innerHeight, hidden: r.width === 0 && r.height === 0 };
      })
      .catch(() => null);
    const label = (snap.ariaYaml.split("\n").find((l) => l.includes(`[ref=${ref}]`)) ?? "").trim().slice(0, 46);
    check(!!got && !!actual && got.onScreen === actual.onScreen, `${ref} ${label} → measured ${got?.onScreen}, actual ${actual?.onScreen}`);
  }

  console.log("\n  filtering");
  const { visible } = splitByViewport(pruneSnapshot(snap.ariaYaml), snap.visibility);
  check(visible.includes("Create account"), "the framed signup button survives the viewport filter");
  check(!visible.includes("Buried in the frame"), "the framed button 2400px down is filtered out");
  check(!visible.includes("Parent footer button"), "the parent's own below-fold button is filtered out");

  console.log("\n  what the old eN-only pattern would have done");
  const old = Object.fromEntries(Object.entries(snap.visibility).filter(([k]) => !k.startsWith("f")));
  const broken = splitByViewport(pruneSnapshot(snap.ariaYaml), old);
  check(!broken.visible.includes("Create account"), "old pattern LOSES the signup button (this is the bug)");

  console.log("\n  enforcement");
  const buried = framed.find((r) => snap.ariaYaml.includes(`[ref=${r}]`) && !snap.visibility[r]?.onScreen);
  if (buried) {
    const err = await driver
      .act({ thought: "", emotion: "", confusion: 0, action: { type: "click", target: buried } })
      .then(() => null)
      .catch((e) => e.message);
    check(!!err && /not on screen/.test(err), `act() refuses the off-screen framed ref: ${String(err).slice(0, 50)}`);
  } else {
    console.log("    (no off-screen framed ref to test enforcement with)");
  }

  console.log(`\n  ${failures === 0 ? "PASS" : `FAIL (${failures})`} — real iframe, live page\n`);
} finally {
  await driver.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
