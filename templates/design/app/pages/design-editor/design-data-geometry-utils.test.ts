import { describe, expect, it } from "vitest";

import {
  frameHeightChangedIds,
  nextLocalhostScreenPosition,
  staleGeometryFrameIds,
  viewportChangedFrameIds,
} from "./design-data-geometry-utils";
import type { GeometryHistoryEntry } from "./history";

describe("frame resize dimensions", () => {
  it("distinguishes a width-only resize from a height resize", () => {
    const before = { screen: { x: 0, y: 0, width: 300, height: 400 } };
    const widthOnly = { screen: { x: 0, y: 0, width: 360, height: 400 } };
    const heightChanged = {
      screen: { x: 0, y: 0, width: 360, height: 440 },
    };

    expect(viewportChangedFrameIds(before, widthOnly)).toEqual(["screen"]);
    expect(frameHeightChangedIds(before, widthOnly)).toEqual([]);
    expect(frameHeightChangedIds(widthOnly, heightChanged)).toEqual(["screen"]);
  });
});

describe("nextLocalhostScreenPosition", () => {
  it("returns the origin when the canvas has no frames yet", () => {
    expect(nextLocalhostScreenPosition({})).toEqual({ x: 0, y: 0 });
  });

  it("places the new frame to the right of the rightmost existing frame", () => {
    expect(
      nextLocalhostScreenPosition({
        a: { x: 0, y: 0, width: 1280, height: 900 },
        b: { x: 1440, y: 0, width: 1280, height: 900 },
      }),
    ).toEqual({ x: 2880, y: 0 });
  });

  it("uses the topmost frame's y and tolerates missing geometry fields", () => {
    expect(
      nextLocalhostScreenPosition({
        a: { x: 100, y: -200, width: 400 },
        b: { y: 50 },
      }),
    ).toEqual({ x: 660, y: -200 });
  });
});

describe("geometry freshness", () => {
  const entry: GeometryHistoryEntry = {
    before: {
      screen: { x: 0, y: 0, width: 400, height: 400, rotation: 0 },
    },
    after: {
      screen: { x: 0, y: 0, width: 400, height: 400, rotation: 45 },
    },
  };

  it("accepts a local rotation after its committed live snapshot is published", () => {
    expect(staleGeometryFrameIds(entry, entry.after, entry.after)).toEqual([]);
  });

  it("still skips a same-frame peer rotation while ignoring unrelated frames", () => {
    expect(
      staleGeometryFrameIds(
        entry,
        {
          ...entry.after,
          screen: { ...entry.after.screen, rotation: 30 },
          other: { x: 900, y: 0, width: 100, height: 100, rotation: 10 },
        },
        entry.after,
      ),
    ).toEqual(["screen"]);
  });
});
