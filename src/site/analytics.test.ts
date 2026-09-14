import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AnalyticsSchema, renderAnalytics } from "./analytics.js";

describe("analytics", () => {
  it("renders the owner's five lines as plain sentences", () => {
    const a = AnalyticsSchema.parse({
      exitPages: [{ path: "/pricing", share: 0.38 }, { path: "/", share: 0.31 }],
      devices: { mobile: 0.55, desktop: 0.45 },
      entry: ["google organic", "product hunt"],
      note: "Most signups come from the docs.",
    });
    const out = renderAnalytics(a);
    assert.match(out, /Where real visitors leave: \/pricing \(38%\), \/ \(31%\)\./);
    assert.match(out, /Devices: mobile 55%, desktop 45%\./);
    assert.match(out, /arrive from: google organic, product hunt\./);
    assert.match(out, /Most signups come from the docs\./);
  });

  it("rejects shares outside 0-1 and accepts a partial file", () => {
    assert.ok(!AnalyticsSchema.safeParse({ exitPages: [{ path: "/x", share: 38 }] }).success);
    assert.equal(renderAnalytics(AnalyticsSchema.parse({ entry: ["twitter"] })), "They arrive from: twitter.");
  });
});
