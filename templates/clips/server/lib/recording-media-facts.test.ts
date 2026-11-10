import { describe, expect, it } from "vitest";

import { fillMediaFacts, isMissingMediaFacts } from "./recording-media-facts";

const probed = { durationMs: 4200, width: 1280, height: 720, hasAudio: false };

describe("isMissingMediaFacts", () => {
  it("is true when any fact is zero", () => {
    expect(
      isMissingMediaFacts({ durationMs: 0, width: 1280, height: 720 }),
    ).toBe(true);
    expect(
      isMissingMediaFacts({ durationMs: 4200, width: 0, height: 720 }),
    ).toBe(true);
    expect(
      isMissingMediaFacts({ durationMs: 4200, width: 1280, height: 0 }),
    ).toBe(true);
  });

  it("is false when the upload gave every fact", () => {
    expect(
      isMissingMediaFacts({ durationMs: 4200, width: 1280, height: 720 }),
    ).toBe(false);
  });
});

describe("fillMediaFacts", () => {
  it("fills what the upload left out from the file", () => {
    expect(
      fillMediaFacts({ durationMs: 0, width: 0, height: 0 }, probed),
    ).toEqual({ durationMs: 4200, width: 1280, height: 720 });
  });

  it("keeps a number the upload gave over the file's", () => {
    expect(
      fillMediaFacts({ durationMs: 9000, width: 0, height: 0 }, probed),
    ).toEqual({ durationMs: 9000, width: 1280, height: 720 });
  });

  it("leaves a fact at zero when the file can't answer it", () => {
    expect(
      fillMediaFacts(
        { durationMs: 0, width: 0, height: 0 },
        { durationMs: null, width: 1280, height: 720, hasAudio: null },
      ),
    ).toEqual({ durationMs: 0, width: 1280, height: 720 });
    expect(
      fillMediaFacts({ durationMs: 0, width: 0, height: 0 }, null),
    ).toEqual({ durationMs: 0, width: 0, height: 0 });
  });
});
