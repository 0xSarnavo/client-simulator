import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { stuckPattern } from "./session.js";
import type { StepEvent } from "./types.js";

/** Build a step trail from shorthand: "click:e1", "scroll:down", ... */
function trail(...actions: string[]): StepEvent[] {
  return actions.map((spec, i) => {
    const [type, arg = ""] = spec.split(":");
    const action =
      type === "scroll"
        ? { type: "scroll", direction: arg || "down" }
        : { type, target: arg };
    return {
      n: i + 1,
      url: "https://example.com",
      timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      decision: { thought: "", emotion: "", confusion: 3, action },
    } as StepEvent;
  });
}

describe("stuckPattern", () => {
  it("does not fire before there is enough evidence", () => {
    assert.equal(stuckPattern(trail()), null);
    assert.equal(stuckPattern(trail("click:e1")), null);
    assert.equal(stuckPattern(trail("click:e1", "click:e1")), null);
  });

  it("catches the same action three times", () => {
    assert.match(String(stuckPattern(trail("click:e1", "click:e1", "click:e1"))), /same action/);
  });

  it("catches an A-B ping-pong, which the old check missed", () => {
    const t = trail("click:e1", "back", "click:e1", "back", "click:e1", "back");
    assert.match(String(stuckPattern(t)), /2-step loop/);
  });

  it("needs three rounds of a two-step loop, not two", () => {
    assert.equal(stuckPattern(trail("click:e1", "back", "click:e1", "back")), null);
  });

  it("catches a three-step cycle", () => {
    const t = trail("click:e1", "click:e2", "back", "click:e1", "click:e2", "back");
    assert.match(String(stuckPattern(t)), /3-step loop/);
  });

  it("leaves ordinary exploration alone", () => {
    assert.equal(
      stuckPattern(trail("click:e1", "click:e2", "scroll:down", "click:e3", "back", "click:e4")),
      null,
    );
  });

  it("leaves a scroll-and-read rhythm alone when it is still progressing", () => {
    // alternating but only two rounds, then a different action — not a loop
    assert.equal(
      stuckPattern(trail("scroll:down", "wait", "scroll:down", "wait", "click:e9")),
      null,
    );
  });

  it("treats the same action on different targets as different", () => {
    assert.equal(stuckPattern(trail("click:e1", "click:e2", "click:e3")), null);
  });

  it("only judges the most recent steps, so an early loop does not stick", () => {
    const t = trail(
      "click:e1", "click:e1", "click:e1", // looped early…
      "click:e2", "scroll:down", "click:e3", "back", // …then recovered
    );
    assert.equal(stuckPattern(t), null);
  });
});
