import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  broken,
  classify,
  guardedSurfaces,
  normalize,
  parseSitemap,
  renderMap,
  sameSite,
  unreached,
  type SiteMap,
} from "./map.js";

describe("classify", () => {
  it("tags booking and payment surfaces before anything else", () => {
    assert.equal(classify("https://cal.com/team/amulet/demo"), "booking");
    assert.equal(classify("https://example.com/book-a-demo"), "booking");
    assert.equal(classify("https://example.com/book-demo"), "booking");
    assert.equal(classify("https://example.com/demo"), "booking");
    assert.equal(classify("https://app.example.com/billing"), "payment");
    assert.equal(classify("https://checkout.stripe.com/c/pay/cs_test"), "payment");
  });

  it("tags auth, app, pricing, legal, docs, blog by host or path", () => {
    assert.equal(classify("https://app.example.com/auth?intent=signin"), "auth");
    assert.equal(classify("https://console.example.com/"), "app");
    assert.equal(classify("https://example.com/pricing"), "pricing");
    assert.equal(classify("https://example.com/security"), "legal");
    assert.equal(classify("https://docs.example.com/introduction"), "docs");
    assert.equal(classify("https://example.com/docs/overview/billing"), "docs", "a billing help article is not a checkout");
    assert.equal(classify("https://docs.example.com/login"), "docs");
    assert.equal(classify("https://example.com/blog/launch"), "blog");
  });

  it("falls back to marketing, and does not match inside words", () => {
    assert.equal(classify("https://example.com/"), "marketing");
    assert.equal(classify("https://example.com/features"), "marketing");
    assert.equal(classify("https://example.com/paywall-explained"), "marketing");
    assert.equal(classify("https://example.com/blog/checkout-ux-tips"), "blog", "unanchored checkout made a blog post a payment surface");
  });
});

describe("sameSite", () => {
  it("accepts subdomains and rejects other domains and schemes", () => {
    assert.equal(sameSite("https://example.com", "https://app.example.com/x"), true);
    assert.equal(sameSite("https://www.example.com", "https://docs.example.com"), true);
    assert.equal(sameSite("https://example.com", "https://example.co/x"), false);
    assert.equal(sameSite("https://acme.co.uk", "https://bbc.co.uk/news"), false, "last-two-labels made every .co.uk one site");
    assert.equal(sameSite("https://acme.co.uk", "https://docs.acme.co.uk"), true);
    assert.equal(sameSite("https://example.com", "mailto:hi@example.com"), false);
    assert.equal(sameSite("https://example.com", "javascript:void(0)"), false);
  });
});

describe("normalize", () => {
  it("drops hash and trailing slash, keeps query", () => {
    assert.equal(normalize("https://Example.com/pricing/#top"), "https://example.com/pricing");
    assert.equal(normalize("https://www.example.com/a"), "https://www.example.com/a", "www is kept: it is the URL that gets fetched");
    assert.equal(normalize("https://example.com/"), "https://example.com/");
    assert.equal(normalize("https://example.com/a?b=1#x"), "https://example.com/a?b=1");
  });
});

describe("parseSitemap", () => {
  it("reads loc entries from a sitemap and an index", () => {
    const xml = `<urlset><url><loc>https://e.com/a</loc></url><url><loc> https://e.com/b </loc></url></urlset>`;
    assert.deepEqual(parseSitemap(xml), ["https://e.com/a", "https://e.com/b"]);
  });
});

const map: SiteMap = {
  url: "https://example.com",
  generated: "2026-09-14T00:00:00Z",
  pages: [
    { url: "https://example.com/", kind: "marketing", title: "Home", depth: 0, external: false },
    { url: "https://example.com/pricing", kind: "pricing", title: "Pricing", depth: 1, external: false },
    { url: "https://example.com/security", kind: "legal", title: "", depth: -1, external: false },
    { url: "https://app.example.com/checkout", kind: "payment", title: "", depth: 2, external: false },
    { url: "https://cal.com/example/demo", kind: "booking", title: "", depth: 1, external: true },
    { url: "https://docs.example.com/old", kind: "docs", title: "404: This page could not be found.", depth: 2, external: false },
    { url: "https://docs.example.com/slow", kind: "docs", title: "(slow to render, HTTP 200)", depth: 2, external: false },
    { url: "https://docs.example.com/gone", kind: "docs", title: "HTTP 410", depth: 2, external: false },
    { url: "https://docs.example.com/dead", kind: "docs", title: "(unreachable)", depth: 2, external: false },
  ],
};

describe("broken", () => {
  it("lists 404s, 4xx/5xx and unreachable pages; a slow page is not broken", () => {
    assert.deepEqual(broken(map).map((p) => p.url), [
      "https://docs.example.com/old",
      "https://docs.example.com/gone",
      "https://docs.example.com/dead",
    ]);
  });
});

describe("unreached", () => {
  it("compares by host and path, ignoring query and trailing slash", () => {
    const left = unreached(map, ["https://www.example.com/pricing?ref=nav", "https://example.com/"]);
    assert.deepEqual(
      left.map((p) => p.url),
      ["https://example.com/security", "https://app.example.com/checkout", "https://docs.example.com/old", "https://docs.example.com/slow", "https://docs.example.com/gone", "https://docs.example.com/dead"],
    );
  });

  it("never lists off-site surfaces as unreached pages", () => {
    assert.ok(!unreached(map, []).some((p) => p.external));
  });
});

describe("guardedSurfaces", () => {
  it("lists booking and payment pages with whether a session got there", () => {
    const g = guardedSurfaces(map, ["https://app.example.com/checkout?plan=pro"]);
    assert.deepEqual(
      g.map((x) => [x.page.kind, x.reached]),
      [["payment", true], ["booking", false]],
    );
  });
});

describe("renderMap", () => {
  it("renders counts, guarded surfaces and the page table", () => {
    const md = renderMap(map);
    assert.match(md, /\| marketing \| 1 \|/);
    assert.match(md, /booking: https:\/\/cal\.com\/example\/demo \(off-site\)/);
    assert.match(md, /\| https:\/\/example\.com\/security \| legal \| sitemap \|/);
  });
});
