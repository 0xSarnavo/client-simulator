import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { PERSONAS } from "./presets.js";

// load.ts resolves personas/ once at import time, so the scratch dir has to be
// in place and current *before* the module is pulled in
const scratch = mkdtempSync(join(tmpdir(), "clientsim-personas-"));
const cwd = process.cwd();
mkdirSync(join(scratch, "personas"), { recursive: true });
process.chdir(scratch);
const { getPersonaRegistry } = await import("./load.js");

const write = (name: string, body: string) =>
  writeFileSync(join(scratch, "personas", name), body);

after(() => {
  process.chdir(cwd);
  rmSync(scratch, { recursive: true, force: true });
});

describe("getPersonaRegistry", () => {
  it("always includes the built-in presets", () => {
    const { personas } = getPersonaRegistry();
    for (const id of Object.keys(PERSONAS)) assert.ok(personas[id], `missing preset ${id}`);
  });

  it("loads a valid file and takes its id from the filename", () => {
    write("budget-bianca.yaml", 'name: "Budget Bianca"\ntemperature: warm\ngoal: "Find a cheap tool"\n');
    const { personas, errors } = getPersonaRegistry();
    assert.equal(personas["budget-bianca"]?.name, "Budget Bianca");
    assert.deepEqual(errors, []);
  });

  it("fills defaults for everything except name/temperature/goal", () => {
    const p = getPersonaRegistry().personas["budget-bianca"];
    assert.equal(p.tech_comfort, "medium");
    assert.equal(p.patience_steps, 12);
    assert.equal(p.otp_patience_seconds, 180);
    assert.deepEqual(p.traits, []);
  });

  it("reports an invalid file instead of throwing, and still loads the rest", () => {
    write("broken.yaml", 'name: "No temperature"\ngoal: "x"\n');
    const { personas, errors } = getPersonaRegistry();
    assert.ok(!personas["broken"], "loaded an invalid persona");
    assert.ok(errors.some((e) => e.file === "broken.yaml"), "did not report the invalid file");
    assert.ok(personas["budget-bianca"], "one bad file took a good one down with it");
    assert.ok(personas["cold"], "one bad file took the presets down with it");
  });

  it("does not throw on unparseable YAML", () => {
    write("garbage.yaml", "name: [unclosed\n\tbad: indent:\n");
    assert.doesNotThrow(() => getPersonaRegistry());
    assert.ok(getPersonaRegistry().personas["cold"]);
  });

  it("rejects out-of-range numbers rather than running a 500-step persona", () => {
    write("greedy.yaml", 'name: "Greedy"\ntemperature: hot\ngoal: "x"\npatience_steps: 500\n');
    const { personas, errors } = getPersonaRegistry();
    assert.ok(!personas["greedy"], "accepted a persona above the step cap");
    assert.ok(errors.some((e) => e.file === "greedy.yaml"));
  });

  it("lets a custom file override a built-in id", () => {
    write("cold.yaml", 'name: "My Cold"\ntemperature: cold\ngoal: "x"\n');
    assert.equal(getPersonaRegistry().personas["cold"].name, "My Cold");
  });

  it("ignores non-YAML files in the directory", () => {
    write("notes.txt", "not a persona");
    write("README.md", "# personas");
    assert.deepEqual(
      getPersonaRegistry().errors.filter((e) => /notes|README/.test(e.file)),
      [],
    );
  });
});
