import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  clampFrameGeometryToViewport,
  computeBoundedScreenCullState,
  computeScreenCullTier,
  getScreenContentCullState,
  getOverscannedViewportCanvasBounds,
  isFrameWithinOverscannedViewport,
  OVERVIEW_CULLING_ENABLED,
  OVERVIEW_CULLING_OVERSCAN_FACTOR,
  OVERVIEW_LIVE_IFRAME_BUDGET,
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

  it("uses a generous (>=1.5x) overscan factor by default", () => {
    expect(OVERVIEW_CULLING_OVERSCAN_FACTOR).toBeGreaterThanOrEqual(1.5);
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
      "iframeCount: 1 + (screen.breakpointWidths?.length ?? 0)",
    );
    expect(
      source.match(/loading=\{cullTier === "visible" \? "eager" : "lazy"\}/g),
    ).toHaveLength(2);
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
        protectedIds?: ReadonlySet<string>;
        previous?: ReturnType<typeof computeBoundedScreenCullState>;
        epoch?: number;
        budget?: number;
      } = {},
    ) {
      return computeBoundedScreenCullState({
        candidates,
        viewport: options.viewport === undefined ? viewport : options.viewport,
        protectedScreenIds: options.protectedIds ?? new Set(),
        previousLiveScreenIds:
          options.previous?.liveScreenIds ?? new Set<string>(),
        everVisibleScreenIds:
          options.previous?.everVisibleScreenIds ?? new Set<string>(),
        lastVisibleEpochByScreenId:
          options.previous?.lastVisibleEpochByScreenId ??
          new Map<string, number>(),
        accessEpoch: options.epoch ?? 1,
        liveIframeBudget: options.budget,
      });
    }

    it("caps a 120-screen viewport at the explicit live-context budget", () => {
      const candidates = Array.from({ length: 120 }, (_, index) =>
        candidate(`screen-${String(index).padStart(3, "0")}`, index * 500),
      );
      const result = compute(candidates);

      expect(OVERVIEW_LIVE_IFRAME_BUDGET).toBeGreaterThan(0);
      expect(result.liveScreenIds.size).toBe(OVERVIEW_LIVE_IFRAME_BUDGET);
      expect(result.mountedIframeCount).toBe(OVERVIEW_LIVE_IFRAME_BUDGET);
      expect(
        [...result.tierByScreenId.values()].filter(
          (tier) => tier === "visible",
        ),
      ).toHaveLength(OVERVIEW_LIVE_IFRAME_BUDGET);
      expect(
        [...result.tierByScreenId.values()].filter(
          (tier) => tier === "placeholder",
        ),
      ).toHaveLength(120 - OVERVIEW_LIVE_IFRAME_BUDGET);
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

      // Screen groups remain atomic: two groups x (base + three breakpoints)
      // fit, while a third would cross the 10-context cap.
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
      // Visible world rect is [0,1000]x[0,800] before overscan/padding.
      // Overscan adds 1.5x the viewport size in each direction.
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
      // Panning the world left (-x) reveals content further right in world
      // space, i.e. the visible rect's world-space left edge increases.
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
      // Frame spans x:[-100, 220] (width 320) — overlaps the left edge.
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
      // Frame's right edge exactly equals viewport.left (0): right=0 >= left=0.
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
      // A 640-wide x 100-tall frame at (100, 280): unrotated its AABB is
      // [100,740]x[280,380], fully above a viewport starting at top=400 (no
      // intersection). Rotated 90 degrees around its own center, the AABB
      // becomes ~100 wide x 640 tall centered at the same point, stretching
      // down to y=650 -- which does intersect a viewport starting at
      // top=400. If this helper used the unrotated rect it would wrongly
      // report "not visible" for the rotated case too.
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
      // alwaysVisible is resolved by the caller from (isActive || isSelected);
      // this test exercises the same override path via alwaysVisible=true.
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
      // Simulate the frame having become visible in between (e.g. it was
      // selected, or panned into view), then panned back out again.
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

      // A screen positioned far away from the panned-to region (10 screen
      // widths further right) should be culled.
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

      // Raw visible rect (ignoring overscan) is roughly [0,1200]x[0,800] in
      // world space (before SURFACE_PADDING offset). Place a screen just
      // past that raw edge but still within the >=1.5x overscan margin.
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
      // Reproduces the smoke-test symptom: a degenerate camera sends
      // getCanvasPoint's world coordinates to ±65536-ish.
      const geometry = geom(65536, -65536, 320, 640);
      const clamped = clampFrameGeometryToViewport(
        geometry,
        sanePanZoomViewport,
      );
      expect(clamped.width).toBe(320);
      expect(clamped.height).toBe(640);
      // Centered within the 1200x800 viewport.
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
