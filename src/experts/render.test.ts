import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { renderScorecard } from "./scores.js";
import { renderRecommendations } from "./ux.js";
import { parseJsonObject } from "./copywriter.js";

const dim = (score: number) => ({ score, note: "because" });
const card = (score: number) => ({
  message_clarity: dim(score),
  audience_fit: dim(score),
  action_path: dim(score),
  trust: dim(score),
  content_depth: dim(score),
});

describe("renderScorecard", () => {
  it("renders a normal scorecard", () => {
    const out = renderScorecard(card(7));
    assert.match(out, /7\/10/);
    assert.match(out, /Overall: 7\.0\/10/);
  });

  it("survives a score above the range it asked for", () => {
    // 10 - round(12) is negative; repeat() throws RangeError and the caller's
    // catch would silently drop the whole scorecard
    assert.doesNotThrow(() => renderScorecard(card(12)));
    assert.match(renderScorecard(card(12)), /10\/10/);
  });

  it("survives a negative score", () => {
    assert.doesNotThrow(() => renderScorecard(card(-3)));
    assert.match(renderScorecard(card(-3)), /0\/10/);
  });

  it("handles fractional scores without breaking the bar", () => {
    assert.doesNotThrow(() => renderScorecard(card(6.4)));
  });
});

describe("renderRecommendations", () => {
  const good = { priority: "high", problem: "Pricing hidden", evidence: "step 3", fix: "Show pricing", copy_rewrite: "" };

  it("renders and orders by priority", () => {
    const out = renderRecommendations([
      { ...good, priority: "low", problem: "Minor" },
      { ...good, priority: "high", problem: "Major" },
    ]);
    assert.ok(out.indexOf("Major") < out.indexOf("Minor"), "high priority should come first");
  });

  it("does not lose every recommendation because one lacks a priority", () => {
    const out = renderRecommendations([{ problem: "No priority given", fix: "Still useful" }, good]);
    assert.match(out, /No priority given/);
    assert.match(out, /Pricing hidden/, "the valid recommendation was discarded too");
  });

  it("defaults a missing priority rather than throwing", () => {
    assert.doesNotThrow(() => renderRecommendations([{ problem: "x", fix: "y" }]));
    assert.match(renderRecommendations([{ problem: "x", fix: "y" }]), /\[MEDIUM\]/);
  });

  it("drops entries that say nothing at all", () => {
    const out = renderRecommendations([{}, { priority: "high" }, good]);
    assert.match(out, /Pricing hidden/);
    assert.ok(!out.includes("unspecified"), "kept an empty recommendation");
  });
});

describe("parseJsonObject", () => {
  it("reads an object out of surrounding prose", () => {
    assert.deepEqual(parseJsonObject('Here:\n{"a":1}\ndone'), { a: 1 });
  });

  it("returns null rather than throwing on malformed input", () => {
    assert.equal(parseJsonObject("no json here"), null);
    assert.equal(parseJsonObject('{"a": '), null);
  });

  it("is not confused by braces inside strings", () => {
    assert.deepEqual(parseJsonObject('{"note":"a { brace } inside","b":2}'), {
      note: "a { brace } inside",
      b: 2,
    });
  });
});
