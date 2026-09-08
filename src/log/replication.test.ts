import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { extractRefs, replicationTable, renderReplication } from "./replication.js";
import type { RefSighting } from "./replication.js";

describe("extractRefs", () => {
  it("finds main-frame and framed refs", () => {
    const refs = extractRefs("the submit button f1e33 and the field e42 are unlabeled");
    assert.deepEqual([...refs].sort(), ["e42", "f1e33"]);
  });

  it("does not match prose that merely contains e+digits shapes", () => {
    const refs = extractRefs("we ran e2e tests on Route66 female e2e");
    assert.equal(refs.size, 0);
  });

  it("dedupes repeat mentions", () => {
    assert.equal(extractRefs("e7 then e7 then e7 again").size, 1);
  });
});

describe("replicationTable", () => {
  const sighting = (o: Partial<RefSighting>): RefSighting => ({
    ref: "e1",
    site: "example.com",
    sessionDir: "runs/example.com/a",
    model: "haiku",
    source: "fixes",
    ...o,
  });

  it("counts distinct models and sessions per (site, ref)", () => {
    const rows = replicationTable([
      sighting({ ref: "f1e33", model: "haiku", sessionDir: "d1" }),
      sighting({ ref: "f1e33", model: "opus", sessionDir: "d2" }),
      sighting({ ref: "f1e33", model: "opus", sessionDir: "d2", source: "trail" }),
      sighting({ ref: "e9", model: "haiku", sessionDir: "d1" }),
    ]);
    assert.equal(rows[0].ref, "f1e33");
    assert.deepEqual(rows[0].models, ["haiku", "opus"]);
    assert.equal(rows[0].sessions, 2);
    assert.equal(rows[1].ref, "e9");
    assert.equal(rows[1].models.length, 1);
  });

  it("keeps the same ref on different sites apart", () => {
    const rows = replicationTable([
      sighting({ site: "a.com", ref: "e5" }),
      sighting({ site: "b.com", ref: "e5", model: "opus" }),
    ]);
    assert.equal(rows.length, 2);
  });

  it("renders single-source vs replicated verdicts", () => {
    const out = renderReplication(
      replicationTable([
        sighting({ ref: "f1e33", model: "haiku", sessionDir: "d1" }),
        sighting({ ref: "f1e33", model: "opus", sessionDir: "d2" }),
        sighting({ ref: "e9" }),
      ]),
    );
    assert.match(out, /`f1e33` \| replicated 2 models/);
    assert.match(out, /`e9` \| single-source/);
  });
});
