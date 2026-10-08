import { describe, expect, it } from "vitest";

import {
  autoHeightScreenIds,
  getAllScreenFrameEntries,
  pinnedHeightScreenIds,
  withMeasuredFrameHeights,
} from "./overview-camera";

const PERSISTED_GEOMETRY = { x: 0, y: 0, width: 1440, height: 1024 };
const DEFAULT_AUTO_SCREENS = [{ id: "a" }];
const DEFAULT_AUTO_PINNED_IDS = pinnedHeightScreenIds(DEFAULT_AUTO_SCREENS);
const DEFAULT_AUTO_HEIGHT_IDS = autoHeightScreenIds(DEFAULT_AUTO_SCREENS);

describe("withMeasuredFrameHeights", () => {
  it("grows a frame's height to a taller measured content height", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const widened = withMeasuredFrameHeights(
      frames,
      { a: 2400 },
      DEFAULT_AUTO_PINNED_IDS,
      DEFAULT_AUTO_HEIGHT_IDS,
    );
    expect(widened[0]?.geometry.height).toBe(2400);
    expect(widened[0]?.geometry.width).toBe(frames[0]?.geometry.width);
    expect(widened[0]?.geometry.x).toBe(frames[0]?.geometry.x);
    expect(widened[0]?.geometry.y).toBe(frames[0]?.geometry.y);
  });

  it("never shrinks below the persisted height", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const unchanged = withMeasuredFrameHeights(
      frames,
      { a: 200 },
      DEFAULT_AUTO_PINNED_IDS,
      DEFAULT_AUTO_HEIGHT_IDS,
    );
    expect(unchanged[0]?.geometry.height).toBe(1024);
  });

  it("is a no-op for a screen with no measurement reported yet", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    expect(
      withMeasuredFrameHeights(
        frames,
        {},
        DEFAULT_AUTO_PINNED_IDS,
        DEFAULT_AUTO_HEIGHT_IDS,
      ),
    ).toBe(frames);
    expect(
      withMeasuredFrameHeights(
        frames,
        { other: 5000 },
        DEFAULT_AUTO_PINNED_IDS,
        DEFAULT_AUTO_HEIGHT_IDS,
      ),
    ).toEqual(frames);
  });

  it("keeps the persisted height for a heightPinned screen even when measured content is taller", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY },
    });
    const pinnedScreens = [{ id: "a", heightPinned: true }];
    const pinned = pinnedHeightScreenIds(pinnedScreens);
    const auto = autoHeightScreenIds(pinnedScreens);
    const unchanged = withMeasuredFrameHeights(
      frames,
      { a: 2400 },
      pinned,
      auto,
    );
    expect(unchanged[0]?.geometry.height).toBe(1024);
  });

  it("still grows an unpinned screen alongside a pinned one", () => {
    const frames = getAllScreenFrameEntries({
      overviewScreens: [{ id: "a" }, { id: "b" }],
      canvasFrameGeometryById: { a: PERSISTED_GEOMETRY, b: PERSISTED_GEOMETRY },
    });
    const screens = [
      { id: "a", heightPinned: true },
      { id: "b", heightPinned: false },
    ];
    const pinned = pinnedHeightScreenIds(screens);
    const auto = autoHeightScreenIds(screens);
    const result = withMeasuredFrameHeights(
      frames,
      { a: 2400, b: 2400 },
      pinned,
      auto,
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

describe("withMeasuredFrameHeights Auto mode", () => {
  const screens = [
    { id: "auto", heightMode: "auto" as const, heightPinned: false },
    { id: "fixed", heightMode: "fixed" as const, heightPinned: true },
    { id: "hug", heightMode: "hug" as const, heightPinned: false },
    { id: "pinned-auto", heightMode: "auto" as const, heightPinned: true },
    { id: "legacy", heightPinned: false },
  ];
  const frames = [
    { id: "auto", geometry: { x: 10, y: 20, width: 400, height: 100 } },
    { id: "fixed", geometry: { x: 20, y: 30, width: 400, height: 200 } },
    { id: "hug", geometry: { x: 30, y: 40, width: 400, height: 300 } },
    {
      id: "pinned-auto",
      geometry: { x: 40, y: 50, width: 400, height: 400 },
    },
    { id: "legacy", geometry: { x: 50, y: 60, width: 400, height: 500 } },
  ];
  const pinnedIds = pinnedHeightScreenIds(screens);
  const autoIds = autoHeightScreenIds(screens);

  it("grows unpinned auto frames from accepted measurements only", () => {
    const result = withMeasuredFrameHeights(
      frames,
      { auto: 600, fixed: 700, hug: 800, "pinned-auto": 900, legacy: 750 },
      pinnedIds,
      autoIds,
    );

    expect(result.map((frame) => frame.geometry.height)).toEqual([
      600, 200, 300, 400, 750,
    ]);
    expect(result[0]?.geometry).toEqual({
      x: 10,
      y: 20,
      width: 400,
      height: 600,
    });
    expect(result[4]?.geometry).toEqual({
      x: 50,
      y: 60,
      width: 400,
      height: 750,
    });
  });

  it("does not shrink an auto frame when accepted content height falls", () => {
    const result = withMeasuredFrameHeights(
      frames,
      { auto: 80 },
      pinnedIds,
      autoIds,
    );

    expect(result[0]?.geometry).toEqual(frames[0]?.geometry);
  });
});
