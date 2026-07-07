import { describe, expect, it } from "vitest";

import {
  clampZoom,
  computeFitCameraForFrames,
  getAllScreenFrameEntries,
  getNextZoomStepDown,
  getNextZoomStepUp,
  MAX_SANE_SCREEN_ENTRY_ZOOM,
  resolveScreenEntryZoom,
  shouldPopToOverviewOnZoomChange,
} from "./DesignEditor";

describe("clampZoom", () => {
  it("clamps to the shared canvas zoom range by default", () => {
    expect(clampZoom(1)).toBe(2);
    expect(clampZoom(50000)).toBe(25600);
    expect(clampZoom(100)).toBe(100);
  });

  it("supports a custom min/max range", () => {
    expect(clampZoom(5, 10, 500)).toBe(10);
    expect(clampZoom(1000, 10, 500)).toBe(500);
  });

  it("falls back to min for non-finite input", () => {
    expect(clampZoom(NaN)).toBe(2);
    expect(clampZoom(Infinity, 5, 300)).toBe(5);
  });
});

describe("getNextZoomStepUp / getNextZoomStepDown — Figma-style doubling anchors", () => {
  it("steps up through the doubling sequence anchored at 100", () => {
    expect(getNextZoomStepUp(100)).toBe(200);
    expect(getNextZoomStepUp(200)).toBe(400);
    expect(getNextZoomStepUp(400)).toBe(800);
  });

  it("never stalls at the old ZOOM_PRESETS ceiling (200)", () => {
    // Previously handleZoomIn returned the input unchanged once past 200.
    expect(getNextZoomStepUp(200)).toBeGreaterThan(200);
    expect(getNextZoomStepUp(500)).toBeGreaterThan(500);
  });

  it("keeps doubling across the widened range instead of stalling at the old 800 ceiling", () => {
    expect(getNextZoomStepUp(800)).toBe(1600);
    expect(getNextZoomStepUp(1600)).toBe(3200);
    expect(getNextZoomStepUp(3200)).toBe(6400);
    expect(getNextZoomStepUp(6400)).toBe(12800);
    expect(getNextZoomStepUp(12800)).toBe(25600);
  });

  it("clamps step-up at the shared max zoom (25600)", () => {
    expect(getNextZoomStepUp(25600)).toBe(25600);
    expect(getNextZoomStepUp(20000)).toBe(25600);
  });

  it("steps down through the halving sequence anchored at 100", () => {
    expect(getNextZoomStepDown(200)).toBe(100);
    expect(getNextZoomStepDown(100)).toBe(50);
    expect(getNextZoomStepDown(50)).toBe(25);
  });

  it("clamps step-down at the shared min zoom (2) instead of stalling", () => {
    expect(getNextZoomStepDown(3)).toBe(2);
    expect(getNextZoomStepDown(2)).toBe(2);
  });

  it("steps from an off-anchor zoom to the nearest next/prev anchor", () => {
    expect(getNextZoomStepUp(150)).toBe(200);
    expect(getNextZoomStepDown(150)).toBe(100);
  });

  it("never enters an infinite loop stepping up from min to max across the widened range", () => {
    let zoom = 2;
    let iterations = 0;
    while (zoom < 25600 && iterations < 1000) {
      const next = getNextZoomStepUp(zoom);
      expect(next).toBeGreaterThan(zoom);
      zoom = next;
      iterations += 1;
    }
    expect(zoom).toBe(25600);
    expect(iterations).toBeLessThan(1000);
  });

  it("never enters an infinite loop stepping down from max to min across the widened range", () => {
    let zoom = 25600;
    let iterations = 0;
    while (zoom > 2 && iterations < 1000) {
      const next = getNextZoomStepDown(zoom);
      expect(next).toBeLessThan(zoom);
      zoom = next;
      iterations += 1;
    }
    expect(zoom).toBe(2);
    expect(iterations).toBeLessThan(1000);
  });
});

describe("getAllScreenFrameEntries", () => {
  it("merges persisted geometry over the initial-fallback geometry per screen", () => {
    const entries = getAllScreenFrameEntries({
      overviewScreens: [
        { id: "a", width: 1280, height: 800 },
        { id: "b", width: 1280, height: 800 },
      ],
      canvasFrameGeometryById: {
        a: { x: 500, y: 500 },
      },
    });
    expect(entries).toHaveLength(2);
    const a = entries.find((e) => e.id === "a")!;
    expect(a.geometry.x).toBe(500);
    expect(a.geometry.y).toBe(500);
    expect(a.geometry.width).toBeGreaterThan(0);
    const b = entries.find((e) => e.id === "b")!;
    // No persisted geometry for "b" — falls back to getInitialFrameGeometry.
    expect(Number.isFinite(b.geometry.x)).toBe(true);
    expect(Number.isFinite(b.geometry.y)).toBe(true);
  });

  it("includes the board frame when provided and not already a screen", () => {
    const entries = getAllScreenFrameEntries({
      overviewScreens: [],
      canvasFrameGeometryById: {},
      boardFileId: "board-1",
      boardFrameGeometry: { x: -1000, y: -1000, width: 2000, height: 2000 },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("board-1");
  });

  it("returns an empty list for no screens and no board", () => {
    expect(
      getAllScreenFrameEntries({
        overviewScreens: [],
        canvasFrameGeometryById: {},
      }),
    ).toEqual([]);
  });
});

describe("resolveScreenEntryZoom — per-screen zoom memory", () => {
  it("returns the default zoom for a screen with no remembered entry (first visit)", () => {
    const screenZoomById = new Map<string, number>();
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(100);
  });

  it("restores a screen's last-remembered zoom instead of the default", () => {
    const screenZoomById = new Map<string, number>([
      ["screen-a", 250],
      ["screen-b", 50],
    ]);
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(250);
    expect(resolveScreenEntryZoom("screen-b", screenZoomById, 100)).toBe(50);
  });

  it("does not mix up different screens' remembered zooms", () => {
    const screenZoomById = new Map<string, number>([["screen-a", 250]]);
    // screen-c was never visited — must fall back to default, not screen-a's.
    expect(resolveScreenEntryZoom("screen-c", screenZoomById, 100)).toBe(100);
  });

  it("falls back to the default zoom for a null/undefined target id", () => {
    const screenZoomById = new Map<string, number>([["screen-a", 250]]);
    expect(resolveScreenEntryZoom(null, screenZoomById, 100)).toBe(100);
    expect(resolveScreenEntryZoom(undefined, screenZoomById, 100)).toBe(100);
  });

  it("falls back to the default zoom for an empty string target id", () => {
    const screenZoomById = new Map<string, number>([["screen-a", 250]]);
    expect(resolveScreenEntryZoom("", screenZoomById, 100)).toBe(100);
  });

  // Item 5 — camera restore: a corrupted/degenerate remembered zoom (e.g.
  // 1506%/3968%, observed in the field) must never be blindly restored —
  // re-entering a screen at it shows an unrecognizable close-up instead of
  // the screen the user expects ("lands on empty canvas").
  it("falls back to the default zoom when the remembered value is absurdly high", () => {
    const screenZoomById = new Map<string, number>([
      ["screen-a", 1506],
      ["screen-b", 3968],
    ]);
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(100);
    expect(resolveScreenEntryZoom("screen-b", screenZoomById, 100)).toBe(100);
  });

  it("still restores a high-but-sane remembered zoom (at the ceiling)", () => {
    const screenZoomById = new Map<string, number>([
      ["screen-a", MAX_SANE_SCREEN_ENTRY_ZOOM],
    ]);
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(
      MAX_SANE_SCREEN_ENTRY_ZOOM,
    );
  });

  it("falls back to the default zoom for a non-finite or non-positive remembered value", () => {
    const screenZoomById = new Map<string, number>([
      ["screen-a", NaN],
      ["screen-b", Infinity],
      ["screen-c", 0],
      ["screen-d", -50],
    ]);
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(100);
    expect(resolveScreenEntryZoom("screen-b", screenZoomById, 100)).toBe(100);
    expect(resolveScreenEntryZoom("screen-c", screenZoomById, 100)).toBe(100);
    expect(resolveScreenEntryZoom("screen-d", screenZoomById, 100)).toBe(100);
  });

  it("clamps a remembered value below the shared minimum instead of restoring it raw", () => {
    const screenZoomById = new Map<string, number>([["screen-a", 0.5]]);
    // Below DEFAULT_CANVAS_MIN_ZOOM (2) but still finite/positive — clamped up
    // to the shared minimum rather than falling back to the default.
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(2);
  });
});

describe("shouldPopToOverviewOnZoomChange — explicit zoom-to-N% presets never pop to overview", () => {
  const threshold = 60;

  it("reproduces the reported bug: 'Zoom to 50%' from the default 100% single-view zoom must NOT pop to overview when unsuppressed (documents why suppression is required)", () => {
    // FOCUSED_SCREEN_ZOOM is 100; the "Zoom to 50%" menu preset sets zoom to
    // 50, which is below OVERVIEW_ZOOM_THRESHOLD (60) and previousZoom (100)
    // was at/above it — the raw edge-trigger heuristic alone says "pop".
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: 100,
        zoom: 50,
        threshold,
        suppressExplicitZoom: false,
      }),
    ).toBe(true);
  });

  it("stays in single view at 50% when the explicit-zoom preset suppresses the pop (the actual fix)", () => {
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: 100,
        zoom: 50,
        threshold,
        suppressExplicitZoom: true,
      }),
    ).toBe(false);
  });

  it("suppresses regardless of starting zoom (e.g. 200% -> Zoom to 50%)", () => {
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: 200,
        zoom: 50,
        threshold,
        suppressExplicitZoom: true,
      }),
    ).toBe(false);
  });

  it("still pops for a genuine continuous zoom-out gesture (unsuppressed)", () => {
    // handleZoomOut / scroll / pinch never set the suppression flag — the
    // Figma-style pop-on-zoom-out-past-threshold behavior must be preserved.
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: 62,
        zoom: 48,
        threshold,
        suppressExplicitZoom: false,
      }),
    ).toBe(true);
  });

  it("never pops on entry regardless of suppression (previousZoom null)", () => {
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: null,
        zoom: 16,
        threshold,
        suppressExplicitZoom: false,
      }),
    ).toBe(false);
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: null,
        zoom: 16,
        threshold,
        suppressExplicitZoom: true,
      }),
    ).toBe(false);
  });

  it("does not pop when the explicit destination stays at/above the threshold", () => {
    expect(
      shouldPopToOverviewOnZoomChange({
        previousZoom: 50,
        zoom: 100,
        threshold,
        suppressExplicitZoom: false,
      }),
    ).toBe(false);
  });
});

describe("computeFitCameraForFrames", () => {
  it("returns null when there are no frames", () => {
    expect(
      computeFitCameraForFrames([], { width: 1000, height: 800 }),
    ).toBeNull();
  });

  it("returns null for a degenerate viewport", () => {
    const frames = [
      { id: "a", geometry: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(
      computeFitCameraForFrames(frames, { width: 0, height: 0 }),
    ).toBeNull();
  });

  it("computes a zoom that fits a single frame's bounds in the viewport", () => {
    const frames = [
      { id: "a", geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
    ];
    const camera = computeFitCameraForFrames(frames, {
      width: 500,
      height: 500,
    });
    expect(camera).not.toBeNull();
    // A 1000x1000 frame fit into a 500x500 viewport (minus padding) must zoom
    // out well below 100%.
    expect(camera!.zoom).toBeLessThan(100);
    expect(camera!.zoom).toBeGreaterThan(0);
  });

  it("fits the union bounds of multiple frames", () => {
    const frames = [
      { id: "a", geometry: { x: 0, y: 0, width: 200, height: 200 } },
      { id: "b", geometry: { x: 1000, y: 1000, width: 200, height: 200 } },
    ];
    const camera = computeFitCameraForFrames(frames, {
      width: 800,
      height: 800,
    });
    expect(camera).not.toBeNull();
    // The union bounds span ~1200x1200 — must zoom out to fit both.
    expect(camera!.zoom).toBeLessThan(100);
  });

  it("clamps the computed zoom to the shared canvas zoom range", () => {
    // A tiny frame in a huge viewport would otherwise want to zoom in far
    // past the max zoom.
    const frames = [{ id: "a", geometry: { x: 0, y: 0, width: 1, height: 1 } }];
    const camera = computeFitCameraForFrames(frames, {
      width: 4000,
      height: 4000,
    });
    expect(camera).not.toBeNull();
    expect(camera!.zoom).toBeLessThanOrEqual(25600);
  });
});
