import { describe, expect, it } from "vitest";

import { resolveMediaDurationMs } from "./media-duration";

describe("resolveMediaDurationMs", () => {
  it("uses playable media duration when stored metadata counted a pause", () => {
    expect(resolveMediaDurationMs(461_772, 80.576)).toBe(80_576);
  });

  it("keeps recorder metadata within normal MediaRecorder drift", () => {
    expect(resolveMediaDurationMs(80_000, 78.4)).toBe(80_000);
  });

  it("falls back to whichever valid duration is available", () => {
    expect(resolveMediaDurationMs(0, 12.345)).toBe(12_345);
    expect(resolveMediaDurationMs(12_345, Number.POSITIVE_INFINITY)).toBe(
      12_345,
    );
  });
});
