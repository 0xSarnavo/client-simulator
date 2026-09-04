import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pruneSnapshot, splitByViewport, type Visibility } from "./prune.js";

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

describe("splitByViewport", () => {
  const vis = (o: Record<string, Partial<Visibility>>): Record<string, Visibility> =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [
        k,
        { hidden: false, belowFold: false, onScreen: true, ...v },
      ]),
    );

  const PAGE = [
    `- generic [ref=e1]:`,
    `  - banner [ref=e2]:`,
    `    - link "Home" [ref=e3]`,
    `  - main [ref=e4]:`,
    `    - heading "Turn sites into data" [ref=e5]`,
    `    - button "Start for free" [ref=e6]`,
    `  - contentinfo [ref=e7]:`,
    `    - heading "Pricing" [ref=e8]`,
    `    - link "Careers" [ref=e9]`,
  ].join("\n");

  const V = vis({
    e1: {}, e2: {}, e3: {}, e4: {}, e5: {}, e6: {},
    e7: { onScreen: false, belowFold: true },
    e8: { onScreen: false, belowFold: true },
    e9: { onScreen: false, belowFold: true },
  });

  it("keeps only what is on screen", () => {
    const { visible } = splitByViewport(PAGE, V);
    assert.ok(visible.includes(`button "Start for free" [ref=e6]`));
    assert.ok(!visible.includes("e9"), "a below-fold footer link stayed clickable");
    assert.ok(!visible.includes("Careers"));
  });

  it("keeps ancestors so the indentation still parses", () => {
    const { visible } = splitByViewport(PAGE, V);
    // e6 is nested under e4 under e1 — dropping either would orphan it
    assert.ok(visible.includes("[ref=e1]"), "lost the root");
    assert.ok(visible.includes("[ref=e4]"), "lost the parent of a visible node");
    for (const line of visible.split("\n")) assert.ok(line.length > 0);
  });

  it("offers what is below as an outline, without refs to click", () => {
    const { below } = splitByViewport(PAGE, V);
    assert.ok(below.some((l) => l.includes("Pricing")), "no signpost to the rest of the page");
    assert.ok(!below.join("\n").includes("[ref="), "outline handed out clickable refs");
  });

  it("drops transparent and zero-size nodes outright", () => {
    const withGhost = `${PAGE}\n  - button "Ghost" [ref=e10]`;
    const { visible, dropped } = splitByViewport(withGhost, { ...V, ...vis({ e10: { hidden: true } }) });
    assert.ok(!visible.includes("Ghost"), "an invisible button stayed targetable");
    assert.equal(dropped.hidden, 1);
  });

  it("fills the outline with headings before anything else", () => {
    // a dense widget right under the fold used to take all 15 slots, so a
    // heading further down the page was never mentioned at all
    const widget = Array.from({ length: 20 }, (_, i) => `    - button "Tab ${i}" [ref=e1${i}0]`);
    const noisy = [PAGE, ...widget, `    - heading "Frequently asked questions" [ref=e999]`].join("\n");
    const v = {
      ...V,
      ...vis(
        Object.fromEntries([
          ...Array.from({ length: 20 }, (_, i) => [`e1${i}0`, { onScreen: false, belowFold: true }]),
          ["e999", { onScreen: false, belowFold: true }],
        ]),
      ),
    };
    const { below } = splitByViewport(noisy, v);
    const faq = below.findIndex((l) => l.includes("Frequently asked questions"));
    const firstTab = below.findIndex((l) => l.includes("Tab "));
    assert.ok(faq !== -1, "a heading below a dense widget never made the outline");
    assert.ok(firstTab === -1 || faq < firstTab, "headings did not come first");
  });

  it("handles refs inside an iframe, which signup forms routinely are", () => {
    // firecrawl.dev's signup is framed: its refs are f5e27, not e27. A pattern
    // matching only eN left every control in the form unmeasured, so it was
    // dropped from the prompt entirely on a page that also had plain refs
    const framed = [
      `- generic [ref=e1]:`,
      `  - main [ref=e2]:`,
      `    - iframe [ref=e3]:`,
      `      - textbox "Email" [ref=f5e27]`,
      `      - button "Sign up" [ref=f5e79]`,
      `      - link "Terms" [ref=f5e150]`,
    ].join("\n");
    const v = vis({
      e1: {}, e2: {}, e3: {},
      f5e27: {}, f5e79: {},
      f5e150: { onScreen: false, belowFold: true },
    });
    const { visible, below } = splitByViewport(framed, v);
    assert.ok(visible.includes("[ref=f5e27]"), "the framed email field vanished");
    assert.ok(visible.includes("[ref=f5e79]"), "the framed signup button vanished");
    assert.ok(!visible.includes("f5e150"), "a below-fold framed ref stayed clickable");
    assert.ok(below.some((l) => l.includes("Terms")), "framed below-fold ref missed the outline");
    assert.ok(!below.join("").includes("[ref="), "outline leaked a framed ref");
  });

  it("changes nothing when visibility was never measured", () => {
    const { visible, below } = splitByViewport(PAGE, {});
    assert.equal(visible, PAGE);
    assert.deepEqual(below, []);
  });

  it("survives empty and malformed input", () => {
    for (const junk of ["", "\n\n", "not a snapshot"]) {
      assert.doesNotThrow(() => splitByViewport(junk, V));
    }
  });
});
