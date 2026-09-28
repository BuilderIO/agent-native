import { DEFAULT_CANVAS_MIN_ZOOM } from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import {
  clampOverviewDisplayZoom,
  clampZoom,
  getBoardSelectionFitBounds,
  computeFitCameraForFrames,
  computeIframeLocalCanvasPoint,
  readOverviewZoomPercentFromTransform,
  resolveScreenDropPoint,
  DEFAULT_OVERVIEW_ZOOM,
  getAllScreenFrameEntries,
  getNextZoomStepDown,
  getNextZoomStepUp,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewZoomScale,
  MAX_SANE_SCREEN_ENTRY_ZOOM,
  MIN_RENDERABLE_OVERVIEW_DISPLAY_ZOOM,
  resolveOverviewZoomBasisScreenId,
  resolveScreenEntryZoom,
  shouldDeferOverviewZoomCommand,
  shouldPopToOverviewOnZoomChange,
  shouldResetExplicitOverviewZoomOnBasisChange,
} from "./design-editor/overview-camera";

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

describe("getBoardSelectionFitBounds", () => {
  it("fits a distant Board layer with selected Screen frames, excluding the Board frame", () => {
    const bounds = getBoardSelectionFitBounds({
      selectedFrameEntries: [
        {
          id: "board",
          geometry: { x: -65_536, y: -65_536, width: 131_072, height: 131_072 },
        },
        {
          id: "screen-selected",
          geometry: { x: 1000, y: 200, width: 320, height: 240 },
        },
        {
          id: "screen-unselected",
          geometry: { x: 8000, y: 8000, width: 1280, height: 800 },
        },
      ],
      selectedScreenIds: new Set(["board", "screen-selected"]),
      boardFileId: "board",
      boardBounds: { left: -1200, top: 100, width: 120, height: 90 },
    });

    expect(bounds).toMatchObject({
      left: -1200,
      top: 100,
      right: 1320,
      bottom: 440,
      width: 2520,
      height: 340,
      centerX: 60,
      centerY: 270,
    });
  });

  it("keeps Board-only fit bounds when no Screen frames are selected", () => {
    expect(
      getBoardSelectionFitBounds({
        selectedFrameEntries: [
          {
            id: "board",
            geometry: {
              x: -65_536,
              y: -65_536,
              width: 131_072,
              height: 131_072,
            },
          },
        ],
        selectedScreenIds: new Set(["board"]),
        boardFileId: "board",
        boardBounds: { left: -1200, top: 100, width: 120, height: 90 },
      }),
    ).toMatchObject({
      left: -1200,
      top: 100,
      right: -1080,
      bottom: 190,
      width: 120,
      height: 90,
    });
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
    expect(Number.isFinite(b.geometry.x)).toBe(true);
    expect(Number.isFinite(b.geometry.y)).toBe(true);
  });

  it("reserves the rendered breakpoint row when requested for adjacency placement", () => {
    const args = {
      overviewScreens: [
        {
          id: "screen-1",
          width: 402,
          height: 874,
          breakpointWidths: [360, 375],
        },
      ],
      canvasFrameGeometryById: {
        "screen-1": { x: 0, y: 0, width: 402, height: 874 },
      },
    };

    expect(getAllScreenFrameEntries(args)[0]?.geometry.width).toBe(402);
    expect(
      getAllScreenFrameEntries({
        ...args,
        includeResponsivePreviews: true,
      })[0]?.geometry.width,
    ).toBe(1185);
  });

  it("includes actual board content bounds when provided and not already a screen", () => {
    const entries = getAllScreenFrameEntries({
      overviewScreens: [],
      canvasFrameGeometryById: {},
      boardFileId: "board-1",
      boardContentBounds: { x: 120, y: 80, width: 240, height: 160 },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "board-1",
      geometry: { x: 120, y: 80, width: 240, height: 160 },
    });
  });

  it("does not include an empty board in fit or placement entries", () => {
    expect(
      getAllScreenFrameEntries({
        overviewScreens: [],
        canvasFrameGeometryById: {},
        boardFileId: "board-1",
        boardContentBounds: null,
      }),
    ).toEqual([]);
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
    expect(resolveScreenEntryZoom("screen-a", screenZoomById, 100)).toBe(2);
  });
});

describe("shouldPopToOverviewOnZoomChange — explicit zoom-to-N% presets never pop to overview", () => {
  const threshold = 60;

  it("reproduces the reported bug: 'Zoom to 50%' from the default 100% single-view zoom must NOT pop to overview when unsuppressed (documents why suppression is required)", () => {
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

describe("resolveOverviewZoomBasisScreenId — the board can never define the overview zoom scale", () => {
  const overviewScreenIds = ["screen-1", "screen-2"];

  it("returns the candidate when it is a real overview screen", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: "screen-2",
        boardFileId: "board-file",
        overviewScreenIds,
      }),
    ).toBe("screen-2");
  });

  it("falls back to the first overview screen when the candidate is the board file", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: "board-file",
        boardFileId: "board-file",
        overviewScreenIds,
      }),
    ).toBe("screen-1");
  });

  it("falls back to the first overview screen for a non-screen file (e.g. a CSS support file)", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: "styles-css-file",
        boardFileId: "board-file",
        overviewScreenIds,
      }),
    ).toBe("screen-1");
  });

  it("returns null when there are no overview screens at all", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: "board-file",
        boardFileId: "board-file",
        overviewScreenIds: [],
      }),
    ).toBeNull();
  });

  it("never returns the board even if it leaked into the screen id list", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: null,
        boardFileId: "board-file",
        overviewScreenIds: ["board-file", "screen-1"],
      }),
    ).toBe("screen-1");
  });

  it("handles a null candidate (no active file yet)", () => {
    expect(
      resolveOverviewZoomBasisScreenId({
        candidateFileId: null,
        boardFileId: null,
        overviewScreenIds,
      }),
    ).toBe("screen-1");
  });
});

describe("board flip zoom corruption (observed displayed zoom: 10241.49%)", () => {
  it("keeps the zoom basis anchored to the real screen when activeFileId flips to the board — the scale (and therefore the displayed zoom) cannot move", () => {
    const overviewScreenIds = ["screen-1"];
    const basisBefore = resolveOverviewZoomBasisScreenId({
      candidateFileId: "screen-1",
      boardFileId: "board-file",
      overviewScreenIds,
    });
    const basisAfter = resolveOverviewZoomBasisScreenId({
      candidateFileId: "board-file",
      boardFileId: "board-file",
      overviewScreenIds,
    });
    expect(basisBefore).toBe("screen-1");
    expect(basisAfter).toBe("screen-1");
  });

  it("documents the old derivation: a board basis has neither frame geometry nor a source width, snapping the scale to the 0.25 double-fallback and displaying garbage against the pinned explicit zoom", () => {
    const boardBasisScale = getOverviewZoomScale({
      frameWidth: undefined,
      sourceWidth: undefined,
    });
    expect(boardBasisScale).toBe(0.25);
    const pinnedExplicitCanvasZoom = 40965.96;
    expect(
      getOverviewDisplayZoom(pinnedExplicitCanvasZoom, boardBasisScale),
    ).toBeCloseTo(10241.49, 2);
  });
});

describe("shouldResetExplicitOverviewZoomOnBasisChange — basis-identity invalidation", () => {
  it("never resets while the basis identity is unchanged", () => {
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-1",
        explicitOverviewCanvasZoom: 40965.96,
        nextOverviewZoomScale: 0.25,
      }),
    ).toBe(false);
  });

  it("never resets when there is no pinned explicit zoom", () => {
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-2",
        explicitOverviewCanvasZoom: null,
        nextOverviewZoomScale: 0.25,
      }),
    ).toBe(false);
  });

  it("keeps the pin across a normal screen-to-screen basis change (sane label shift, camera untouched)", () => {
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-2",
        explicitOverviewCanvasZoom: 40,
        nextOverviewZoomScale: 1.25,
      }),
    ).toBe(false);
  });

  it("resets when the basis change turns the pin into a displayed zoom above the editor's absolute max", () => {
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-2",
        explicitOverviewCanvasZoom: 40965.96,
        nextOverviewZoomScale: 2.5, // → 102,414.9% displayed
      }),
    ).toBe(true);
  });

  it("resets when the basis change turns the pin into an unrenderably small or non-finite displayed zoom", () => {
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-2",
        explicitOverviewCanvasZoom: 0.0001,
        nextOverviewZoomScale: 0.25, // → 0.000025% displayed
      }),
    ).toBe(true);
    expect(
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId: "screen-1",
        nextBasisScreenId: "screen-2",
        explicitOverviewCanvasZoom: Number.POSITIVE_INFINITY,
        nextOverviewZoomScale: 0.25,
      }),
    ).toBe(true);
    expect(MIN_RENDERABLE_OVERVIEW_DISPLAY_ZOOM).toBeGreaterThan(0);
  });
});

describe("shouldDeferOverviewZoomCommand — zoom-hydration compounding fix", () => {
  it("defers a zoom-bearing overview command until files have loaded", () => {
    expect(
      shouldDeferOverviewZoomCommand({
        hasZoomCommand: true,
        targetView: "overview",
        filesLoaded: false,
      }),
    ).toBe(true);
  });

  it("applies immediately once files have loaded", () => {
    expect(
      shouldDeferOverviewZoomCommand({
        hasZoomCommand: true,
        targetView: "overview",
        filesLoaded: true,
      }),
    ).toBe(false);
  });

  it("never defers a command with no zoom", () => {
    expect(
      shouldDeferOverviewZoomCommand({
        hasZoomCommand: false,
        targetView: "overview",
        filesLoaded: false,
      }),
    ).toBe(false);
  });

  it("never defers a single-screen zoom command (no canvas/display scale conversion involved)", () => {
    expect(
      shouldDeferOverviewZoomCommand({
        hasZoomCommand: true,
        targetView: "single",
        filesLoaded: false,
      }),
    ).toBe(false);
  });
});

describe("overview zoom hydration is idempotent across reloads (regression: compounding zoom bug)", () => {
  const FALLBACK_SCALE = getOverviewZoomScale({
    frameWidth: undefined,
    sourceWidth: undefined,
  });
  const REAL_SCALE = getOverviewZoomScale({
    frameWidth: 1123,
    sourceWidth: 1280,
  });

  function hydrateWithoutDeferral(persistedDisplayZoom: number): number {
    const canvasZoomUnderFallback = getOverviewCanvasZoom(
      persistedDisplayZoom,
      FALLBACK_SCALE,
    );
    return getOverviewDisplayZoom(canvasZoomUnderFallback, REAL_SCALE);
  }

  function hydrateWithDeferral(persistedDisplayZoom: number): number {
    const filesLoaded = true;
    expect(
      shouldDeferOverviewZoomCommand({
        hasZoomCommand: true,
        targetView: "overview",
        filesLoaded,
      }),
    ).toBe(false);
    const canvasZoom = getOverviewCanvasZoom(persistedDisplayZoom, REAL_SCALE);
    return getOverviewDisplayZoom(canvasZoom, REAL_SCALE);
  }

  it("demonstrates the bug: without deferral, repeated hydration compounds the displayed zoom", () => {
    let zoom = 100;
    const history = [zoom];
    for (let i = 0; i < 4; i++) {
      zoom = hydrateWithoutDeferral(zoom);
      history.push(zoom);
    }
    const factor = REAL_SCALE / FALLBACK_SCALE;
    expect(factor).toBeGreaterThan(1);
    for (let i = 1; i < history.length; i++) {
      expect(history[i]).toBeCloseTo(history[i - 1] * factor, 5);
    }
    expect(history[history.length - 1]).toBeGreaterThan(history[0] * 10);
  });

  it("fix: with deferral, N reload/hydration passes leave the persisted zoom unchanged", () => {
    const persisted = 100;
    let zoom = persisted;
    for (let i = 0; i < 6; i++) {
      zoom = hydrateWithDeferral(zoom);
      expect(zoom).toBeCloseTo(persisted, 9);
    }
  });

  it("fix: idempotent for an arbitrary already-legitimate persisted zoom too, not just the default", () => {
    for (const persisted of [37.5, 60, 256.25, 800]) {
      let zoom = persisted;
      for (let i = 0; i < 4; i++) {
        zoom = hydrateWithDeferral(zoom);
      }
      expect(zoom).toBeCloseTo(persisted, 9);
    }
  });
});

describe("clampOverviewDisplayZoom — final displayed-zoom sanity net", () => {
  it("falls back to the default overview zoom for non-finite or non-positive products", () => {
    expect(clampOverviewDisplayZoom(NaN)).toBe(DEFAULT_OVERVIEW_ZOOM);
    expect(clampOverviewDisplayZoom(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_OVERVIEW_ZOOM,
    );
    expect(clampOverviewDisplayZoom(0)).toBe(DEFAULT_OVERVIEW_ZOOM);
    expect(clampOverviewDisplayZoom(-50)).toBe(DEFAULT_OVERVIEW_ZOOM);
  });

  it("caps a beyond-max garbage product at the editor's absolute max zoom", () => {
    expect(clampOverviewDisplayZoom(102414.9)).toBe(25600);
    expect(clampOverviewDisplayZoom(1e9)).toBe(25600);
  });

  it("passes legitimate display zooms through unchanged, including sub-minimum products of small screen scales", () => {
    expect(clampOverviewDisplayZoom(100)).toBe(100);
    expect(clampOverviewDisplayZoom(60)).toBe(60);
    expect(clampOverviewDisplayZoom(0.5)).toBe(0.5);
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
    expect(camera!.zoom).toBeLessThan(100);
  });

  it("still fits a board far too wide to show at a legible zoom", () => {
    const frames = Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      geometry: { x: index * 1400, y: 0, width: 1280, height: 900 },
    }));
    const camera = computeFitCameraForFrames(frames, {
      width: 1400,
      height: 900,
    });
    expect(camera).not.toBeNull();
    expect(camera!.zoom).toBeLessThan(10);
    expect(camera!.zoom).toBeGreaterThanOrEqual(DEFAULT_CANVAS_MIN_ZOOM);
  });

  it("clamps the computed zoom to the shared canvas zoom range", () => {
    const frames = [{ id: "a", geometry: { x: 0, y: 0, width: 1, height: 1 } }];
    const camera = computeFitCameraForFrames(frames, {
      width: 4000,
      height: 4000,
    });
    expect(camera).not.toBeNull();
    expect(camera!.zoom).toBeLessThanOrEqual(25600);
  });
});

describe("computeIframeLocalCanvasPoint — PASTE-HERE-IN-CONTENT", () => {
  it("converts a viewport point to iframe-local document coordinates at 100% zoom", () => {
    expect(
      computeIframeLocalCanvasPoint({
        clientX: 150,
        clientY: 220,
        iframeRect: { left: 50, top: 100 },
        zoomPercent: 100,
      }),
    ).toEqual({ x: 100, y: 120 });
  });

  it("divides by the zoom factor so a zoomed-out iframe still maps to the correct document point", () => {
    expect(
      computeIframeLocalCanvasPoint({
        clientX: 150,
        clientY: 100,
        iframeRect: { left: 50, top: 50 },
        zoomPercent: 50,
      }),
    ).toEqual({ x: 200, y: 100 });
  });

  it("clamps negative offsets (click above/left of the iframe origin) to zero", () => {
    expect(
      computeIframeLocalCanvasPoint({
        clientX: 10,
        clientY: 10,
        iframeRect: { left: 50, top: 50 },
        zoomPercent: 100,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("returns null when there is no iframe rect to measure against", () => {
    expect(
      computeIframeLocalCanvasPoint({
        clientX: 10,
        clientY: 10,
        iframeRect: null,
        zoomPercent: 100,
      }),
    ).toBeNull();
  });

  it("returns null for a non-positive zoom percent instead of dividing by zero", () => {
    expect(
      computeIframeLocalCanvasPoint({
        clientX: 10,
        clientY: 10,
        iframeRect: { left: 0, top: 0 },
        zoomPercent: 0,
      }),
    ).toBeNull();
  });
});

describe("resolveScreenDropPoint — asset library drops", () => {
  it("returns the target screen and zoom-adjusted content coordinates", () => {
    const result = resolveScreenDropPoint({
      clientX: 392,
      clientY: 232,
      screenId: "screen-1",
      iframeRect: { left: 100, top: 20, right: 736, bottom: 444 },
      zoomPercent: 53,
    });

    expect(result?.screenId).toBe("screen-1");
    expect(result?.x).toBeCloseTo(550.94, 2);
    expect(result?.y).toBe(400);
  });

  it("rejects drops outside the target screen content", () => {
    expect(
      resolveScreenDropPoint({
        clientX: 80,
        clientY: 232,
        screenId: "screen-1",
        iframeRect: { left: 100, top: 20, right: 736, bottom: 444 },
        zoomPercent: 53,
      }),
    ).toBeNull();
  });

  it("rejects drops without a resolved screen", () => {
    expect(
      resolveScreenDropPoint({
        clientX: 392,
        clientY: 232,
        screenId: null,
        iframeRect: { left: 100, top: 20, right: 736, bottom: 444 },
        zoomPercent: 53,
      }),
    ).toBeNull();
  });
});

describe("readOverviewZoomPercentFromTransform", () => {
  it("reads the live scale written during an unsettled overview gesture", () => {
    expect(
      readOverviewZoomPercentFromTransform(
        "translate(42px, -18px) scale(0.375)",
        100,
      ),
    ).toBe(37.5);
  });

  it("falls back for missing, malformed, zero, or negative scales", () => {
    expect(readOverviewZoomPercentFromTransform("", 64)).toBe(64);
    expect(
      readOverviewZoomPercentFromTransform("translate(1px, 2px)", 64),
    ).toBe(64);
    expect(readOverviewZoomPercentFromTransform("scale(0)", 64)).toBe(64);
    expect(readOverviewZoomPercentFromTransform("scale(-2)", 64)).toBe(64);
  });
});
