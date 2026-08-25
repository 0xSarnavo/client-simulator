import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { extractJson, parseVerdict } from "./cli-brain.js";

describe("extractJson", () => {
  it("returns null when there is no object", () => {
    assert.equal(extractJson(""), null);
    assert.equal(extractJson("I decided to click the button."), null);
  });

  it("pulls the object out of surrounding prose", () => {
    const out = extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.');
    assert.equal(out, '{"a":1}');
  });

  it("survives a fenced code block", () => {
    assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("keeps nested objects whole", () => {
    const src = '{"thought":"hi","action":{"type":"click","target":"e1"}}';
    assert.equal(extractJson(`noise ${src} noise`), src);
  });

  it("does not stop at a brace inside a string", () => {
    const src = '{"thought":"the page said {loading} to me","confusion":4}';
    assert.equal(extractJson(src), src);
  });

  it("does not stop at an escaped quote", () => {
    const src = '{"thought":"they call it \\"free\\" but it is not","confusion":7}';
    assert.equal(extractJson(src), src);
    assert.equal(JSON.parse(extractJson(src)!).confusion, 7);
  });

  it("returns null for an unterminated object rather than a truncated one", () => {
    assert.equal(extractJson('{"thought":"cut off mid'), null);
  });

  it("takes the first complete object when several are present", () => {
    assert.equal(extractJson('{"a":1} then {"b":2}'), '{"a":1}');
  });
});

describe("parseVerdict", () => {
  it("accepts a well-formed verdict", () => {
    assert.deepEqual(parseVerdict('{"achieved":true,"note":"dashboard visible"}'), {
      achieved: true,
      note: "dashboard visible",
    });
  });

  it("reads a verdict wrapped in prose", () => {
    const v = parseVerdict('Checking... {"achieved":false,"note":"still on the form"} done');
    assert.equal(v?.achieved, false);
  });

  it("rejects a verdict missing its fields rather than guessing", () => {
    assert.equal(parseVerdict('{"achieved":true}'), null);
    assert.equal(parseVerdict('{"note":"no verdict here"}'), null);
  });

  it("rejects the wrong types instead of coercing them", () => {
    assert.equal(parseVerdict('{"achieved":"yes","note":"x"}'), null);
  });

  it("returns null when there is no JSON at all", () => {
    assert.equal(parseVerdict("I think it worked?"), null);
  });
});
