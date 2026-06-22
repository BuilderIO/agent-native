import { describe, expect, it } from "vitest";
import { scrubberPositionFromClientX } from "./scrubber-position";

describe("scrubberPositionFromClientX", () => {
  const rect = { left: 100, width: 200 };

  it("maps a client x coordinate to a video timestamp", () => {
    expect(scrubberPositionFromClientX(150, rect, 10_000)).toEqual({
      ms: 2500,
      x: 50,
    });
    expect(scrubberPositionFromClientX(250, rect, 10_000)).toEqual({
      ms: 7500,
      x: 150,
    });
  });

  it("clamps coordinates to the track", () => {
    expect(scrubberPositionFromClientX(50, rect, 10_000)).toEqual({
      ms: 0,
      x: 0,
    });
    expect(scrubberPositionFromClientX(350, rect, 10_000)).toEqual({
      ms: 10_000,
      x: 200,
    });
  });
});
