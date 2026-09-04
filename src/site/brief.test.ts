import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { arrivalFor, briefPath, hasBrief, icpSeed, loadArrivalContext } from "./brief.js";

// briefPath is relative to cwd, so the whole suite runs inside a scratch dir
const scratch = mkdtempSync(join(tmpdir(), "clientsim-brief-"));
const cwd = process.cwd();
before(() => process.chdir(scratch));
after(() => {
  process.chdir(cwd);
  rmSync(scratch, { recursive: true, force: true });
});

const URL = "https://www.example.com/";

const BRIEF = `# example.com

${URL}

| | |
|---|---|
| **Product** | Scraping API that returns markdown |
| **For** | Developers building AI apps |
| **Main CTA** | "Start for free" leads to /signup |
| **Signup** | Google SSO or email, at /signup |
| **Pricing** | Free tier, then $16/mo |

## Walls

- Google SSO on signup

## What a first-timer trips on

- Pricing is not linked above the fold

## Arrival context

You searched for a way to turn web pages into clean markdown for a RAG pipeline.

<!-- Written by client-simulator from the live page. Regenerate with --plan. -->
`;

function writeBrief(body = BRIEF) {
  const path = briefPath(URL);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

describe("arrivalFor", () => {
  it("gives a cold persona nothing — it has never heard of the product", () => {
    writeBrief();
    assert.equal(arrivalFor(URL, "cold"), null);
  });

  it("gives a warm persona the arrival paragraph and nothing else", () => {
    writeBrief();
    const warm = arrivalFor(URL, "warm");
    assert.ok(warm?.includes("clean markdown for a RAG pipeline"));
    // the specifics are what separates warm from hot; warm must not have them
    assert.ok(!warm?.includes("$16/mo"), "warm was handed the pricing");
    assert.ok(!warm?.includes("Google SSO"), "warm was handed the signup path");
  });

  it("gives a hot persona what a decided buyer would already have looked up", () => {
    writeBrief();
    const hot = arrivalFor(URL, "hot") ?? "";
    assert.ok(hot.includes("clean markdown for a RAG pipeline"), "hot lost the arrival paragraph");
    assert.ok(hot.includes("$16/mo"), "hot did not know the price");
    assert.ok(hot.includes("Google SSO"), "hot did not know how to sign up");
  });

  it("returns null for every temperature when no brief was written", () => {
    rmSync(join(scratch, "runs"), { recursive: true, force: true });
    assert.equal(hasBrief(URL), false);
    for (const t of ["cold", "warm", "hot"] as const) assert.equal(arrivalFor(URL, t), null);
  });

  it("falls back to the arrival paragraph when the table has no specifics", () => {
    writeBrief(`# example.com\n\n## Arrival context\n\nYou wanted a scraper.\n`);
    assert.equal(arrivalFor(URL, "hot"), "You wanted a scraper.");
    assert.equal(arrivalFor(URL, "warm"), "You wanted a scraper.");
  });

  it("treats a brief with no arrival section as no context at all", () => {
    writeBrief(`# example.com\n\n| | |\n|---|---|\n| **Product** | A thing |\n`);
    assert.equal(loadArrivalContext(URL), null);
    assert.equal(arrivalFor(URL, "hot"), null);
  });
});

describe("icpSeed", () => {
  it("pairs who it is for with what it is", () => {
    writeBrief();
    assert.equal(
      icpSeed(URL),
      "Developers building AI apps (product: Scraping API that returns markdown)",
    );
  });

  it("is null without an audience — a persona set needs someone to be for", () => {
    writeBrief(`# example.com\n\n| | |\n|---|---|\n| **Product** | A thing |\n`);
    assert.equal(icpSeed(URL), null);
  });
});

describe("botWallMarker", () => {
  it("names the wall for known blocker pages", async () => {
    const { botWallMarker } = await import("./brief.js");
    assert.match(botWallMarker("Just a moment...")!, /Cloudflare/);
    assert.match(botWallMarker("Please verify you are human to continue")!, /human/);
    assert.match(botWallMarker("protected by reCAPTCHA")!, /captcha/);
    assert.match(botWallMarker("Attention Required! | Cloudflare")!, /block page/);
  });

  it("reads an ordinary landing page as clean", async () => {
    const { botWallMarker } = await import("./brief.js");
    assert.equal(botWallMarker("Firecrawl turns websites into LLM-ready data. Start for free."), null);
  });
});
