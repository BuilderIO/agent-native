import { describe, expect, it } from "vitest";

import {
  getAllScreenFrameEntries,
  withMeasuredFrameHeights,
} from "./overview-camera";

// A real screen created via create-file.ts always gets an explicit
// canvasFrames entry (1440x1024) — use the same shape here rather than the
// no-persisted-geometry fallback, which scales height to a miniature
// preview width and would not exercise this "grows past the persisted
// height" behavior at all.
const PERSISTED_GEOMETRY = { x: 0, y: 0, width: 1440, height: 1024 };

describe("withMeasuredFrameHeights", () => {
  it("grows a frame's height to a taller measured content height", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const widened = withMeasuredFrameHeights(frames, { a: 2400 });
    expect(widened[0]?.geometry.height).toBe(2400);
    // Width and position are untouched by a height-only fit correction.
    expect(widened[0]?.geometry.width).toBe(frames[0]?.geometry.width);
    expect(widened[0]?.geometry.x).toBe(frames[0]?.geometry.x);
    expect(widened[0]?.geometry.y).toBe(frames[0]?.geometry.y);
  });

  it("never shrinks below the persisted height", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const unchanged = withMeasuredFrameHeights(frames, { a: 200 });
    expect(unchanged[0]?.geometry.height).toBe(1024);
  });

  it("is a no-op for a screen with no measurement reported yet", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    expect(withMeasuredFrameHeights(frames, {})).toBe(frames);
    expect(withMeasuredFrameHeights(frames, { other: 5000 })).toEqual(frames);
  });
});
