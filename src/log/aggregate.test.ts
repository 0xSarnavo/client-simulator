import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { generateAggregate, loadSessions } from "./aggregate.js";

const scratch = mkdtempSync(join(tmpdir(), "clientsim-agg-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** Write a session directory the way stage 1 does. */
function session(opts: {
  personaId: string;
  exit: Record<string, unknown>;
  steps?: { url: string; confusion: number; thought: string }[];
  url?: string;
}): string {
  const dir = join(scratch, `s${n++}-${opts.personaId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ url: opts.url ?? "https://site.com", personaId: opts.personaId, brain: "claude", exit: opts.exit }),
  );
  const steps = opts.steps ?? [{ url: "https://site.com/", confusion: 3, thought: "ok" }];
  writeFileSync(
    join(dir, "session.jsonl"),
    steps
      .map((s, i) =>
        JSON.stringify({
          n: i + 1,
          url: s.url,
          timestamp: "",
          decision: { thought: s.thought, emotion: "x", confusion: s.confusion, action: { type: "click", target: "e1" } },
        }),
      )
      .join("\n"),
  );
  return dir;
}

describe("loadSessions", () => {
  it("skips directories missing either artifact rather than throwing", () => {
    const partial = join(scratch, "partial");
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, "meta.json"), "{}");
    assert.deepEqual(loadSessions([partial]), []);
  });

  it("skips a corrupt meta.json without taking the run down", () => {
    const bad = join(scratch, "corrupt");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "meta.json"), "{not json");
    writeFileSync(join(bad, "session.jsonl"), "");
    const good = session({ personaId: "cold", exit: { kind: "completed", summary: "done" } });
    const loaded = loadSessions([bad, good]);
    assert.equal(loaded.length, 1, "one corrupt session discarded a valid one");
  });

  it("skips shape-valid meta without an exit instead of crashing later", () => {
    const hostile = join(scratch, "no-exit");
    mkdirSync(hostile, { recursive: true });
    writeFileSync(join(hostile, "meta.json"), JSON.stringify({ url: "https://x.com", personaId: "cold", brain: "claude" }));
    writeFileSync(join(hostile, "session.jsonl"), JSON.stringify({ n: 1, url: "u", timestamp: "", decision: { thought: "t", emotion: "e", confusion: 1, action: { type: "back" } } }));
    assert.doesNotThrow(() => loadSessions([hostile]));
    assert.equal(loadSessions([hostile]).length, 0);
  });

  it("drops malformed event lines but keeps the session's valid steps", () => {
    const dir = join(scratch, "mixed-events");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ url: "https://x.com", personaId: "cold", brain: "claude", exit: { kind: "completed", summary: "s" } }),
    );
    writeFileSync(
      join(dir, "session.jsonl"),
      [
        JSON.stringify({ n: 1, url: "u", timestamp: "", decision: { thought: "t", emotion: "e", confusion: 2, action: { type: "back" } } }),
        JSON.stringify({ n: 2, url: "u", timestamp: "" }), // no decision — used to crash stage 2
        "not json at all",
      ].join("\n"),
    );
    const loaded = loadSessions([dir]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].events.length, 1);
  });
});

describe("generateAggregate", () => {
  it("says so plainly when there is nothing to report", () => {
    assert.match(generateAggregate([]), /No valid sessions/);
  });

  it("counts each verdict kind", () => {
    const dirs = [
      session({ personaId: "cold", exit: { kind: "completed", summary: "signed up" } }),
      session({ personaId: "cold", exit: { kind: "abandoned", reason: "too slow", question: "why?" } }),
      session({ personaId: "hot", exit: { kind: "abandoned", reason: "no pricing", question: "cost?" } }),
      session({ personaId: "hot", exit: { kind: "guardrail", detail: "stuck" } }),
    ];
    const out = generateAggregate(dirs);
    assert.match(out, /Completed \| 1/);
    assert.match(out, /Abandoned \| 2/);
    assert.match(out, /Guardrail \| 1/);
    assert.match(out, /\*\*Sessions:\*\* 4/);
  });

  it("quotes why people left, verbatim", () => {
    const out = generateAggregate([
      session({ personaId: "cold", exit: { kind: "abandoned", reason: "pricing was hidden", question: "cost?" } }),
    ]);
    assert.match(out, /Why They Left/);
    assert.match(out, /pricing was hidden/);
  });

  it("groups drop-offs by page so the common wall is obvious", () => {
    const at = (url: string) => session({
      personaId: "cold",
      exit: { kind: "abandoned", reason: "r", question: "q" },
      steps: [{ url, confusion: 8, thought: "t" }],
    });
    const out = generateAggregate([at("https://site.com/pricing"), at("https://site.com/pricing"), at("https://site.com/signup")]);
    assert.match(out, /Most Common Drop Points/);
    assert.match(out, /\/pricing` — 2 persona/);
  });

  it("does not report drop points for sessions that completed", () => {
    const out = generateAggregate([
      session({ personaId: "hot", exit: { kind: "completed", summary: "done" } }),
    ]);
    assert.ok(!out.includes("Most Common Drop Points"));
    assert.ok(!out.includes("Why They Left"));
  });

  it("escapes pipes so a quote cannot break the markdown table", () => {
    const out = generateAggregate([
      session({ personaId: "cold", exit: { kind: "abandoned", reason: "a | b | c", question: "q" } }),
    ]);
    assert.ok(!/\| a \| b \| c \|/.test(out), "an unescaped pipe split the row into extra columns");
  });
});
