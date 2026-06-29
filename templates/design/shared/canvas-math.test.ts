import { describe, expect, it } from "vitest";

import {
  assignRegions,
  canvasToScreenPoint,
  computeMoveSnap,
  computeResizeSnap,
  DEFAULT_ASSIGNED_REGION_GAP,
  getAngleFromCenter,
  getCameraForBounds,
  getFrameGroupBounds,
  getNudgeDelta,
  getPanForZoomToCursor,
  getRotatedFrameAngle,
  getRotateFrameMetadata,
  getRulerTicks,
  resizeFrameFromDelta,
  resizeFrameGroupFromDelta,
  screenToCanvasPoint,
  shouldShowPixelGrid,
  snapAngleToIncrement,
} from "./canvas-math";

describe("canvas camera math", () => {
  it("round-trips between screen and canvas coordinates", () => {
    const camera = { x: -80, y: 42, zoom: 150 };
    const origin = { x: 12, y: 20 };
    const canvasPoint = { x: 240, y: 360 };

    const screenPoint = canvasToScreenPoint(canvasPoint, camera, origin, 240);
    expect(screenToCanvasPoint(screenPoint, camera, origin, 240)).toEqual(
      canvasPoint,
    );
  });

  it("keeps the point under the cursor fixed when zooming", () => {
    const pan = { x: -100, y: 80 };
    const cursor = { x: 320, y: 240 };
    const nextPan = getPanForZoomToCursor({
      pan,
      cursor,
      oldZoom: 100,
      nextZoom: 200,
    });

    const before = screenToCanvasPoint(cursor, { ...pan, zoom: 100 });
    const after = screenToCanvasPoint(cursor, { ...nextPan, zoom: 200 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe("canvas snap and resize math", () => {
  it("uses a screen-space snap threshold across zoom levels", () => {
    const stationary = [
      { id: "target", geometry: { x: 200, y: 0, width: 100, height: 100 } },
    ];

    expect(
      computeMoveSnap(
        [{ id: "moving", geometry: { x: 96, y: 0, width: 100, height: 100 } }],
        stationary,
        { thresholdScreenPx: 6, zoom: 200 },
      ).dx,
    ).toBe(0);

    expect(
      computeMoveSnap(
        [{ id: "moving", geometry: { x: 98, y: 0, width: 100, height: 100 } }],
        stationary,
        { thresholdScreenPx: 6, zoom: 200 },
      ).dx,
    ).toBe(2);
  });

  it("resizes from each handle and clamps to the minimum frame size", () => {
    expect(
      resizeFrameFromDelta(
        { x: 100, y: 100, width: 320, height: 240 },
        "nw",
        20,
        30,
      ),
    ).toEqual({ x: 120, y: 130, width: 300, height: 210 });

    expect(
      resizeFrameFromDelta(
        { x: 100, y: 100, width: 150, height: 150 },
        "w",
        80,
        0,
      ),
    ).toEqual({ x: 130, y: 100, width: 120, height: 150 });
  });

  it("snaps resizing edges to sibling edges", () => {
    const snap = computeResizeSnap(
      { x: 0, y: 0, width: 198, height: 100 },
      [{ id: "target", geometry: { x: 200, y: 0, width: 120, height: 120 } }],
      "e",
      { thresholdScreenPx: 6, zoom: 100 },
    );

    expect(snap.frame.width).toBe(200);
    expect(snap.guides).toEqual([
      expect.objectContaining({ orientation: "vertical", position: 200 }),
    ]);
  });

  it("can bypass move and resize snapping", () => {
    const target = [
      { id: "target", geometry: { x: 200, y: 0, width: 100, height: 100 } },
    ];

    expect(
      computeMoveSnap(
        [{ id: "moving", geometry: { x: 98, y: 0, width: 100, height: 100 } }],
        target,
        { thresholdScreenPx: 6, zoom: 100, bypass: true },
      ),
    ).toEqual({ dx: 0, dy: 0, guides: [] });

    expect(
      computeResizeSnap({ x: 0, y: 0, width: 198, height: 100 }, target, "e", {
        thresholdScreenPx: 6,
        zoom: 100,
        bypass: true,
      }),
    ).toEqual({
      frame: { x: 0, y: 0, width: 198, height: 100 },
      guides: [],
    });
  });

  it("preserves aspect ratio and resizes from center with modifiers", () => {
    expect(
      resizeFrameFromDelta(
        { x: 100, y: 100, width: 320, height: 160 },
        "se",
        80,
        10,
        { preserveAspectRatio: true },
      ),
    ).toEqual({ x: 100, y: 100, width: 400, height: 200 });

    expect(
      resizeFrameFromDelta(
        { x: 100, y: 100, width: 320, height: 160 },
        "e",
        40,
        0,
        { resizeFromCenter: true },
      ),
    ).toEqual({ x: 60, y: 100, width: 400, height: 160 });
  });

  it("scales selected frames together when resizing group bounds", () => {
    const result = resizeFrameGroupFromDelta(
      [
        { id: "a", geometry: { x: 0, y: 0, width: 200, height: 120 } },
        { id: "b", geometry: { x: 300, y: 120, width: 120, height: 120 } },
      ],
      { x: 0, y: 0, width: 420, height: 240 },
      "se",
      420,
      240,
    );

    expect(result.bounds).toEqual({ x: 0, y: 0, width: 840, height: 480 });
    expect(result.frames).toEqual([
      { id: "a", geometry: { x: 0, y: 0, width: 400, height: 240 } },
      { id: "b", geometry: { x: 600, y: 240, width: 240, height: 240 } },
    ]);
  });
});

describe("canvas rotation math", () => {
  it("computes pointer angle from a rotation center", () => {
    const center = { x: 50, y: 50 };

    expect(getAngleFromCenter(center, { x: 100, y: 50 })).toBeCloseTo(0);
    expect(getAngleFromCenter(center, { x: 50, y: 100 })).toBeCloseTo(90);
    expect(getAngleFromCenter(center, { x: 0, y: 50 })).toBeCloseTo(180);
    expect(getAngleFromCenter(center, { x: 50, y: 0 })).toBeCloseTo(-90);
  });

  it("snaps rotation to 15 degrees only while shift is held", () => {
    expect(snapAngleToIncrement(37)).toBe(37);
    expect(snapAngleToIncrement(37, { shiftKey: true })).toBe(30);
    expect(snapAngleToIncrement(38, { shiftKey: true })).toBe(45);
  });

  it("returns typed rotate metadata and snapped frame rotation results", () => {
    const metadata = getRotateFrameMetadata(
      { id: "frame", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { x: 100, y: 50 },
      { initialRotation: 10 },
    );

    expect(metadata).toEqual({
      id: "frame",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      center: { x: 50, y: 50 },
      startAngle: 0,
      initialRotation: 10,
    });

    expect(
      getRotatedFrameAngle(metadata, { x: 50, y: 100 }, { shiftKey: true }),
    ).toEqual({
      id: "frame",
      angle: 105,
      rawAngle: 100,
      delta: 90,
      snapped: true,
    });
  });
});

describe("canvas group bounds and camera math", () => {
  it("computes the bounding box for selected frames", () => {
    expect(
      getFrameGroupBounds([
        { id: "a", geometry: { x: 10, y: 20, width: 100, height: 80 } },
        { id: "b", geometry: { x: -40, y: 50, width: 30, height: 90 } },
      ]),
    ).toEqual({
      left: -40,
      top: 20,
      right: 110,
      bottom: 140,
      width: 150,
      height: 120,
      centerX: 35,
      centerY: 80,
    });
  });

  it("fits bounds into the viewport using the canvas camera convention", () => {
    expect(
      getCameraForBounds(
        { x: 100, y: 50, width: 200, height: 100 },
        { width: 500, height: 300 },
        { paddingScreenPx: 50, canvasPadding: 20 },
      ),
    ).toEqual({ x: -190, y: -90, zoom: 200 });
  });

  it.each([1, 2, 3, 5, 8])(
    "assigns %i non-overlapping agent canvas regions",
    (count) => {
      const regions = assignRegions(count);

      expect(regions).toHaveLength(count);
      expect(assignRegions(count)).toEqual(regions);

      for (const [index, region] of regions.entries()) {
        expect(region.index).toBe(index);
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);

        if (index === 0) continue;

        const previous = regions[index - 1]!;
        if (region.row === previous.row) {
          expect(region.x).toBeGreaterThan(previous.x);
        } else {
          expect(region.y).toBeGreaterThan(previous.y);
          expect(region.x).toBe(regions[0]!.x);
        }
      }

      for (let a = 0; a < regions.length; a += 1) {
        for (let b = a + 1; b < regions.length; b += 1) {
          expectRegionsDoNotOverlap(regions[a]!, regions[b]!);
          expectRegionsHaveGenerousGap(regions[a]!, regions[b]!);
        }
      }
    },
  );

  it("keeps earlier agent canvas regions stable as sessions grow", () => {
    const eightRegions = assignRegions(8);

    for (const count of [1, 2, 3, 5]) {
      expect(assignRegions(count)).toEqual(eightRegions.slice(0, count));
    }
  });
});

describe("canvas ruler and pixel grid math", () => {
  it("returns visible ruler ticks whose labels track pan and zoom", () => {
    expect(
      getRulerTicks(
        { x: -50, y: 25, zoom: 100 },
        { width: 300, height: 200 },
        { minTickSpacingPx: 64 },
      ),
    ).toEqual({
      x: [
        { value: 100, position: 50, label: "100" },
        { value: 200, position: 150, label: "200" },
        { value: 300, position: 250, label: "300" },
      ],
      y: [
        { value: 0, position: 25, label: "0" },
        { value: 100, position: 125, label: "100" },
      ],
    });

    expect(
      getRulerTicks(
        { x: -50, y: 25, zoom: 200 },
        { width: 300, height: 200 },
        { minTickSpacingPx: 64 },
      ).x,
    ).toEqual([
      { value: 50, position: 50, label: "50" },
      { value: 100, position: 150, label: "100" },
      { value: 150, position: 250, label: "150" },
    ]);
  });

  it("shows the pixel grid only at high zoom", () => {
    expect(shouldShowPixelGrid(799)).toBe(false);
    expect(shouldShowPixelGrid(800)).toBe(true);
  });
});

describe("canvas nudge math", () => {
  it("maps arrow keys to deltas and multiplies by shift", () => {
    expect(getNudgeDelta("ArrowLeft")).toEqual({
      dx: -1,
      dy: 0,
      step: 1,
      snap: { bypass: false, reason: null },
    });
    expect(getNudgeDelta("ArrowDown", { shiftKey: true })).toEqual({
      dx: 0,
      dy: 10,
      step: 10,
      snap: { bypass: false, reason: null },
    });
  });

  it("marks snap bypass metadata when a bypass modifier is held", () => {
    expect(getNudgeDelta("ArrowRight", { altKey: true })).toEqual({
      dx: 1,
      dy: 0,
      step: 1,
      snap: { bypass: true, reason: "modifier" },
    });
  });
});

type TestRegion = ReturnType<typeof assignRegions>[number];

function expectRegionsDoNotOverlap(a: TestRegion, b: TestRegion) {
  expect(
    a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y,
  ).toBe(true);
}

function expectRegionsHaveGenerousGap(a: TestRegion, b: TestRegion) {
  const verticalOverlap = rangesOverlap(
    a.y,
    a.y + a.height,
    b.y,
    b.y + b.height,
  );
  const horizontalOverlap = rangesOverlap(
    a.x,
    a.x + a.width,
    b.x,
    b.x + b.width,
  );

  if (verticalOverlap) {
    const horizontalGap =
      Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
    expect(horizontalGap).toBeGreaterThanOrEqual(DEFAULT_ASSIGNED_REGION_GAP);
  }

  if (horizontalOverlap) {
    const verticalGap =
      Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
    expect(verticalGap).toBeGreaterThanOrEqual(DEFAULT_ASSIGNED_REGION_GAP);
  }
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}
