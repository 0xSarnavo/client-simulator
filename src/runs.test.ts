import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { dirLabel, findSessionDirs, sessionPath, siteSlug } from "./runs.js";

const scratch = mkdtempSync(join(tmpdir(), "clientsim-runs-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe("siteSlug", () => {
  it("uses the hostname", () => {
    assert.equal(siteSlug("https://example.com"), "example.com");
    assert.equal(siteSlug("https://example.com/deep/path?q=1#x"), "example.com");
  });

  it("strips www. so a site does not split across two folders", () => {
    assert.equal(siteSlug("https://www.iana.org"), "iana.org");
    assert.equal(siteSlug("https://iana.org"), "iana.org");
  });

  it("keeps subdomains, which are genuinely different sites", () => {
    assert.equal(siteSlug("https://staging.team1.network/onboard"), "staging.team1.network");
  });

  it("keeps the port so local environments do not collide", () => {
    assert.equal(siteSlug("http://localhost:3000"), "localhost_3000");
    assert.notEqual(siteSlug("http://localhost:3000"), siteSlug("http://localhost:8080"));
  });

  it("assumes https when no scheme is given", () => {
    assert.equal(siteSlug("example.com/pricing"), "example.com");
  });

  it("never returns a path separator or empty string", () => {
    for (const input of ["", "   ", "not a url", "://", "http://", "../../etc/passwd"]) {
      const slug = siteSlug(input);
      assert.ok(slug.length > 0, `empty slug for ${JSON.stringify(input)}`);
      assert.ok(!slug.includes("/"), `slug escapes its folder: ${slug}`);
      assert.ok(!slug.includes(".."), `slug can traverse upward: ${slug}`);
    }
  });
});

describe("sessionPath", () => {
  const when = new Date("2026-08-26T19:04:47.607Z");

  it("files a run under site, then date, then time-persona", () => {
    const p = sessionPath("https://example.com", "cold", when, `${scratch}/a`);
    assert.equal(p, resolve(`${scratch}/a/example.com/2026-08-26/19-04-47-cold`));
  });

  it("suffixes rather than overwriting when two runs share a second", () => {
    const root = `${scratch}/b`;
    const first = sessionPath("https://example.com", "cold", when, root);
    mkdirSync(first, { recursive: true });
    const second = sessionPath("https://example.com", "cold", when, root);
    assert.notEqual(second, first);
    assert.ok(second.endsWith("19-04-47-cold-2"), second);
  });

  it("separates personas that run in the same second", () => {
    const root = `${scratch}/c`;
    assert.notEqual(
      sessionPath("https://example.com", "cold", when, root),
      sessionPath("https://example.com", "hot", when, root),
    );
  });
});

describe("findSessionDirs", () => {
  const root = `${scratch}/discovery`;
  const session = (rel: string) => {
    mkdirSync(`${root}/${rel}/shots`, { recursive: true });
    writeFileSync(`${root}/${rel}/meta.json`, "{}");
    return resolve(`${root}/${rel}`);
  };

  it("returns nothing when the root does not exist", () => {
    assert.deepEqual(findSessionDirs(`${scratch}/definitely-missing`), []);
  });

  it("finds sessions across sites and dates, sorted", () => {
    const a = session("example.com/2026-08-26/19-04-47-cold");
    const b = session("example.com/2026-08-27/09-00-00-hot");
    const c = session("iana.org/2026-08-26/19-05-10-cold");
    assert.deepEqual(findSessionDirs(root), [a, b, c].sort());
  });

  it("ignores folders without a meta.json, including partial runs", () => {
    mkdirSync(`${root}/example.com/2026-08-28/broken-run/shots`, { recursive: true });
    const found = findSessionDirs(root);
    assert.ok(!found.some((d) => d.includes("broken-run")), "picked up a run with no meta.json");
  });

  it("does not descend into shots/, which can hold many files", () => {
    writeFileSync(`${root}/example.com/2026-08-26/19-04-47-cold/shots/meta.json`, "{}");
    const found = findSessionDirs(root);
    assert.ok(!found.some((d) => d.endsWith("/shots")), "walked into a shots directory");
  });

  it("is depth-agnostic, so sites can be reorganised", () => {
    const nested = session("archive/2025/old-site.com/2025-01-01/12-00-00-warm");
    assert.ok(findSessionDirs(root).includes(nested));
  });
});

describe("dirLabel", () => {
  it("shows site/date/run rather than just the leaf", () => {
    assert.equal(
      dirLabel("/Users/x/proj/runs/example.com/2026-08-26/19-04-47-cold"),
      "example.com/2026-08-26/19-04-47-cold",
    );
  });

  it("falls back to the leaf when there is no runs/ segment", () => {
    assert.equal(dirLabel("/tmp/somewhere/else"), "else");
  });
});
