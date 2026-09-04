import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// RUNS_ROOT resolves from cwd, so run each test inside a scratch dir
const origCwd = process.cwd();
let tmp: string;

describe("flow round-trip", () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "clientsim-flow-"));
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes FLOW.md and reads the same flow back", async () => {
    const { writeFlow, loadFlow } = await import("./flow.js");
    const flow = {
      intent: "signup through to the dashboard",
      checkpoints: ["found the signup CTA", "submitted the form", "saw the dashboard"],
    };
    writeFlow("https://example.com", flow);
    assert.deepEqual(loadFlow("https://example.com"), flow);
  });

  it("returns null for a site with no flow", async () => {
    const { loadFlow } = await import("./flow.js");
    assert.equal(loadFlow("https://never-tested.com"), null);
  });

  it("newlines in intent and checkpoints cannot break the file format", async () => {
    const { writeFlow, loadFlow } = await import("./flow.js");
    writeFlow("https://example.com", {
      intent: "line one\nline two",
      checkpoints: ["a\nb", "c"],
    });
    const back = loadFlow("https://example.com");
    assert.equal(back?.intent, "line one line two");
    assert.deepEqual(back?.checkpoints, ["a b", "c"]);
  });
});
