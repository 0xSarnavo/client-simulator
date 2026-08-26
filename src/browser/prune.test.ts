import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pruneSnapshot } from "./prune.js";

const fixture = (name: string) =>
  readFileSync(`fixtures/snapshots/${name}.txt`, "utf8");

const refs = (s: string) => (s.match(/\[ref=e\d+\]/g) ?? []).sort();
const FIXTURES = ["tiny-example-com", "form-inputs", "small-iana-org", "heavy-wikipedia", "commercial-signup"];

describe("pruneSnapshot — the safety invariant", () => {
  for (const name of FIXTURES) {
    it(`keeps every ref on ${name}`, () => {
      const src = fixture(name);
      // losing a ref means the persona can no longer click that control
      assert.deepEqual(refs(pruneSnapshot(src)), refs(src));
    });
  }

  it("keeps every line that carries a ref byte-for-byte", () => {
    const src = fixture("heavy-wikipedia");
    const kept = new Set(pruneSnapshot(src).split("\n"));
    for (const line of src.split("\n")) {
      if (/\[ref=e\d+\]/.test(line)) {
        assert.ok(kept.has(line), `a ref line was altered: ${line.slice(0, 80)}`);
      }
    }
  });

  it("keeps a noise line that carries a ref — the guard must be load-bearing", () => {
    // without the REF guard this line is dropped and a control disappears
    const line = '- generic "utm_source=blog&utm_medium=cta" [ref=e9]';
    assert.equal(pruneSnapshot(line), line);
  });

  it("keeps the charge terms at the end of consent copy", () => {
    // presets.ts personas exist to notice hidden pricing; truncating this text
    // deleted exactly that clause, which is why the rule was removed
    const out = pruneSnapshot(fixture("commercial-signup"));
    assert.match(out, /charged \$49 per month/);
    assert.match(out, /14-day free trial/);
  });

  it("keeps prices, validation errors and link targets on a signup page", () => {
    const out = pruneSnapshot(fixture("commercial-signup"));
    assert.match(out, /\$49\/month after trial/);
    assert.match(out, /Invalid email address/);
    assert.match(out, /\/pricing/);
    assert.match(out, /#faq/, "an anchor target is a link's only identity when it has no name");
  });

  it("leaves ordinary pages completely untouched", () => {
    // no risk where there is nothing to gain
    for (const name of ["tiny-example-com", "form-inputs", "small-iana-org"]) {
      assert.equal(pruneSnapshot(fixture(name)), fixture(name), `${name} was modified`);
    }
  });

  it("preserves form labels, values and placeholders", () => {
    const out = pruneSnapshot(fixture("form-inputs"));
    for (const token of ["textbox", "radio", "checkbox", "button"]) {
      const before = (fixture("form-inputs").match(new RegExp(token, "g")) ?? []).length;
      const after = (out.match(new RegExp(token, "g")) ?? []).length;
      assert.equal(after, before, `${token} count changed`);
    }
  });

  it("preserves headings, which are how a visitor judges a page", () => {
    const src = fixture("heavy-wikipedia");
    const headings = (s: string) => (s.match(/heading "/g) ?? []).length;
    assert.equal(headings(pruneSnapshot(src)), headings(src));
  });
});

describe("pruneSnapshot — what it removes", () => {
  it("keeps a generic node a human could actually read", () => {
    // the rule must be precise, not "drop every generic line"
    const out = pruneSnapshot(fixture("commercial-signup"));
    assert.match(out, /Trusted by 12,000 teams/);
    assert.match(out, /no credit card required/);
  });

  it("keeps a UTM-tagged link target — noise patterns are matched only on generic nodes", () => {
    // the docstring claims the rule is scoped to `generic`; without this the
    // scope can be dropped and every k=v&k=v line goes, including real CTAs
    const out = pruneSnapshot(fixture("commercial-signup"));
    assert.match(out, /utm_source=blog/);
    assert.match(out, /\/signup\?/);
  });

  it("drops citation/percent-encoded machine blobs", () => {
    const src = '- generic "ctx_ver=Z39.88-2004&rft_val_fmt=info%3Aofi%2Ffmt"\n- text: real content';
    const out = pruneSnapshot(src);
    assert.ok(!out.includes("ctx_ver"));
    assert.match(out, /real content/);
  });

  it("leaves short text alone — it could be a price, code or error", () => {
    for (const line of ["- text: $19/month", "- text: Your code is 483920", "- text: Invalid email"]) {
      assert.equal(pruneSnapshot(line), line);
    }
  });

  it("is idempotent", () => {
    const once = pruneSnapshot(fixture("heavy-wikipedia"));
    assert.equal(pruneSnapshot(once), once);
  });

  it("handles empty and malformed input", () => {
    for (const junk of ["", "\n\n", "not a snapshot at all"]) {
      assert.doesNotThrow(() => pruneSnapshot(junk));
    }
  });
});

describe("pruneSnapshot — the saving is real where it matters", () => {
  it("meaningfully shrinks the pathological page", () => {
    const src = fixture("heavy-wikipedia");
    const out = pruneSnapshot(src);
    const ratio = out.length / src.length;
    // one rule, machine noise only: ~14% of this page and nothing on others
    assert.ok(ratio < 0.92, `expected a real cut, got ${Math.round(ratio * 100)}%`);
    assert.ok(ratio > 0.75, `cut more than the noise rule can explain (${Math.round(ratio * 100)}%)`);
  });
});
