import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { controls, smallTargets, unnamedControls } from "./audit.js";

const yaml = `- banner:
  - link "Home" [ref=e1]
  - button [ref=e2]
  - button "" [ref=e3]
  - textbox "Email" [ref=f1e4]
  - button [ref=f1e5]
  - heading "Welcome" [level=1]
  - text: not a control [ref=e6]
  - link "Pricing" [ref=e7]: /pricing`;

describe("controls", () => {
  it("finds interactive roles with their names, framed refs included", () => {
    assert.deepEqual(controls(yaml).map((c) => [c.ref, c.name]), [
      ["e1", "Home"], ["e2", ""], ["e3", ""], ["f1e4", "Email"], ["f1e5", ""], ["e7", "Pricing"],
    ]);
  });
});

describe("unnamedControls", () => {
  it("lists controls with no accessible name — a screen reader says just 'button'", () => {
    assert.deepEqual(unnamedControls(yaml), ["e2", "e3", "f1e5"]);
  });

  it("ignores controls that are in the tree but not rendered", () => {
    assert.deepEqual(unnamedControls(yaml, { e3: { hidden: true } }), ["e2", "f1e5"]);
  });
});

describe("smallTargets", () => {
  it("flags visible buttons and fields under 24px on either side; links, hidden and unmeasured are exempt", () => {
    const sizes = {
      e1: { w: 80, h: 20 },
      e2: { w: 16, h: 16 },
      e3: { w: 16, h: 16, hidden: true },
      f1e4: { w: 300, h: 40 },
      e7: {},
    };
    assert.deepEqual(smallTargets(yaml, sizes), ["e2"]);
  });
});
