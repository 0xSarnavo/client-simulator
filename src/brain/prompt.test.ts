import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildPrompt, buildRepairPrompt, buildVerificationPrompt } from "./prompt.js";
import { PERSONAS } from "../persona/presets.js";
import type { BrainContext, StepEvent } from "../types.js";

const step = (n: number, thought: string): StepEvent => ({
  n,
  url: `https://site.com/p${n}`,
  timestamp: new Date(2026, 0, 1, 0, 0, n).toISOString(),
  decision: { thought, emotion: "unsure", confusion: 4, action: { type: "click", target: `e${n}` } },
});

const ctx = (over: Partial<BrainContext> = {}): BrainContext => ({
  persona: PERSONAS.cold,
  ariaYaml: '- button "Sign up" [ref=e1]',
  screenshotPath: "/tmp/shot.png",
  url: "https://site.com",
  stepNumber: 1,
  history: [],
  ...over,
});

describe("buildPrompt", () => {
  it("carries the things the persona decides from", () => {
    const p = buildPrompt(ctx());
    assert.match(p, /Skeptical Sam/);
    assert.match(p, /ref=e1/, "the page snapshot must reach the model verbatim");
    assert.match(p, /https:\/\/site\.com/);
    assert.ok(p.includes(PERSONAS.cold.goal), "the goal was dropped");
  });

  it("always states the safety rules", () => {
    const p = buildPrompt(ctx());
    assert.match(p, /NEVER/);
    assert.match(p, /OAuth|SSO/);
  });

  it("says it is a first impression when there is no history", () => {
    assert.match(buildPrompt(ctx()), /first impression/i);
  });

  it("renders recent steps in detail and older ones as a summary", () => {
    const history = Array.from({ length: 8 }, (_, i) => step(i + 1, `thought ${i + 1}`));
    const p = buildPrompt(ctx({ history, stepNumber: 9 }));
    const [earlier, recent] = p.split("Recent steps (detail)");
    assert.match(earlier, /Earlier steps \(summary\)/);
    assert.ok(recent, "recent block missing");
    // the newest steps carry emotion and confusion; the summarised ones do not
    assert.match(recent, /thought 8/);
    assert.match(recent, /felt: unsure \(confusion 4\/10\)/);
    assert.match(earlier, /thought 1/, "older steps should still be mentioned");
    assert.ok(!earlier.includes("felt:"), "older steps were rendered in full detail");
  });

  it("only mentions email when a mailbox exists", () => {
    assert.ok(!/YOUR EMAIL ADDRESS/.test(buildPrompt(ctx())));
    const withMail = buildPrompt(ctx({ emailAddress: "cold.a1@x.com" }));
    assert.match(withMail, /cold\.a1@x\.com/);
    assert.match(withMail, /NEVER invent an email address/);
  });

  it("surfaces a failed action so the persona changes approach", () => {
    assert.match(buildPrompt(ctx({ failedHint: "click e5 — timeout" })), /LAST ACTION FAILED/);
  });

  it("lists every action the harness can execute", () => {
    const p = buildPrompt(ctx());
    for (const a of ["click", "type", "select", "scroll", "back", "wait", "check_email", "complete", "abandon"]) {
      assert.match(p, new RegExp(`"${a}"`), `action ${a} is not offered to the model`);
    }
  });
});

describe("buildRepairPrompt", () => {
  it("echoes the bad reply and stays small", () => {
    const bad = '{"thought": "hmm", action:';
    const p = buildRepairPrompt(bad, "JSON parse error");
    assert.ok(p.includes(bad), "the model cannot fix what it cannot see");
    assert.match(p, /JSON parse error/);
    // the point of the repair path is that it does not resend the page
    assert.ok(p.length < buildPrompt(ctx()).length, "repair prompt is not smaller than a full step");
    assert.ok(!p.includes("ref=e1"), "repair prompt should not carry the page snapshot");
  });

  it("caps a runaway reply", () => {
    assert.ok(buildRepairPrompt("x".repeat(50_000), "too long").length < 10_000);
  });
});

describe("buildVerificationPrompt", () => {
  it("asks strictly, against the current page", () => {
    const p = buildVerificationPrompt({ goal: "sign up", ariaYaml: '- text "Welcome"' });
    assert.match(p, /sign up/);
    assert.match(p, /Welcome/);
    assert.match(p, /"achieved"/);
    assert.match(p, /strict/i);
  });
});
