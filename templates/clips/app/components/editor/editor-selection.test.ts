import { describe, expect, it } from "vitest";

import { defaultSelectionRange } from "./editor-selection";

describe("defaultSelectionRange", () => {
  it("keeps the default selector near the playhead", () => {
    expect(defaultSelectionRange(10_000, 60_000)).toEqual({
      startMs: 9_000,
      endMs: 11_000,
    });
  });

  it("clamps the selector to both ends of the clip", () => {
    expect(defaultSelectionRange(0, 60_000)).toEqual({
      startMs: 0,
      endMs: 1_000,
    });
    expect(defaultSelectionRange(59_500, 60_000)).toEqual({
      startMs: 58_500,
      endMs: 60_000,
    });
  });
});
