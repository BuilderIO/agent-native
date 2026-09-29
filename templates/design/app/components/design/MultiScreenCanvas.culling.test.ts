import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  admitBootBudget,
  admitIframesProgressively,
  clampFrameGeometryToViewport,
  computeBoundedScreenCullState,
  computeScreenCullTier,
  getScreenContentCullState,
  getOverscannedViewportCanvasBounds,
  isFrameWithinOverscannedViewport,
  OVERVIEW_CULLING_ENABLED,
  OVERVIEW_CULLING_OVERSCAN_FACTOR,
  OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME,
  OVERVIEW_IFRAME_INSTANT_ADMISSION_MAX,
  OVERVIEW_LIVE_IFRAME_CEILING,
  OVERVIEW_LIVE_BOOT_BUDGET,
  OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX,
  OVERVIEW_LIVE_SCREEN_BUDGET,
  orderByViewportDistance,
  resolveLiveEditorScreenIds,
  selectStaticPreviewScreenIds,
  type ScreenCullCandidate,
  type OverscannedViewportBounds,
} from "./multi-screen/culling";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import type { FrameGeometry, Point } from "./multi-screen/types";

function geom(
  x: number,
  y: number,
  width = 320,
  height = 640,
  rotation?: number,
): FrameGeometry {
  return { x, y, width, height, rotation };
}

describe("MultiScreenCanvas viewport culling", () => {
  it("is enabled by default", () => {
    expect(OVERVIEW_CULLING_ENABLED).toBe(true);
  });

  it("uses enough overscan to absorb a settled pan", () => {
    expect(OVERVIEW_CULLING_OVERSCAN_FACTOR).toBeGreaterThanOrEqual(2);
  });

  describe("live boot admission", () => {
    it("admits only the nearest four candidates by default", () => {
      const candidates = Array.from(
        { length: 30 },
        (_, index) => `screen-${index}`,
      );
      expect(
        admitBootBudget({
          candidates,
          bootStatusById: new Map(),
          protectedIds: new Set(),
        }),
      ).toEqual(new Set(candidates.slice(0, OVERVIEW_LIVE_BOOT_BUDGET)));
    });

    it("does not admit more while the boot budget is occupied", () => {
      const candidates = Array.from(
        { length: 10 },
        (_, index) => `screen-${index}`,
      );
      const bootStatusById = new Map([
        ...candidates.slice(0, 4).map((id) => [id, "ready"] as const),
        ...candidates.slice(4, 8).map((id) => [id, "booting"] as const),
      ]);
      expect(
        admitBootBudget({
          candidates,
          bootStatusById,
          protectedIds: new Set(),
        }),
      ).toEqual(new Set(candidates.slice(0, 8)));
    });

    it("charges breakpoint preview frames against the boot budget", () => {
      expect(
        admitBootBudget({
          candidates: ["responsive", "plain"],
          bootStatusById: new Map(),
          bootBudget: 3,
          costById: new Map([
            ["responsive", 3],
            ["plain", 1],
          ]),
          protectedIds: new Set(),
        }),
      ).toEqual(new Set(["responsive"]));
    });

    it("admits an unbooted protected screen over budget", () => {
      const candidates = ["nearest", "protected", "later"];
      expect(
        admitBootBudget({
          candidates,
          bootStatusById: new Map([
            ["nearest", "booting"],
            ["later", "booting"],
          ]),
          bootBudget: 2,
          protectedIds: new Set(["protected"]),
        }),
      ).toEqual(new Set(candidates));
    });
  });

  it("measures the initial viewport in a layout effect before first paint", () => {
    const source = readFileSync(
      "app/components/design/MultiScreenCanvas.tsx",
      "utf8",
    );
    const measurementStart = source.indexOf(
      "// Track the pannable surface's own on-screen size",
    );
    const measurementBlock = source.slice(
      measurementStart,
      measurementStart + 1800,
    );

    expect(measurementStart).toBeGreaterThanOrEqual(0);
    expect(measurementBlock).toContain("useLayoutEffect(() => {");
    expect(measurementBlock).toContain("surface.getBoundingClientRect()");
  });

  it("uses one mount/hide lifecycle for primary and breakpoint iframes", () => {
    expect(getScreenContentCullState("placeholder")).toEqual({
      shouldMount: false,
      isHidden: false,
    });
    expect(getScreenContentCullState("visible")).toEqual({
      shouldMount: true,
      isHidden: false,
    });
    expect(getScreenContentCullState("culled")).toEqual({
      shouldMount: true,
      isHidden: true,
    });
    expect(getScreenContentCullState("evicted")).toEqual({
      shouldMount: false,
      isHidden: false,
    });

    const source = readFileSync(
      "app/components/design/MultiScreenCanvas.tsx",
      "utf8",
    );
    expect(source.match(/getScreenContentCullState\(cullTier\)/g)).toHaveLength(
      2,
    );
    expect(source).toContain(
      "visibleBreakpointWidths(screen.breakpointWidths, metadata.width)",
    );
    expect(
      source.match(/loading=\{cullTier === "visible" \? "eager" : "lazy"\}/g),
    ).toHaveLength(1);
    expect(source).toContain(
      'isExportPreview || cullTier === "visible" ? "eager" : "lazy"',
    );
  });

  describe("bounded live iframe allocation", () => {
    const viewport: OverscannedViewportBounds = {
      left: 0,
      top: 0,
      right: 100_000,
      bottom: 100_000,
    };

    function candidate(
      id: string,
      x: number,
      iframeCount = 1,
    ): ScreenCullCandidate {
      return { id, geometry: geom(x, 100), iframeCount };
    }

    function compute(
      candidates: ScreenCullCandidate[],
      options: {
        viewport?: OverscannedViewportBounds | null;
        visibleViewport?: OverscannedViewportBounds | null;
        protectedIds?: ReadonlySet<string>;
        previous?: ReturnType<typeof computeBoundedScreenCullState>;
        epoch?: number;
        budget?: number;
        screenBudget?: number;
      } = {},
    ) {
      return computeBoundedScreenCullState({
        candidates,
        viewport: options.viewport === undefined ? viewport : options.viewport,
        visibleViewport:
          options.visibleViewport === undefined
            ? options.viewport === undefined
              ? viewport
              : options.viewport
            : options.visibleViewport,
        protectedScreenIds: options.protectedIds ?? new Set(),
        previousLiveScreenIds:
          options.previous?.liveScreenIds ?? new Set<string>(),
        everVisibleScreenIds:
          options.previous?.everVisibleScreenIds ?? new Set<string>(),
        lastVisibleEpochByScreenId:
          options.previous?.lastVisibleEpochByScreenId ??
          new Map<string, number>(),
        accessEpoch: options.epoch ?? 1,
        liveScreenBudget: options.screenBudget,
        liveIframeBudget: options.budget,
      });
    }

    it("caps a 120-screen viewport at the explicit live-context budget", () => {
      const candidates = Array.from({ length: 120 }, (_, index) =>
        candidate(`screen-${String(index).padStart(3, "0")}`, index * 500),
      );
      const result = compute(candidates);

      expect(OVERVIEW_LIVE_SCREEN_BUDGET).toBeGreaterThan(0);
      expect(result.liveScreenIds.size).toBe(OVERVIEW_LIVE_SCREEN_BUDGET);
      expect(result.mountedIframeCount).toBe(OVERVIEW_LIVE_SCREEN_BUDGET);
      expect(
        [...result.tierByScreenId.values()].filter(
          (tier) => tier === "visible",
        ),
      ).toHaveLength(OVERVIEW_LIVE_SCREEN_BUDGET);
      expect(
        [...result.tierByScreenId.values()].filter(
          (tier) => tier === "placeholder",
        ),
      ).toHaveLength(120 - OVERVIEW_LIVE_SCREEN_BUDGET);
    });

    it("keeps a breakpoint-bearing board fully mounted instead of evicting on camera moves", () => {
      const candidates = Array.from({ length: 14 }, (_, index) =>
        candidate(`responsive-${index}`, index * 2_700, 3),
      );
      const first = compute(candidates);
      expect(first.liveScreenIds.size).toBe(14);
      expect(first.mountedIframeCount).toBe(42);
      expect(first.mountedIframeCount).toBeLessThanOrEqual(
        OVERVIEW_LIVE_IFRAME_CEILING,
      );
      expect([...first.tierByScreenId.values()]).not.toContain("evicted");

      const second = compute(candidates, { previous: first, epoch: 2 });
      expect(second.liveScreenIds).toEqual(first.liveScreenIds);
      expect([...second.tierByScreenId.values()]).not.toContain("evicted");
    });

    it("preserves mounted screens across an overlapping camera move", () => {
      const candidates = [
        candidate("old-a", 0),
        candidate("old-b", 100),
        candidate("new-a", 4_000),
        candidate("new-b", 4_100),
      ];
      const firstViewport = { left: 0, top: 0, right: 100, bottom: 1_000 };
      const overlappingViewport = {
        left: 0,
        top: 0,
        right: 5_000,
        bottom: 1_000,
      };
      const first = compute(candidates, {
        viewport: firstViewport,
        budget: 2,
        epoch: 1,
      });
      expect(first.liveScreenIds).toEqual(new Set(["old-a", "old-b"]));

      const second = compute(candidates, {
        viewport: overlappingViewport,
        budget: 2,
        epoch: 2,
        previous: first,
      });
      expect(second.liveScreenIds).toEqual(new Set(["old-a", "old-b"]));
      expect(second.tierByScreenId.get("new-a")).toBe("placeholder");
      expect(second.tierByScreenId.get("new-b")).toBe("placeholder");
    });

    it("admits a screen in the overscan band before it reaches the raw viewport", () => {
      const result = compute(
        [{ id: "prewarm", geometry: geom(150, 100, 20, 20), iframeCount: 1 }],
        {
          viewport: { left: 0, top: 0, right: 200, bottom: 200 },
          visibleViewport: { left: 0, top: 0, right: 100, bottom: 200 },
          screenBudget: 1,
        },
      );

      expect(result.liveScreenIds).toEqual(new Set(["prewarm"]));
      expect(result.tierByScreenId.get("prewarm")).toBe("visible");
    });

    it("lets raw-visible screens replace prior overscan-only screens", () => {
      const candidates = [
        candidate("old-a", 0),
        candidate("old-b", 100),
        candidate("new-a", 4_000),
        candidate("new-b", 4_100),
      ];
      const firstViewport = { left: 0, top: 0, right: 100, bottom: 1_000 };
      const wideOverscanViewport = {
        left: 0,
        top: 0,
        right: 5_000,
        bottom: 1_000,
      };
      const rawNewViewport = {
        left: 3_900,
        top: 0,
        right: 4_500,
        bottom: 1_000,
      };
      const first = compute(candidates, {
        viewport: firstViewport,
        visibleViewport: firstViewport,
        budget: 2,
        epoch: 1,
      });
      const second = compute(candidates, {
        viewport: wideOverscanViewport,
        visibleViewport: rawNewViewport,
        budget: 2,
        epoch: 2,
        previous: first,
      });
      expect(second.liveScreenIds).toEqual(new Set(["new-a", "new-b"]));
      expect(second.tierByScreenId.get("old-a")).toBe("evicted");
      expect(second.tierByScreenId.get("old-b")).toBe("evicted");
    });

    it("still bounds a huge breakpoint-bearing board by the iframe ceiling", () => {
      const candidates = Array.from({ length: 120 }, (_, index) =>
        candidate(
          `responsive-${String(index).padStart(3, "0")}`,
          index * 500,
          4,
        ),
      );
      const result = compute(candidates);

      expect(result.mountedIframeCount).toBeLessThanOrEqual(
        OVERVIEW_LIVE_IFRAME_CEILING,
      );
      expect(result.mountedIframeCount % 4).toBe(0);
      expect(result.liveScreenIds.size).toBe(OVERVIEW_LIVE_IFRAME_CEILING / 4);
    });

    it("evicts least-recently-visible screens and restores them on revisit", () => {
      const candidates = [
        candidate("a", 100),
        candidate("b", 500),
        candidate("c", 5_100),
        candidate("d", 5_500),
      ];
      const firstViewport = { left: 0, top: 0, right: 1_000, bottom: 1_000 };
      const secondViewport = {
        left: 5_000,
        top: 0,
        right: 6_000,
        bottom: 1_000,
      };
      const first = compute(candidates, {
        viewport: firstViewport,
        budget: 2,
        epoch: 1,
      });
      expect(first.liveScreenIds).toEqual(new Set(["a", "b"]));

      const second = compute(candidates, {
        viewport: secondViewport,
        budget: 2,
        epoch: 2,
        previous: first,
      });
      expect(second.liveScreenIds).toEqual(new Set(["c", "d"]));
      expect(second.tierByScreenId.get("a")).toBe("evicted");
      expect(second.tierByScreenId.get("b")).toBe("evicted");

      const revisited = compute(candidates, {
        viewport: firstViewport,
        budget: 2,
        epoch: 3,
        previous: second,
      });
      expect(revisited.liveScreenIds).toEqual(new Set(["a", "b"]));
      expect(revisited.tierByScreenId.get("a")).toBe("visible");
      expect(revisited.tierByScreenId.get("b")).toBe("visible");
      expect(revisited.tierByScreenId.get("c")).toBe("evicted");
    });

    it("keeps active and selected offscreen screens protected", () => {
      const candidates = Array.from({ length: 40 }, (_, index) =>
        candidate(`screen-${index}`, index * 1_000),
      );
      const protectedId = "screen-39";
      const narrowViewport = {
        left: 0,
        top: 0,
        right: 2_000,
        bottom: 1_000,
      };
      const result = compute(candidates, {
        viewport: narrowViewport,
        protectedIds: new Set([protectedId]),
        budget: 4,
      });

      expect(result.liveScreenIds.has(protectedId)).toBe(true);
      expect(result.tierByScreenId.get(protectedId)).toBe("visible");
      expect(result.mountedIframeCount).toBeLessThanOrEqual(4);
    });

    it("counts every breakpoint iframe against the hard budget", () => {
      const candidates = Array.from({ length: 10 }, (_, index) =>
        candidate(`responsive-${index}`, index * 500, 4),
      );
      const result = compute(candidates, { budget: 10 });

      expect(result.liveScreenIds.size).toBe(2);
      expect(result.mountedIframeCount).toBe(8);
      expect(result.mountedIframeCount).toBeLessThanOrEqual(10);
    });

    it("allows only protected interactions to temporarily exceed the pool", () => {
      const candidates = [
        candidate("active", 100, 3),
        candidate("selected", 500, 3),
      ];
      const result = compute(candidates, {
        viewport: null,
        protectedIds: new Set(["active", "selected"]),
        budget: 4,
      });

      expect(result.liveScreenIds).toEqual(new Set(["active", "selected"]));
      expect(result.mountedIframeCount).toBe(6);
      expect(result.tierByScreenId.get("active")).toBe("visible");
      expect(result.tierByScreenId.get("selected")).toBe("visible");
    });

    it("keeps a recent offscreen screen warm when budget remains", () => {
      const candidates = [candidate("warm", 100), candidate("cold", 5_000)];
      const first = compute(candidates, {
        viewport: { left: 0, top: 0, right: 1_000, bottom: 1_000 },
        budget: 2,
      });
      const offscreen = compute(candidates, {
        viewport: {
          left: 10_000,
          top: 10_000,
          right: 11_000,
          bottom: 11_000,
        },
        previous: first,
        budget: 2,
        epoch: 2,
      });

      expect(offscreen.liveScreenIds).toEqual(new Set(["warm"]));
      expect(offscreen.tierByScreenId.get("warm")).toBe("culled");
      expect(offscreen.tierByScreenId.get("cold")).toBe("placeholder");
    });
  });

  describe("getOverscannedViewportCanvasBounds", () => {
    it("returns null when the surface has no measured size yet", () => {
      expect(
        getOverscannedViewportCanvasBounds(
          { width: 0, height: 0 },
          { x: 0, y: 0 },
          100,
        ),
      ).toBeNull();
      expect(
        getOverscannedViewportCanvasBounds(
          { width: 800, height: 600 },
          { x: 0, y: 0 },
          0,
        ),
      ).toBeNull();
    });

    it("computes the visible rect at 100% zoom with no pan, minus overscan", () => {
      const bounds = getOverscannedViewportCanvasBounds(
        { width: 1000, height: 800 },
        { x: 0, y: 0 },
        100,
        1.5,
      );
      expect(bounds).not.toBeNull();
      const expectedLeft = 0 - 1000 * 1.5 - SURFACE_PADDING;
      const expectedRight = 1000 + 1000 * 1.5 - SURFACE_PADDING;
      const expectedTop = 0 - 800 * 1.5 - SURFACE_PADDING;
      const expectedBottom = 800 + 800 * 1.5 - SURFACE_PADDING;
      expect(bounds!.left).toBeCloseTo(expectedLeft);
      expect(bounds!.right).toBeCloseTo(expectedRight);
      expect(bounds!.top).toBeCloseTo(expectedTop);
      expect(bounds!.bottom).toBeCloseTo(expectedBottom);
    });

    it("shrinks the world-space visible rect as zoom increases", () => {
      const at100 = getOverscannedViewportCanvasBounds(
        { width: 1000, height: 800 },
        { x: 0, y: 0 },
        100,
        0,
      )!;
      const at200 = getOverscannedViewportCanvasBounds(
        { width: 1000, height: 800 },
        { x: 0, y: 0 },
        200,
        0,
      )!;
      expect(at200.right - at200.left).toBeCloseTo(
        (at100.right - at100.left) / 2,
      );
    });

    it("shifts the visible rect opposite to pan", () => {
      const noPan = getOverscannedViewportCanvasBounds(
        { width: 1000, height: 800 },
        { x: 0, y: 0 },
        100,
        0,
      )!;
      const panned = getOverscannedViewportCanvasBounds(
        { width: 1000, height: 800 },
        { x: -500, y: -200 },
        100,
        0,
      )!;
      expect(panned.left).toBeCloseTo(noPan.left + 500);
      expect(panned.top).toBeCloseTo(noPan.top + 200);
    });
  });

  describe("isFrameWithinOverscannedViewport", () => {
    const viewport: OverscannedViewportBounds = {
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
    };

    it("is true for a frame fully inside the viewport", () => {
      expect(isFrameWithinOverscannedViewport(geom(100, 100), viewport)).toBe(
        true,
      );
    });

    it("is true for a frame merely overlapping the viewport edge", () => {
      expect(isFrameWithinOverscannedViewport(geom(-100, 100), viewport)).toBe(
        true,
      );
    });

    it("is false for a frame fully outside (to the right of) the viewport", () => {
      expect(isFrameWithinOverscannedViewport(geom(1500, 100), viewport)).toBe(
        false,
      );
    });

    it("is false for a frame fully outside (above) the viewport", () => {
      expect(
        isFrameWithinOverscannedViewport(geom(100, -1000, 320, 640), viewport),
      ).toBe(false);
    });

    it("is true exactly at the boundary (touching edge counts as visible)", () => {
      expect(isFrameWithinOverscannedViewport(geom(-320, 100), viewport)).toBe(
        true,
      );
    });

    it("is false just past the boundary", () => {
      expect(
        isFrameWithinOverscannedViewport(geom(-320.01, 100), viewport),
      ).toBe(false);
    });

    it("uses the rotated AABB, not the unrotated rect, for a rotated frame", () => {
      const belowViewport: OverscannedViewportBounds = {
        left: 0,
        top: 400,
        right: 2000,
        bottom: 2000,
      };
      const unrotated = geom(100, 280, 640, 100, 0);
      const rotated = geom(100, 280, 640, 100, 90);
      expect(isFrameWithinOverscannedViewport(unrotated, belowViewport)).toBe(
        false,
      );
      expect(isFrameWithinOverscannedViewport(rotated, belowViewport)).toBe(
        true,
      );
    });
  });

  describe("computeScreenCullTier", () => {
    const viewport: OverscannedViewportBounds = {
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
    };

    it("returns visible for a frame inside the viewport", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(100, 100),
          viewport,
          alwaysVisible: false,
          hasBeenVisible: false,
        }),
      ).toBe("visible");
    });

    it("returns placeholder for a never-visible frame outside the viewport", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport,
          alwaysVisible: false,
          hasBeenVisible: false,
        }),
      ).toBe("placeholder");
    });

    it("returns culled (not placeholder) for a previously-visible frame now outside the viewport", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport,
          alwaysVisible: false,
          hasBeenVisible: true,
        }),
      ).toBe("culled");
    });

    it("treats the active screen as always visible regardless of position", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport,
          alwaysVisible: true,
          hasBeenVisible: false,
        }),
      ).toBe("visible");
    });

    it("treats a selected screen as always visible regardless of position", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(-9999, -9999),
          viewport,
          alwaysVisible: true,
          hasBeenVisible: false,
        }),
      ).toBe("visible");
    });

    it("keeps never-seen screens as placeholders until the viewport is measured", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport: null,
          alwaysVisible: false,
          hasBeenVisible: false,
        }),
      ).toBe("placeholder");
    });

    it("keeps active screens visible before measurement without mounting every iframe", () => {
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport: null,
          alwaysVisible: true,
          hasBeenVisible: false,
        }),
      ).toBe("visible");
      expect(
        computeScreenCullTier({
          geometry: geom(5000, 5000),
          viewport: null,
          alwaysVisible: false,
          hasBeenVisible: true,
        }),
      ).toBe("culled");
    });

    it("never regresses hasBeenVisible=true back to placeholder across repeated calls", () => {
      const offscreen = geom(5000, 5000);
      const first = computeScreenCullTier({
        geometry: offscreen,
        viewport,
        alwaysVisible: false,
        hasBeenVisible: false,
      });
      expect(first).toBe("placeholder");
      const second = computeScreenCullTier({
        geometry: offscreen,
        viewport,
        alwaysVisible: false,
        hasBeenVisible: true,
      });
      expect(second).toBe("culled");
      expect(second).not.toBe("placeholder");
    });
  });

  describe("end-to-end: viewport bounds feeding cull-tier decisions", () => {
    it("culls a screen far outside a realistic overscanned overview viewport", () => {
      const surfaceSize = { width: 1200, height: 800 };
      const pan: Point = { x: -2000, y: -2000 };
      const zoomPercent = 100;
      const viewport = getOverscannedViewportCanvasBounds(
        surfaceSize,
        pan,
        zoomPercent,
      );
      expect(viewport).not.toBeNull();

      const farScreen = geom(2000 + 20_000, 2000, 320, 640);
      expect(
        computeScreenCullTier({
          geometry: farScreen,
          viewport,
          alwaysVisible: false,
          hasBeenVisible: false,
        }),
      ).toBe("placeholder");
    });

    it("keeps a screen just outside the raw viewport alive via overscan", () => {
      const surfaceSize = { width: 1200, height: 800 };
      const pan: Point = { x: 0, y: 0 };
      const zoomPercent = 100;
      const viewport = getOverscannedViewportCanvasBounds(
        surfaceSize,
        pan,
        zoomPercent,
      );
      expect(viewport).not.toBeNull();

      const justOffscreen = geom(1200 + 100, 100, 320, 640);
      expect(
        computeScreenCullTier({
          geometry: justOffscreen,
          viewport,
          alwaysVisible: false,
          hasBeenVisible: false,
        }),
      ).toBe("visible");
    });
  });

  describe("clampFrameGeometryToViewport (item 4 — frame placement guard)", () => {
    const sanePanZoomViewport: OverscannedViewportBounds = {
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
    };

    it("returns the geometry unchanged when it already sits within the viewport", () => {
      const geometry = geom(100, 100, 320, 640);
      expect(clampFrameGeometryToViewport(geometry, sanePanZoomViewport)).toBe(
        geometry,
      );
    });

    it("returns the geometry unchanged when no viewport bounds are available", () => {
      const geometry = geom(100, 100);
      expect(clampFrameGeometryToViewport(geometry, null)).toBe(geometry);
    });

    it("centers a wildly-out-of-range geometry (corrupted camera) into the viewport", () => {
      const geometry = geom(65536, -65536, 320, 640);
      const clamped = clampFrameGeometryToViewport(
        geometry,
        sanePanZoomViewport,
      );
      expect(clamped.width).toBe(320);
      expect(clamped.height).toBe(640);
      expect(clamped.x).toBeCloseTo((1200 - 320) / 2);
      expect(clamped.y).toBeCloseTo((800 - 640) / 2);
    });

    it("centers a geometry that is only partially outside the viewport too", () => {
      const geometry = geom(-5000, 100, 320, 640);
      const clamped = clampFrameGeometryToViewport(
        geometry,
        sanePanZoomViewport,
      );
      expect(clamped.x).toBeCloseTo((1200 - 320) / 2);
    });

    it("leaves the geometry unchanged for a degenerate (zero-area) viewport", () => {
      const geometry = geom(65536, 65536);
      const degenerateViewport: OverscannedViewportBounds = {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      };
      expect(clampFrameGeometryToViewport(geometry, degenerateViewport)).toBe(
        geometry,
      );
    });
  });
});

describe("overview level of detail", () => {
  const none = new Set<string>();

  it("promotes a screen to a live editor once it is wide enough on screen", () => {
    const candidates = [
      { id: "phone", width: 390, alwaysLive: false },
      { id: "desktop", width: 1440, alwaysLive: false },
      { id: "app", width: 390, alwaysLive: true },
    ];
    expect([
      ...resolveLiveEditorScreenIds({
        candidates,
        zoomPercent: 10,
        previousIds: none,
      }),
    ]).toEqual(["app"]);
    const zoomPercent = Math.ceil(
      (OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX / 1440) * 100,
    );
    expect([
      ...resolveLiveEditorScreenIds({
        candidates,
        zoomPercent,
        previousIds: none,
      }),
    ]).toEqual(["desktop", "app"]);
  });

  it("keeps a live editor through a small zoom-out instead of reloading it", () => {
    const candidates = [{ id: "a", width: 1000, alwaysLive: false }];
    const justBelow = (OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX / 1000) * 90;
    expect(
      resolveLiveEditorScreenIds({
        candidates,
        zoomPercent: justBelow,
        previousIds: none,
      }).has("a"),
    ).toBe(false);
    expect(
      resolveLiveEditorScreenIds({
        candidates,
        zoomPercent: justBelow,
        previousIds: new Set(["a"]),
      }).has("a"),
    ).toBe(true);
    expect(
      resolveLiveEditorScreenIds({
        candidates,
        zoomPercent: justBelow / 2,
        previousIds: new Set(["a"]),
      }).has("a"),
    ).toBe(false);
  });

  it("mounts static previews nearest the viewport center within budget", () => {
    const viewport = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const candidates = [
      { id: "far", geometry: geom(900, 0, 50, 50) },
      { id: "center", geometry: geom(475, 475, 50, 50) },
      { id: "near", geometry: geom(300, 475, 50, 50) },
      { id: "outside", geometry: geom(5000, 0, 50, 50) },
    ];
    expect([
      ...selectStaticPreviewScreenIds({ candidates, viewport, budget: 2 }),
    ]).toEqual(["center", "near"]);
    expect(
      selectStaticPreviewScreenIds({ candidates, viewport: null }).size,
    ).toBe(0);
  });
});

describe("progressive iframe admission", () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => `s${index}`);
  const none = new Set<string>();

  it("orders ids nearest the viewport center first", () => {
    const viewport = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const candidates = [
      { id: "far", geometry: geom(900, 900, 50, 50) },
      { id: "center", geometry: geom(475, 475, 50, 50) },
      { id: "near", geometry: geom(300, 475, 50, 50) },
    ];
    expect(orderByViewportDistance(candidates, viewport)).toEqual([
      "center",
      "near",
      "far",
    ]);
    expect(orderByViewportDistance(candidates, null)).toEqual([
      "far",
      "center",
      "near",
    ]);
  });

  it("admits a large wanted set a frame's budget at a time, in priority order", () => {
    const wantedIds = ids(20);
    const first = admitIframesProgressively({
      wantedIds,
      admittedIds: none,
      immediateIds: none,
    });
    expect([...first]).toEqual(
      wantedIds.slice(0, OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME),
    );
    const second = admitIframesProgressively({
      wantedIds,
      admittedIds: first,
      immediateIds: none,
    });
    expect([...second]).toEqual(
      wantedIds.slice(0, OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME * 2),
    );
    expect(
      admitIframesProgressively({
        wantedIds,
        admittedIds: second,
        immediateIds: none,
        perFrame: 0,
      }),
    ).toEqual(second);
  });

  it("admits a small wanted set at once so a small board never trickles in", () => {
    const wantedIds = ids(OVERVIEW_IFRAME_INSTANT_ADMISSION_MAX);
    expect([
      ...admitIframesProgressively({
        wantedIds,
        admittedIds: none,
        immediateIds: none,
        perFrame: 0,
      }),
    ]).toEqual(wantedIds);
  });

  it("never delays immediate ids and drops ids that are no longer wanted", () => {
    const wantedIds = ids(20);
    const next = admitIframesProgressively({
      wantedIds,
      admittedIds: new Set(["gone", "s0"]),
      immediateIds: new Set(["s19", "not-wanted"]),
      perFrame: 1,
    });
    expect([...next]).toEqual(["s0", "s1", "s19"]);
  });
});
