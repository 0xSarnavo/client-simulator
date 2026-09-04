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
const { getPersonaRegistry, siteOwnPersonas } = await import("./load.js");

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

describe("siteOwnPersonas", () => {
  const URL = "https://acme.example";
  const SITE_DIR = join(scratch, "runs", "acme.example", "personas");

  const PERSONA = (name: string) =>
    `name: "${name}"\ntemperature: warm\ngoal: "buy the thing"\n`;

  it("returns only the set built for that site", () => {
    // a machine-local global persona must not count as this site's work
    write("global-only.yaml", PERSONA("Global Gwen"));
    mkdirSync(SITE_DIR, { recursive: true });
    writeFileSync(join(SITE_DIR, "site-built.yaml"), PERSONA("Site Sam"));

    const own = siteOwnPersonas(URL);
    assert.deepEqual(Object.keys(own), ["site-built"]);
    assert.ok(!("global-only" in own), "a global persona counted as this site's");
    assert.ok(!("cold" in own), "a built-in preset counted as this site's");
  });

  it("is empty for a site that has never been generated for", () => {
    // this is what decides whether generation runs at all — if a global
    // directory made it non-empty, a new site would never get its own set
    assert.deepEqual(siteOwnPersonas("https://never-seen.example"), {});
  });

  it("still exposes global personas through the full registry", () => {
    // scoping siteOwnPersonas must not make hand-written personas unusable
    assert.ok("global-only" in getPersonaRegistry(URL).personas);
  });
});
