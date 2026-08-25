import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { chooseRecording } from "./driver.js";

describe("chooseRecording", () => {
  it("returns null when nothing was recorded", () => {
    assert.equal(chooseRecording([]), null);
  });

  it("returns the only clip when there is one", () => {
    assert.equal(chooseRecording([{ file: "a.webm", size: 1000 }])?.file, "a.webm");
  });

  it("keeps the main journey over a short popup recording", () => {
    // the real case: a popup and an off-screen email render each get their own file
    const clips = [
      { file: "popup.webm", size: 274_555 },
      { file: "journey.webm", size: 5_070_382 },
      { file: "email-render.webm", size: 8_120 },
    ];
    assert.equal(chooseRecording(clips)?.file, "journey.webm");
  });

  it("does not depend on the order the files were listed in", () => {
    const clips = [
      { file: "journey.webm", size: 900 },
      { file: "popup.webm", size: 100 },
    ];
    assert.equal(chooseRecording(clips)?.file, "journey.webm");
    assert.equal(chooseRecording([...clips].reverse())?.file, "journey.webm");
  });

  it("still picks something when every clip is empty", () => {
    const picked = chooseRecording([
      { file: "a.webm", size: 0 },
      { file: "b.webm", size: 0 },
    ]);
    assert.ok(picked, "a failed run should still keep a file rather than none");
  });
});
