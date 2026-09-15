import { describe, expect, it } from "vitest";

import {
  getAllScreenFrameEntries,
  pinnedHeightScreenIds,
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

  // A pinned Screen's rendered frame clips overflow at the pinned height
  // instead of growing (canvasFrames's own autoHeight gates on the same
  // flag) — fitting to the overflow height would zoom past what's actually
  // on screen, so a pinned Screen must keep its persisted height even when
  // reported content is taller.
  it("keeps the persisted height for a heightPinned screen even when measured content is taller", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const pinned = pinnedHeightScreenIds([{ id: "a", heightPinned: true }]);
    const unchanged = withMeasuredFrameHeights(frames, { a: 2400 }, pinned);
    expect(unchanged[0]?.geometry.height).toBe(1024);
  });

  it("still grows an unpinned screen alongside a pinned one", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }, { id: "b" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY, b: PERSISTED_GEOMETRY },
    });
    const pinned = pinnedHeightScreenIds([
      { id: "a", heightPinned: true },
      { id: "b", heightPinned: false },
    ]);
    const result = withMeasuredFrameHeights(
      frames,
      { a: 2400, b: 2400 },
      pinned,
    );
    expect(result.find((f) => f.id === "a")?.geometry.height).toBe(1024);
    expect(result.find((f) => f.id === "b")?.geometry.height).toBe(2400);
  });
});

describe("pinnedHeightScreenIds", () => {
  it("collects only screens with heightPinned true", () => {
    const ids = pinnedHeightScreenIds([
      { id: "a", heightPinned: true },
      { id: "b", heightPinned: false },
      { id: "c" },
    ]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(false);
    expect(ids.has("c")).toBe(false);
  });
});
