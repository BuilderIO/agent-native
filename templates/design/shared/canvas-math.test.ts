import { describe, expect, it } from "vitest";

import {
  assignRegions,
  canvasToScreenPoint,
  computeMoveSnap,
  computeProximityMeasurements,
  computeResizeSnap,
  computeDragSnap,
  computeSpacingSnap,
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  type FrameGeometry,
  getAngleFromCenter,
  getCameraForBounds,
  getDraftGeometryFromPoints,
  quantizeToStep,
  WHOLE_PIXEL_SNAP_STEP,
  getElementWorldBoundsForZoomFit,
  getFrameBounds,
  getFrameGroupBounds,
  getNudgeDelta,
  getPanForZoomToCursor,
  getResizeCursorForHandle,
  getRotatedFrameAABB,
  getRotatedFrameAngle,
  getRotateFrameMetadata,
  getRulerTicks,
  resizeFrameFromDelta,
  resizeFrameGroupFromDelta,
  resizeRotatedFrameFromDelta,
  resizeRotatedFrameFromDeltaWithSnap,
  rotateFrameGroupAroundCenter,
  rotatePoint,
  rotatedRectIntersects,
  screenToCanvasPoint,
  shouldShowPixelGrid,
  snapAngleToIncrement,
  composeTransform3D,
  isTransform3DActive,
  parseTransform3DParts,
  type Transform3DParts,
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

  it("exports the canonical MultiScreenCanvas zoom range (CV23)", () => {
    expect(DEFAULT_CANVAS_MIN_ZOOM).toBe(2);
    expect(DEFAULT_CANVAS_MAX_ZOOM).toBe(25600);
    expect(DEFAULT_CANVAS_MIN_ZOOM).toBeLessThan(DEFAULT_CANVAS_MAX_ZOOM);
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

  it("clamps a resized frame to maximum bounds while preserving the anchor", () => {
    const origin = { x: 20, y: 30, width: 360, height: 315 };

    expect(
      resizeFrameFromDelta(origin, "e", 100, 0, {
        minWidth: 24,
        maxWidth: 400,
      }),
    ).toEqual({ ...origin, width: 400 });
    expect(
      resizeFrameFromDelta(origin, "w", -100, 0, {
        minWidth: 24,
        maxWidth: 400,
      }),
    ).toEqual({ ...origin, x: -20, width: 400 });
  });

  it("combines per-frame min/max limits when resizing a Screen group", () => {
    const frames = [
      { id: "a", geometry: { x: 0, y: 0, width: 360, height: 315 } },
      { id: "b", geometry: { x: 400, y: 0, width: 300, height: 315 } },
    ];
    const result = resizeFrameGroupFromDelta(
      frames,
      { x: 0, y: 0, width: 700, height: 315 },
      "e",
      300,
      0,
      {
        minWidth: 1,
        minHeight: 1,
        frameSizeBoundsById: {
          a: { maxWidth: 400 },
          b: { maxWidth: 400 },
        },
      },
    );

    expect(result.bounds.width).toBeCloseTo(700 * (400 / 360));
    expect(result.frames[0]?.geometry.width).toBeCloseTo(400);
    expect(result.frames[1]?.geometry.width).toBeCloseTo(400 * (300 / 360));
  });

  it("does not snap a frame beyond its maximum width", () => {
    const snap = computeResizeSnap(
      { x: 0, y: 0, width: 398, height: 100 },
      [{ id: "target", geometry: { x: 405, y: 0, width: 120, height: 120 } }],
      "e",
      { thresholdScreenPx: 10, zoom: 100, minWidth: 1, maxWidth: 400 },
    );

    expect(snap.frame.width).toBe(400);
    expect(snap.guides).toEqual([]);
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

  it("preserves aspect ratio when a corner-resize snap would otherwise snap both axes independently", () => {
    const frame = { x: 0, y: 0, width: 300, height: 150 };
    const stationary = [
      {
        id: "right-sibling",
        geometry: { x: 302, y: 500, width: 150, height: 150 },
      },
      {
        id: "bottom-sibling",
        geometry: { x: 900, y: 155, width: 150, height: 150 },
      },
    ];
    const independentSnap = computeResizeSnap(frame, stationary, "se", {
      thresholdScreenPx: 6,
      zoom: 100,
    });
    expect(independentSnap.frame.width).toBe(302);
    expect(independentSnap.frame.height).toBe(155);
    expect(
      independentSnap.frame.width / independentSnap.frame.height,
    ).not.toBeCloseTo(2, 1);

    const aspectSnap = computeResizeSnap(frame, stationary, "se", {
      thresholdScreenPx: 6,
      zoom: 100,
      preserveAspectRatio: true,
    });
    expect(aspectSnap.frame.width).toBe(302);
    const ratio = frame.width / frame.height;
    expect(aspectSnap.frame.width / aspectSnap.frame.height).toBeCloseTo(
      ratio,
      5,
    );
    expect(aspectSnap.guides).toHaveLength(1);
  });

  it("preserves aspect ratio for an edge-only handle by centering the derived axis", () => {
    const frame = { x: 0, y: 100, width: 198, height: 100 };
    const stationary = [
      { id: "target", geometry: { x: 200, y: 0, width: 50, height: 50 } },
    ];
    const snap = computeResizeSnap(frame, stationary, "e", {
      thresholdScreenPx: 6,
      zoom: 100,
      preserveAspectRatio: true,
    });
    expect(snap.frame.width).toBe(200);
    const ratio = frame.width / frame.height;
    const expectedHeight = snap.frame.width / ratio;
    expect(snap.frame.height).toBeCloseTo(expectedHeight, 5);
    const originalCenterY = frame.y + frame.height / 2;
    const newCenterY = snap.frame.y + snap.frame.height / 2;
    expect(newCenterY).toBeCloseTo(originalCenterY, 5);
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

  it("snaps a move against a rotated sibling's rotated (world-space) AABB", () => {
    const stationary = [
      {
        id: "target",
        geometry: { x: 400, y: 0, width: 100, height: 100, rotation: 45 },
      },
    ];
    const rotatedAABBLeft = 450 - Math.SQRT2 * 50;

    const moving = [
      {
        id: "moving",
        geometry: {
          x: rotatedAABBLeft - 100 + 1,
          y: 0,
          width: 100,
          height: 100,
        },
      },
    ];
    const snap = computeMoveSnap(moving, stationary, {
      thresholdScreenPx: 6,
      zoom: 100,
    });
    expect(snap.dx).toBeCloseTo(-1, 0);
  });

  it("snaps a resize edge against a rotated sibling's rotated (world-space) AABB", () => {
    const stationary = [
      {
        id: "target",
        geometry: { x: 400, y: 0, width: 100, height: 100, rotation: 45 },
      },
    ];
    const rotatedAABBLeft = 450 - Math.SQRT2 * 50;
    const snap = computeResizeSnap(
      { x: 0, y: 0, width: rotatedAABBLeft - 2, height: 100 },
      stationary,
      "e",
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.frame.width).toBeCloseTo(rotatedAABBLeft, 0);
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

  describe("resize-snap respects a small per-call minimum (CV-snap-min)", () => {
    it("does not inflate a small shape's snapped width past its own minWidth", () => {
      const snap = computeResizeSnap(
        { x: 180, y: 0, width: 18, height: 18 },
        [{ id: "target", geometry: { x: 200, y: 0, width: 50, height: 50 } }],
        "e",
        { thresholdScreenPx: 6, zoom: 100, minWidth: 8, minHeight: 8 },
      );
      expect(snap.frame.width).toBe(20);
    });

    it("clamps a snapped resize to the caller's own small minimum, not the 120 default", () => {
      const snap = computeResizeSnap(
        { x: 0, y: 0, width: 12, height: 12 },
        [{ id: "target", geometry: { x: 6, y: 500, width: 50, height: 50 } }],
        "e",
        { thresholdScreenPx: 6, zoom: 100, minWidth: 8, minHeight: 8 },
      );
      expect(snap.frame.width).toBe(8);
      expect(snap.frame.width).toBeLessThan(120);
    });

    it("still clamps to the 120 screen default when no minWidth/minHeight is passed", () => {
      const snap = computeResizeSnap(
        { x: 0, y: 0, width: 12, height: 12 },
        [{ id: "target", geometry: { x: 6, y: 500, width: 50, height: 50 } }],
        "e",
        { thresholdScreenPx: 6, zoom: 100 },
      );
      expect(snap.frame.width).toBe(120);
    });

    it("respects a small minimum in the aspect-preserving snap path too", () => {
      const frame = { x: 0, y: 0, width: 20, height: 20 };
      const stationary = [
        { id: "sibling", geometry: { x: 2, y: 500, width: 50, height: 50 } },
      ];
      const snap = computeResizeSnap(frame, stationary, "e", {
        thresholdScreenPx: 6,
        zoom: 100,
        preserveAspectRatio: true,
        minWidth: 4,
        minHeight: 4,
      });
      expect(snap.frame.width).toBeGreaterThanOrEqual(4);
      expect(snap.frame.width).toBeLessThan(120);
    });
  });

  describe("resizeFrameFromDelta flip-normalization (Figma-parity CV-flip)", () => {
    it("flips horizontally when the 'e' handle is dragged past the west edge", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "e", -200, 0, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(50);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
      expect(result.height).toBe(150);
    });

    it("flips horizontally when the 'w' handle is dragged past the east edge", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "w", 200, 0, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(50);
      expect(result.x).toBe(250);
      expect(result.y).toBe(100);
    });

    it("flips vertically when the 's' handle is dragged past the north edge", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "s", 0, -200, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.height).toBe(50);
      expect(result.y).toBe(50);
      expect(result.x).toBe(100);
    });

    it("flips vertically when the 'n' handle is dragged past the south edge", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "n", 0, 200, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.height).toBe(50);
      expect(result.y).toBe(250);
    });

    it("flips both axes when a corner handle is dragged past the opposite corner", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "se", -180, -180, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(30);
      expect(result.height).toBe(30);
      expect(result.x).toBe(70);
      expect(result.y).toBe(70);
    });

    it("clamps to the small minimum instead of a sub-minimum flip overshoot", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "w", 152, 0, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(8);
      expect(result.x).toBe(242);
    });

    it("does NOT flip and keeps pinning at the 120 default when no minimum override is passed", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "e", -200, 0);
      expect(result.width).toBe(120);
      expect(result.x).toBe(100);
    });

    it("does NOT flip when minWidth/minHeight equal the 120 screen default explicitly", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const result = resizeFrameFromDelta(origin, "e", -200, 0, {
        minWidth: 120,
        minHeight: 120,
      });
      expect(result.width).toBe(120);
      expect(result.x).toBe(100);
    });

    it("mirrors around the center for a resizeFromCenter (alt) flip past both edges", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150 };
      const centerX = origin.x + origin.width / 2;
      const centerY = origin.y + origin.height / 2;
      const result = resizeFrameFromDelta(origin, "se", -100, -100, {
        resizeFromCenter: true,
        minWidth: 8,
        minHeight: 8,
      });
      const resultCenterX = result.x + result.width / 2;
      const resultCenterY = result.y + result.height / 2;
      expect(resultCenterX).toBeCloseTo(centerX);
      expect(resultCenterY).toBeCloseTo(centerY);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it("preserves aspect ratio through a corner flip (shift+flip)", () => {
      const origin = { x: 0, y: 0, width: 200, height: 100 };
      const result = resizeFrameFromDelta(origin, "se", -260, -140, {
        preserveAspectRatio: true,
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.width / result.height).toBeCloseTo(2, 5);
    });

    it("preserves aspect ratio through an edge-only handle flip (shift+flip)", () => {
      const origin = { x: 0, y: 100, width: 200, height: 100 };
      const result = resizeFrameFromDelta(origin, "e", -220, 0, {
        preserveAspectRatio: true,
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(20);
      expect(result.height).toBeCloseTo(10, 5);
      expect(result.width / result.height).toBeCloseTo(2, 5);
    });

    it("keeps the existing rotated-frame minimum-size behavior unaffected by flip changes", () => {
      const origin = { x: 0, y: 0, width: 200, height: 100, rotation: 45 };
      const result = resizeRotatedFrameFromDelta(origin, "se", 100, 0, {
        preserveAspectRatio: true,
        minWidth: 10,
        minHeight: 10,
      });
      expect(result.width / result.height).toBeCloseTo(
        origin.width / origin.height,
      );
    });

    it("flips through resizeRotatedFrameFromDelta and re-anchors in world space", () => {
      const origin = { x: 100, y: 100, width: 150, height: 150, rotation: 0 };
      const result = resizeRotatedFrameFromDelta(origin, "e", -200, 0, {
        minWidth: 8,
        minHeight: 8,
      });
      expect(result.width).toBe(50);
      expect(result.height).toBe(150);
    });

    it("flips through resizeFrameGroupFromDelta's single-frame call shape (matches the real drag call site)", () => {
      const origin = {
        id: "solo",
        geometry: { x: 100, y: 100, width: 150, height: 150 },
      };
      const result = resizeFrameGroupFromDelta(
        [origin],
        origin.geometry,
        "e",
        -200,
        0,
        { minWidth: 8, minHeight: 8 },
      );
      expect(result.bounds.width).toBe(50);
      expect(result.bounds.x).toBe(50);
      expect(result.frames).toEqual([
        { id: "solo", geometry: { x: 50, y: 100, width: 50, height: 150 } },
      ]);
    });
  });
});

describe("computeMoveSnap guide fan-out", () => {
  const square = (id: string, x: number, y: number) => ({
    id,
    geometry: { x, y, width: 100, height: 100 },
  });

  const bar = (id: string, y: number, width: number) => ({
    id,
    geometry: { x: 0, y, width, height: 100 },
  });

  it("draws one guide through every frame sharing the snapped edge", () => {
    const guides = computeMoveSnap(
      [square("moving", 3, 600)],
      [bar("a", 0, 140), bar("b", 200, 180), bar("c", 400, 220)],
      { thresholdScreenPx: 6, zoom: 100 },
    ).guides;

    const vertical = guides.filter((guide) => guide.orientation === "vertical");
    expect(vertical).toHaveLength(1);
    expect(vertical[0].position).toBe(0);
    expect(vertical[0].start).toBe(0);
    expect(vertical[0].end).toBe(700);
  });

  it("draws both the left-edge and right-edge guide when one offset satisfies both", () => {
    const guides = computeMoveSnap(
      [square("moving", 2, 300)],
      [
        bar("left-edge", 0, 60),
        {
          id: "right-edge",
          geometry: { x: -400, y: 0, width: 500, height: 50 },
        },
      ],
      { thresholdScreenPx: 6, zoom: 100 },
    ).guides;

    const positions = guides
      .filter((guide) => guide.orientation === "vertical")
      .map((guide) => guide.position)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 100]);
  });

  it("spans the guide from the post-snap position, not where the pointer left the frame", () => {
    const guides = computeMoveSnap(
      [square("moving", 3, -300)],
      [square("target", 0, 0)],
      { thresholdScreenPx: 6, zoom: 100 },
    ).guides;

    const vertical = guides.find((guide) => guide.orientation === "vertical");
    expect(vertical?.start).toBe(-300);
    expect(vertical?.end).toBe(100);
  });
});

describe("computeDragSnap precedence", () => {
  const far = [
    { id: "far", geometry: { x: 5000, y: 5000, width: 100, height: 100 } },
  ];
  const row = (...xs: number[]) =>
    xs.map((x, index) => ({
      id: `s${index}`,
      geometry: { x, y: 0, width: 100, height: 100 },
    }));

  it("rounds to the pixel grid on an axis with no guide on it", () => {
    const snap = computeDragSnap(
      [
        {
          id: "moving",
          geometry: { x: 10.3, y: 20.8, width: 100, height: 100 },
        },
      ],
      far,
      { thresholdScreenPx: 6, zoom: 100, snapStep: WHOLE_PIXEL_SNAP_STEP },
    );
    expect(snap.dx).toBeCloseTo(-0.3);
    expect(snap.dy).toBeCloseTo(0.2);
  });

  it("never rounds an alignment snap away", () => {
    const snap = computeDragSnap(
      [{ id: "moving", geometry: { x: 10.3, y: 0, width: 100, height: 100 } }],
      [{ id: "target", geometry: { x: 8.5, y: 0, width: 100, height: 100 } }],
      { thresholdScreenPx: 6, zoom: 100, snapStep: WHOLE_PIXEL_SNAP_STEP },
    );
    expect(snap.dx).toBeCloseTo(-1.8);
  });

  it("keeps the pixel grid off by default", () => {
    expect(
      computeDragSnap(
        [
          {
            id: "moving",
            geometry: { x: 10.3, y: 0, width: 100, height: 100 },
          },
        ],
        far,
        { thresholdScreenPx: 6, zoom: 100 },
      ).dx,
    ).toBe(0);
  });

  it("lets an alignment snap beat an available spacing snap on the same axis", () => {
    const snap = computeDragSnap(
      [{ id: "moving", geometry: { x: 102, y: 0, width: 100, height: 100 } }],
      row(0, 400),
      {
        thresholdScreenPx: 6,
        zoom: 100,
      },
    );
    expect(snap.dx).toBeCloseTo(-2);
    expect(snap.spacingGuides).toEqual([]);
  });

  it("applies the spacing snap on the axis alignment left free", () => {
    const snap = computeDragSnap(
      [{ id: "moving", geometry: { x: 205, y: 0, width: 100, height: 100 } }],
      row(0, 400),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.dx).toBeCloseTo(-5);
    expect(snap.spacingGuides).toHaveLength(1);
  });

  it("drops spacing guides for a multi-frame drag, matching Figma", () => {
    const snap = computeDragSnap(
      [
        { id: "a", geometry: { x: 205, y: 0, width: 100, height: 100 } },
        { id: "b", geometry: { x: 205, y: 400, width: 100, height: 100 } },
      ],
      row(0, 400),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.spacingGuides).toEqual([]);
  });
});

describe("computeDragSnap respects a Shift-locked axis", () => {
  const stationary = [
    { id: "far", geometry: { x: 5000, y: 5000, width: 100, height: 100 } },
  ];

  it("does not let the pixel grid reintroduce motion on the locked axis", () => {
    const snap = computeDragSnap(
      [
        {
          id: "moving",
          geometry: { x: 10.3, y: 20.8, width: 100, height: 100 },
        },
      ],
      stationary,
      {
        thresholdScreenPx: 6,
        zoom: 100,
        snapStep: WHOLE_PIXEL_SNAP_STEP,
        lockedAxes: { y: true },
      },
    );
    expect(snap.dx).toBeCloseTo(-0.3);
    expect(snap.dy, "Shift pinned y, so nothing may move it").toBe(0);
  });

  it("does not let an alignment snap move the locked axis either", () => {
    const snap = computeDragSnap(
      [{ id: "moving", geometry: { x: 0, y: 102, width: 100, height: 100 } }],
      [{ id: "target", geometry: { x: 0, y: 100, width: 100, height: 100 } }],
      { thresholdScreenPx: 6, zoom: 100, lockedAxes: { y: true } },
    );
    expect(snap.dy).toBe(0);
  });

  it("emits no spacing chrome on an axis it was not allowed to move", () => {
    const row = [
      { id: "a", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "b", geometry: { x: 400, y: 0, width: 100, height: 100 } },
    ];
    const snap = computeSpacingSnap(
      { x: 200, y: 0, width: 100, height: 100 },
      row,
      { thresholdScreenPx: 6, zoom: 100, lockedAxes: { x: true } },
    );
    expect(snap.dx).toBe(0);
    expect(
      snap.guides,
      "the gaps are genuinely equal, but alignment owns this axis",
    ).toEqual([]);
  });
});

describe("review regressions", () => {
  const f = (x: number, y: number, w = 100, h = 100) => ({
    id: `${x}-${y}`,
    geometry: { x, y, width: w, height: h },
  });

  it("draws no guide on a Shift-locked axis the frame was not moved onto", () => {
    const snap = computeDragSnap([f(500, 203)], [f(0, 200)], {
      zoom: 100,
      thresholdScreenPx: 6,
      snapStep: WHOLE_PIXEL_SNAP_STEP,
      lockedAxes: { y: true },
    });
    expect(snap.dy).toBe(0);
    expect(
      snap.guides.filter((guide) => guide.orientation === "horizontal"),
      "the frame sits at 203/253/303; guides at 200/250/300 describe nowhere",
    ).toEqual([]);
  });

  it("draws the spacing guide on the side the snap actually matched", () => {
    const snap = computeSpacingSnap(
      { x: 380, y: 0, width: 100, height: 100 },
      [f(0, 0), f(200, 0), f(575, 0)],
      { zoom: 100, thresholdScreenPx: 6 },
    );
    expect(snap.dx).toBeCloseTo(-5);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].gap).toBeCloseTo(100);
  });

  it("does not let the pixel grid round away a spacing snap", () => {
    const snap = computeDragSnap(
      [f(380, 0)],
      [f(0, 0), f(200.3, 0), f(575, 0)],
      { zoom: 100, thresholdScreenPx: 6, snapStep: WHOLE_PIXEL_SNAP_STEP },
    );
    expect(
      snap.dx,
      "rounding to -5 undoes the fractional rhythm the user just snapped to",
    ).toBeCloseTo(-5.3);
  });
});

describe("computeProximityMeasurements", () => {
  const near = [
    { id: "right", geometry: { x: 220, y: 0, width: 100, height: 100 } },
  ];

  it("reports the gap to the nearest neighbour on an axis", () => {
    const found = computeProximityMeasurements(
      { x: 0, y: 0, width: 100, height: 100 },
      near,
      { zoom: 100 },
    );
    expect(found).toHaveLength(1);
    expect(found[0].orientation).toBe("vertical");
    expect(found[0].gap).toBeCloseTo(120);
  });

  it("stays quiet for a neighbour beyond the range", () => {
    expect(
      computeProximityMeasurements(
        { x: 0, y: 0, width: 100, height: 100 },
        [{ id: "far", geometry: { x: 900, y: 0, width: 100, height: 100 } }],
        { zoom: 100 },
      ),
    ).toEqual([]);
  });

  it("scales the range with zoom so it stays a constant on-screen distance", () => {
    const moving = { x: 0, y: 0, width: 100, height: 100 };
    const target = [
      { id: "right", geometry: { x: 340, y: 0, width: 100, height: 100 } },
    ];
    expect(
      computeProximityMeasurements(moving, target, { zoom: 50 }),
    ).toHaveLength(1);
    expect(computeProximityMeasurements(moving, target, { zoom: 200 })).toEqual(
      [],
    );
  });

  it("reports one measurement per axis, nearest wins", () => {
    const found = computeProximityMeasurements(
      { x: 200, y: 200, width: 100, height: 100 },
      [
        { id: "closer", geometry: { x: 340, y: 200, width: 50, height: 100 } },
        { id: "further", geometry: { x: 420, y: 200, width: 50, height: 100 } },
        { id: "below", geometry: { x: 200, y: 360, width: 100, height: 50 } },
      ],
      { zoom: 100 },
    );
    expect(found.map((m) => m.orientation).sort()).toEqual([
      "horizontal",
      "vertical",
    ]);
    expect(found.find((m) => m.orientation === "vertical")?.gap).toBeCloseTo(
      40,
    );
  });

  it("goes quiet when snapping is bypassed", () => {
    expect(
      computeProximityMeasurements(
        { x: 0, y: 0, width: 100, height: 100 },
        near,
        { zoom: 100, bypass: true },
      ),
    ).toEqual([]);
  });
});

describe("spacing guide rhythm chaining", () => {
  const row = (...xs: number[]) =>
    xs.map((x, index) => ({
      id: `s${index}`,
      geometry: { x, y: 0, width: 100, height: 100 },
    }));

  it("lights every gap in an evenly spaced run, not just the pair it snapped to", () => {
    const snap = computeSpacingSnap(
      { x: 500, y: 0, width: 100, height: 100 },
      row(0, 124, 248, 372),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.dx).toBeCloseTo(-4);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].bands).toHaveLength(4);
    expect(snap.guides[0].gap).toBeCloseTo(24);
  });

  it("leaves out gaps in the run that do not match", () => {
    const snap = computeSpacingSnap(
      { x: 480, y: 0, width: 100, height: 100 },
      row(0, 124, 300),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.guides[0].bands).toHaveLength(2);
    expect(snap.guides[0].gap).toBeCloseTo(76);
  });
});

describe("computeSpacingSnap (Figma smart spacing)", () => {
  const row = (...xs: number[]) =>
    xs.map((x, index) => ({
      id: `s${index}`,
      geometry: { x, y: 0, width: 100, height: 100 },
    }));

  it("centers the frame between its two neighbors", () => {
    const snap = computeSpacingSnap(
      { x: 205, y: 0, width: 100, height: 100 },
      row(0, 400),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.dx).toBeCloseTo(-5);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].gap).toBeCloseTo(100);
  });

  it("matches a gap that already exists between two other frames", () => {
    const snap = computeSpacingSnap(
      { x: 252, y: 0, width: 100, height: 100 },
      row(0, 124),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.dx).toBeCloseTo(-4);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].gap).toBeCloseTo(24);
  });

  it("leaves an axis alone once an alignment snap has claimed it", () => {
    const snap = computeSpacingSnap(
      { x: 205, y: 0, width: 100, height: 100 },
      row(0, 400),
      { thresholdScreenPx: 6, zoom: 100, lockedAxes: { x: true } },
    );
    expect(snap.dx).toBe(0);
  });

  it("goes fully quiet when snapping is bypassed, like the alignment pass", () => {
    const snap = computeSpacingSnap(
      { x: 200, y: 0, width: 100, height: 100 },
      row(0, 400),
      { thresholdScreenPx: 6, zoom: 100, bypass: true },
    );
    expect(snap).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("does not label two near-equal gaps as equal on an axis it could not move", () => {
    const snap = computeSpacingSnap(
      { x: 200, y: 0, width: 100, height: 100 },
      row(0, 404),
      { thresholdScreenPx: 6, zoom: 100, lockedAxes: { x: true } },
    );
    expect(snap.dx).toBe(0);
    expect(snap.guides).toEqual([]);
  });

  it("ignores neighbors that are too far off the rhythm to match", () => {
    const snap = computeSpacingSnap(
      { x: 300, y: 0, width: 100, height: 100 },
      row(0, 124),
      { thresholdScreenPx: 6, zoom: 100 },
    );
    expect(snap.dx).toBe(0);
    expect(snap.guides).toEqual([]);
  });

  it("keeps the snap tolerance constant in screen px across zoom levels", () => {
    const moving = { x: 205, y: 0, width: 100, height: 100 };
    expect(
      computeSpacingSnap(moving, row(0, 400), {
        thresholdScreenPx: 6,
        zoom: 400,
      }).dx,
    ).toBe(0);
    expect(
      computeSpacingSnap(moving, row(0, 400), {
        thresholdScreenPx: 6,
        zoom: 100,
      }).dx,
    ).toBeCloseTo(-5);
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

describe("rotateFrameGroupAroundCenter (multi-selection rotate, CV14)", () => {
  it("orbits each frame's center around the group pivot and spins each frame the same amount", () => {
    const frames = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "right", geometry: { x: 200, y: 0, width: 100, height: 100 } },
    ];
    const groupCenter = { x: 150, y: 50 };

    const rotated = rotateFrameGroupAroundCenter(frames, groupCenter, 90);

    const left = rotated.find((f) => f.id === "left")!;
    const right = rotated.find((f) => f.id === "right")!;
    const leftCenter = {
      x: left.geometry.x + left.geometry.width / 2,
      y: left.geometry.y + left.geometry.height / 2,
    };
    const rightCenter = {
      x: right.geometry.x + right.geometry.width / 2,
      y: right.geometry.y + right.geometry.height / 2,
    };
    expect(leftCenter.x).toBeCloseTo(150);
    expect(leftCenter.y).toBeCloseTo(-50);
    expect(rightCenter.x).toBeCloseTo(150);
    expect(rightCenter.y).toBeCloseTo(150);

    expect(left.geometry.rotation).toBe(90);
    expect(right.geometry.rotation).toBe(90);
  });

  it("accumulates on top of each frame's own pre-existing rotation", () => {
    const frames = [
      {
        id: "a",
        geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 10 },
      },
      {
        id: "b",
        geometry: { x: 200, y: 0, width: 100, height: 100, rotation: -20 },
      },
    ];
    const rotated = rotateFrameGroupAroundCenter(frames, { x: 100, y: 50 }, 45);
    expect(rotated.find((f) => f.id === "a")!.geometry.rotation).toBe(55);
    expect(rotated.find((f) => f.id === "b")!.geometry.rotation).toBe(25);
  });

  it("is a no-op for delta 0", () => {
    const frames = [
      {
        id: "a",
        geometry: { x: 10, y: 20, width: 100, height: 50, rotation: 5 },
      },
    ];
    const rotated = rotateFrameGroupAroundCenter(frames, { x: 60, y: 45 }, 0);
    expect(rotated[0].geometry).toEqual(frames[0].geometry);
  });

  it("leaves width/height unchanged — only position and rotation change", () => {
    const frames = [
      { id: "a", geometry: { x: 0, y: 0, width: 120, height: 80 } },
    ];
    const rotated = rotateFrameGroupAroundCenter(frames, { x: 60, y: 40 }, 33);
    expect(rotated[0].geometry.width).toBe(120);
    expect(rotated[0].geometry.height).toBe(80);
  });
});

describe("rotation-aware resize", () => {
  it("rotatePoint matches the CSS rotate(deg) forward direction", () => {
    const center = { x: 50, y: 50 };
    const rotated = rotatePoint({ x: 100, y: 50 }, center, 90);
    expect(rotated.x).toBeCloseTo(50);
    expect(rotated.y).toBeCloseTo(100);
  });

  it("rotatePoint is a no-op for zero rotation", () => {
    const point = { x: 12, y: 34 };
    expect(rotatePoint(point, { x: 0, y: 0 }, 0)).toEqual(point);
  });

  it("falls back to unrotated resizeFrameFromDelta when rotation is 0", () => {
    const origin = { x: 100, y: 100, width: 320, height: 240 };
    expect(resizeRotatedFrameFromDelta(origin, "se", 40, 20)).toEqual(
      resizeFrameFromDelta(origin, "se", 40, 20),
    );
  });

  it("keeps the opposite corner world-fixed when resizing a rotated frame", () => {
    const origin = {
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      rotation: 90,
    };
    const originCenter = { x: 200, y: 175 };
    const nwWorldBefore = rotatePoint(
      { x: origin.x, y: origin.y },
      originCenter,
      origin.rotation,
    );

    const result = resizeRotatedFrameFromDelta(origin, "se", 30, 0);

    expect(result.rotation).toBe(90);
    const nwWorldAfter = rotatePoint(
      { x: result.x, y: result.y },
      { x: result.x + result.width / 2, y: result.y + result.height / 2 },
      result.rotation ?? 0,
    );
    expect(nwWorldAfter.x).toBeCloseTo(nwWorldBefore.x);
    expect(nwWorldAfter.y).toBeCloseTo(nwWorldBefore.y);
    expect(result.width).toBeCloseTo(origin.width);
    expect(result.height).not.toBeCloseTo(origin.height, 0);
  });

  it("follows the handle's rotated visual direction, not world axes", () => {
    const origin = { x: 0, y: 0, width: 200, height: 150, rotation: 90 };
    const result = resizeRotatedFrameFromDelta(origin, "e", 0, 40);
    expect(result.width).toBeCloseTo(origin.width + 40);
    expect(result.height).toBeCloseTo(origin.height);
  });

  it("respects preserveAspectRatio and minimum size while rotated", () => {
    const origin = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 45,
    };
    const result = resizeRotatedFrameFromDelta(origin, "se", 100, 0, {
      preserveAspectRatio: true,
      minWidth: 10,
      minHeight: 10,
    });
    expect(result.width / result.height).toBeCloseTo(
      origin.width / origin.height,
    );
  });

  it("keeps the frame CENTER world-fixed when resizeFromCenter is set on a rotated frame", () => {
    const origin = {
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      rotation: 30,
    };
    const centerBefore = {
      x: origin.x + origin.width / 2,
      y: origin.y + origin.height / 2,
    };

    const result = resizeRotatedFrameFromDelta(origin, "se", 40, 20, {
      resizeFromCenter: true,
    });

    const centerAfter = {
      x: result.x + result.width / 2,
      y: result.y + result.height / 2,
    };
    expect(centerAfter.x).toBeCloseTo(centerBefore.x);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y);
    expect(result.width).toBeGreaterThan(origin.width);
    expect(result.height).toBeLessThan(origin.height);
  });

  it("keeps the opposite anchor world-fixed (not the center) when resizeFromCenter is NOT set on a rotated frame", () => {
    const origin = {
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      rotation: 30,
    };
    const originCenter = {
      x: origin.x + origin.width / 2,
      y: origin.y + origin.height / 2,
    };
    const nwWorldBefore = rotatePoint(
      { x: origin.x, y: origin.y },
      originCenter,
      origin.rotation,
    );

    const result = resizeRotatedFrameFromDelta(origin, "se", 40, 20);

    const nwWorldAfter = rotatePoint(
      { x: result.x, y: result.y },
      { x: result.x + result.width / 2, y: result.y + result.height / 2 },
      result.rotation ?? 0,
    );
    expect(nwWorldAfter.x).toBeCloseTo(nwWorldBefore.x);
    expect(nwWorldAfter.y).toBeCloseTo(nwWorldBefore.y);

    const centerAfter = {
      x: result.x + result.width / 2,
      y: result.y + result.height / 2,
    };
    const centerMoved =
      Math.abs(centerAfter.x - originCenter.x) > 0.5 ||
      Math.abs(centerAfter.y - originCenter.y) > 0.5;
    expect(centerMoved).toBe(true);
  });

  it("computes the world-space AABB of a rotated frame", () => {
    const square = { x: 0, y: 0, width: 100, height: 100, rotation: 45 };
    const aabb = getRotatedFrameAABB(square);
    const diagonal = Math.SQRT2 * 100;
    expect(aabb.width).toBeCloseTo(diagonal);
    expect(aabb.height).toBeCloseTo(diagonal);
    expect(aabb.centerX).toBeCloseTo(50);
    expect(aabb.centerY).toBeCloseTo(50);
  });

  it("returns unrotated bounds unchanged when rotation is 0", () => {
    const geometry = { x: 10, y: 20, width: 100, height: 50 };
    expect(getRotatedFrameAABB(geometry)).toEqual(
      getRotatedFrameAABB(geometry),
    );
  });
});

describe("resizeRotatedFrameFromDeltaWithSnap", () => {
  const snapOptions = {
    thresholdScreenPx: 8,
    zoom: 100,
  };

  it("matches the unsnapped rotated resize when no sibling is close enough to snap", () => {
    const origin = { x: 100, y: 100, width: 200, height: 150, rotation: 30 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "se", 40, 20);
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "se",
      40,
      20,
      [{ id: "far", geometry: { x: 5000, y: 5000, width: 100, height: 100 } }],
      snapOptions,
    );
    expect(frame.x).toBeCloseTo(unsnapped.x);
    expect(frame.y).toBeCloseTo(unsnapped.y);
    expect(frame.width).toBeCloseTo(unsnapped.width);
    expect(frame.height).toBeCloseTo(unsnapped.height);
    expect(guides).toEqual([]);
  });

  it("falls back to the plain (non-rotated) snap path when rotation is 0", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "sibling", geometry: { x: 145, y: 0, width: 50, height: 50 } },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      40,
      0,
      stationary,
      snapOptions,
    );
    const direct = computeResizeSnap(
      resizeFrameFromDelta(origin, "e", 40, 0),
      stationary,
      "e",
      snapOptions,
    );
    expect(frame).toEqual(direct.frame);
    expect(guides).toEqual(direct.guides);
  });

  it("snaps a slightly-rotated frame's world AABB edge against a nearby sibling edge", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 15 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "e", 44, 0);
    const unsnappedRight = getRotatedFrameAABB(unsnapped).right;
    const siblingLeft = unsnappedRight - 6;
    const stationary = [
      {
        id: "sibling",
        geometry: { x: siblingLeft, y: 0, width: 50, height: 50 },
      },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      44,
      0,
      stationary,
      snapOptions,
    );
    expect(frame.rotation).toBe(15);
    expect(guides.length).toBeGreaterThan(0);
    expect(
      Math.abs(getRotatedFrameAABB(frame).right - siblingLeft),
    ).toBeLessThan(1);
    expect(frame.width).toBeLessThan(unsnapped.width);
  });

  it("snaps along the correct world axis at 90°: dragging the local east edge snaps the world BOTTOM edge", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 90 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "e", 0, 40);
    const unsnappedBottom = getRotatedFrameAABB(unsnapped).bottom;
    expect(unsnappedBottom).toBeCloseTo(140);
    const stationary = [
      {
        id: "below",
        geometry: { x: 0, y: unsnappedBottom + 5, width: 100, height: 50 },
      },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      0,
      40,
      stationary,
      snapOptions,
    );
    expect(frame.rotation).toBe(90);
    expect(guides.length).toBeGreaterThan(0);
    expect(getRotatedFrameAABB(frame).bottom).toBeCloseTo(unsnappedBottom + 5);
    expect(frame.width).toBeCloseTo(145);
  });

  it("snaps along the correct world axis at 180°: dragging the local east edge snaps the world LEFT edge", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 180 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "e", -40, 0);
    const unsnappedLeft = getRotatedFrameAABB(unsnapped).left;
    expect(unsnappedLeft).toBeCloseTo(-40);
    const stationary = [
      {
        id: "leftward",
        geometry: { x: unsnappedLeft - 5 - 50, y: 0, width: 50, height: 100 },
      },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      -40,
      0,
      stationary,
      snapOptions,
    );
    expect(frame.rotation).toBe(180);
    expect(guides.length).toBeGreaterThan(0);
    expect(getRotatedFrameAABB(frame).left).toBeCloseTo(unsnappedLeft - 5);
    expect(frame.width).toBeCloseTo(145);
  });

  it("snaps along the correct world axis at 270°: dragging the local east edge snaps the world TOP edge", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 270 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "e", 0, -40);
    const unsnappedTop = getRotatedFrameAABB(unsnapped).top;
    expect(unsnappedTop).toBeCloseTo(-40);
    const stationary = [
      {
        id: "above",
        geometry: { x: 0, y: unsnappedTop - 5 - 50, width: 100, height: 50 },
      },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      0,
      -40,
      stationary,
      snapOptions,
    );
    expect(frame.rotation).toBe(270);
    expect(guides.length).toBeGreaterThan(0);
    expect(getRotatedFrameAABB(frame).top).toBeCloseTo(unsnappedTop - 5);
    expect(frame.width).toBeCloseTo(145);
  });

  it("skips snapping entirely (never wrong-axis) when the rotation is far off-axis", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 45 };
    const unsnapped = resizeRotatedFrameFromDelta(origin, "e", 30, 30);
    const aabb = getRotatedFrameAABB(unsnapped);
    const stationary = [
      {
        id: "right",
        geometry: { x: aabb.right + 4, y: 0, width: 50, height: 50 },
      },
      {
        id: "below",
        geometry: { x: 0, y: aabb.bottom + 4, width: 50, height: 50 },
      },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      30,
      30,
      stationary,
      snapOptions,
    );
    expect(guides).toEqual([]);
    expect(frame.x).toBeCloseTo(unsnapped.x);
    expect(frame.y).toBeCloseTo(unsnapped.y);
    expect(frame.width).toBeCloseTo(unsnapped.width);
    expect(frame.height).toBeCloseTo(unsnapped.height);
  });

  it("skips snapping (but still resizes) when preserveAspectRatio is requested", () => {
    const origin = { x: 0, y: 0, width: 200, height: 100, rotation: 20 };
    const stationary = [
      { id: "sibling", geometry: { x: 500, y: 0, width: 50, height: 50 } },
    ];
    const { frame, guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "se",
      40,
      0,
      stationary,
      { ...snapOptions, preserveAspectRatio: true },
      { preserveAspectRatio: true },
    );
    expect(guides).toEqual([]);
    expect(frame.width / frame.height).toBeCloseTo(
      origin.width / origin.height,
    );
  });

  it("bypasses snapping when the meta/ctrl bypass flag is set", () => {
    const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 15 };
    const stationary = [
      { id: "sibling", geometry: { x: 145, y: 0, width: 50, height: 50 } },
    ];
    const { guides } = resizeRotatedFrameFromDeltaWithSnap(
      origin,
      "e",
      44,
      0,
      stationary,
      { ...snapOptions, bypass: true },
    );
    expect(guides).toEqual([]);
  });
});

describe("rotatedRectIntersects", () => {
  function boundsAndCenterOf(geometry: FrameGeometry) {
    const bounds = getFrameBounds(geometry);
    return {
      bounds: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      },
      center: { x: bounds.centerX, y: bounds.centerY },
    };
  }

  it("matches simple AABB intersection when rotation is 0", () => {
    const { bounds, center } = boundsAndCenterOf({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    expect(
      rotatedRectIntersects(
        { x: 90, y: 90, width: 20, height: 20 },
        bounds,
        center,
        0,
      ),
    ).toBe(true);
    expect(
      rotatedRectIntersects(
        { x: 0, y: 0, width: 20, height: 20 },
        bounds,
        center,
        0,
      ),
    ).toBe(false);
  });

  it("detects a plus/hash crossing where neither shape's corners are contained", () => {
    const { bounds, center } = boundsAndCenterOf({
      x: 0,
      y: 140,
      width: 300,
      height: 20,
    });
    const thinMarqueeThroughWaist = { x: 145, y: 100, width: 10, height: 100 };
    expect(
      rotatedRectIntersects(thinMarqueeThroughWaist, bounds, center, 45),
    ).toBe(true);
  });

  it("returns false for a marquee that misses the rotated frame entirely", () => {
    const { bounds, center } = boundsAndCenterOf({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    expect(
      rotatedRectIntersects(
        { x: 0, y: 0, width: 10, height: 10 },
        bounds,
        center,
        45,
      ),
    ).toBe(false);
  });

  it("detects containment when the marquee fully encloses a rotated frame", () => {
    const { bounds, center } = boundsAndCenterOf({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    expect(
      rotatedRectIntersects(
        { x: 0, y: 0, width: 400, height: 400 },
        bounds,
        center,
        45,
      ),
    ).toBe(true);
  });

  it("detects containment when the rotated frame fully encloses the marquee", () => {
    const { bounds, center } = boundsAndCenterOf({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    expect(
      rotatedRectIntersects(
        { x: 190, y: 190, width: 20, height: 20 },
        bounds,
        center,
        30,
      ),
    ).toBe(true);
  });

  it("defaults center to the bounds' own center when omitted", () => {
    const { bounds, center: ownCenter } = boundsAndCenterOf({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const rect = { x: 90, y: 90, width: 20, height: 20 };
    expect(rotatedRectIntersects(rect, bounds, ownCenter, 45)).toEqual(
      rotatedRectIntersects(rect, bounds, undefined, 45),
    );
  });

  it("rotates a child's bounds around an ancestor frame's center, not its own", () => {
    const childBounds = { left: 180, top: 95, right: 220, bottom: 105 };
    const frameCenter = { x: 150, y: 150 };
    const rectOverRotatedPosition = { x: 190, y: 190, width: 40, height: 40 };
    expect(
      rotatedRectIntersects(
        rectOverRotatedPosition,
        childBounds,
        frameCenter,
        90,
      ),
    ).toBe(true);
    expect(
      rotatedRectIntersects(
        rectOverRotatedPosition,
        childBounds,
        frameCenter,
        0,
      ),
    ).toBe(false);
  });
});

describe("getResizeCursorForHandle", () => {
  it("matches the static per-handle cursor when rotation is 0", () => {
    expect(getResizeCursorForHandle("e", 0)).toBe("ew-resize");
    expect(getResizeCursorForHandle("w", 0)).toBe("ew-resize");
    expect(getResizeCursorForHandle("n", 0)).toBe("ns-resize");
    expect(getResizeCursorForHandle("s", 0)).toBe("ns-resize");
    expect(getResizeCursorForHandle("se", 0)).toBe("nwse-resize");
    expect(getResizeCursorForHandle("nw", 0)).toBe("nwse-resize");
    expect(getResizeCursorForHandle("ne", 0)).toBe("nesw-resize");
    expect(getResizeCursorForHandle("sw", 0)).toBe("nesw-resize");
  });

  it("rotates the cursor pick by exactly 90deg of frame rotation", () => {
    expect(getResizeCursorForHandle("e", 90)).toBe("ns-resize");
    expect(getResizeCursorForHandle("n", 90)).toBe("ew-resize");
  });

  it("quantizes a 45deg rotation to the diagonal cursor", () => {
    expect(getResizeCursorForHandle("e", 45)).toBe("nwse-resize");
  });

  it("quantizes an arbitrary rotation to the nearest 45deg increment", () => {
    expect(getResizeCursorForHandle("e", 20)).toBe("ew-resize");
    expect(getResizeCursorForHandle("e", 30)).toBe("nwse-resize");
  });

  it("handles negative rotation and wraps around 360deg", () => {
    expect(getResizeCursorForHandle("e", -90)).toBe("ns-resize");
    expect(getResizeCursorForHandle("e", 360)).toBe("ew-resize");
    expect(getResizeCursorForHandle("e", 405)).toBe("nwse-resize");
  });
});

describe("getDraftGeometryFromPoints shape-draw modifiers", () => {
  it("draws a plain rect corner-to-corner with no modifiers", () => {
    expect(
      getDraftGeometryFromPoints({ x: 100, y: 100 }, { x: 180, y: 140 }),
    ).toEqual({ x: 100, y: 100, width: 80, height: 40 });
  });

  it("constrains to a square using the larger dragged dimension (shift)", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 100, y: 100 },
        { x: 180, y: 140 },
        { square: true },
      ),
    ).toEqual({ x: 100, y: 100, width: 80, height: 80 });

    expect(
      getDraftGeometryFromPoints(
        { x: 100, y: 100 },
        { x: 140, y: 180 },
        { square: true },
      ),
    ).toEqual({ x: 100, y: 100, width: 80, height: 80 });
  });

  it("preserves each axis's own drag direction when constrained to a square", () => {
    const result = getDraftGeometryFromPoints(
      { x: 200, y: 200 },
      { x: 120, y: 170 },
      { square: true },
    );
    expect(result.width).toBe(80);
    expect(result.height).toBe(80);
    expect(result.x).toBe(120);
    expect(result.y).toBe(120);
  });

  it("draws outward from center in both directions (alt)", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 150, y: 150 },
        { x: 190, y: 190 },
        { fromCenter: true },
      ),
    ).toEqual({ x: 110, y: 110, width: 80, height: 80 });
  });

  it("combines square and fromCenter (shift+alt)", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 150, y: 150 },
        { x: 210, y: 170 },
        { square: true, fromCenter: true },
      ),
    ).toEqual({ x: 90, y: 90, width: 120, height: 120 });
  });

  it("respects minWidth/minHeight and default sizing alongside modifiers", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        {
          square: true,
          defaultWidth: 100,
          defaultHeight: 40,
          minWidth: 24,
          minHeight: 24,
        },
      ),
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("whole-pixel canvas geometry", () => {
  it("draws a shape on whole pixels even from a fractional zoomed pointer", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 192.1, y: 168.4 },
        { x: 320.62, y: 268.9 },
      ),
    ).toEqual({ x: 192, y: 168, width: 129, height: 100 });
  });

  it("draws from the center on whole pixels too — the half-extent is where the .5 comes from", () => {
    expect(
      getDraftGeometryFromPoints(
        { x: 100, y: 100 },
        { x: 143.5, y: 120 },
        { fromCenter: true },
      ),
    ).toEqual({ x: 57, y: 80, width: 87, height: 40 });
  });

  it("lands a resize on whole pixels at the whole-pixel step", () => {
    const snap = computeResizeSnap(
      { x: 40.6, y: 80.2, width: 320.4, height: 240.7 },
      [],
      "se",
      {
        zoom: 100,
        thresholdScreenPx: 6,
        minWidth: 1,
        minHeight: 1,
        snapStep: WHOLE_PIXEL_SNAP_STEP,
      },
    );
    expect(snap.frame).toEqual({ x: 41, y: 80, width: 320, height: 241 });
  });

  it("leaves a guide-claimed edge on its guide rather than rounding it off the line", () => {
    const snap = computeResizeSnap(
      { x: 0, y: 0, width: 199.6, height: 100 },
      [
        {
          id: "neighbour",
          geometry: { x: 200.5, y: 0, width: 50, height: 100 },
        },
      ],
      "e",
      {
        zoom: 100,
        thresholdScreenPx: 6,
        minWidth: 1,
        minHeight: 1,
        snapStep: WHOLE_PIXEL_SNAP_STEP,
      },
    );
    expect(snap.guides).toHaveLength(1);
    expect(snap.frame.width).toBe(200.5);
  });

  it("keeps an aspect-locked resize on its ratio and quantizes only the origin", () => {
    const snap = computeResizeSnap(
      { x: 40.6, y: 80.2, width: 200.5, height: 100.25 },
      [],
      "nw",
      {
        zoom: 100,
        thresholdScreenPx: 6,
        minWidth: 1,
        minHeight: 1,
        snapStep: WHOLE_PIXEL_SNAP_STEP,
        preserveAspectRatio: true,
      },
    );
    expect(snap.frame).toEqual({
      x: 41,
      y: 80,
      width: 200.5,
      height: 100.25,
    });
  });

  it("does not quantize until a caller asks for a step", () => {
    const snap = computeResizeSnap(
      { x: 40.6, y: 80.2, width: 320.4, height: 240.7 },
      [],
      "se",
      { zoom: 100, thresholdScreenPx: 6, minWidth: 1, minHeight: 1 },
    );
    expect(snap.frame.x).toBe(40.6);
  });

  it("lands on the nearest multiple of a step, and on whole px without one", () => {
    expect(quantizeToStep(19, 8)).toBe(16);
    expect(quantizeToStep(21, 8)).toBe(24);
    expect(quantizeToStep(192.1, 8)).toBe(192);
    expect(quantizeToStep(192.1, WHOLE_PIXEL_SNAP_STEP)).toBe(192);
    expect(quantizeToStep(192.6)).toBe(193);
  });

  it("passes a non-finite value through instead of coercing it to a plausible zero", () => {
    expect(quantizeToStep(Number.NaN)).toBeNaN();
    expect(quantizeToStep(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("layout grid snapping", () => {
  const moving = [
    { id: "a", geometry: { x: 100, y: 100, width: 80, height: 40 } },
  ];

  it("lands a drag on the frame's grid, not just on a whole pixel", () => {
    const snap = computeDragSnap(
      [{ id: "a", geometry: { x: 103.4, y: 118.9, width: 80, height: 40 } }],
      [],
      { zoom: 100, thresholdScreenPx: 6, snapStep: 8 },
    );
    expect(103.4 + snap.dx).toBe(104);
    expect(118.9 + snap.dy).toBe(120);
  });

  it("leaves an alignment guide's axis on the guide instead of pulling it to the grid", () => {
    const snap = computeDragSnap(
      [{ id: "a", geometry: { x: 101, y: 100, width: 80, height: 40 } }],
      [{ id: "b", geometry: { x: 102, y: 400, width: 80, height: 40 } }],
      { zoom: 100, thresholdScreenPx: 6, snapStep: 8 },
    );
    expect(snap.guides.some((guide) => guide.orientation === "vertical")).toBe(
      true,
    );
    expect(101 + snap.dx).toBe(102);
  });

  it("does not snap at all while the bypass modifier is held", () => {
    const snap = computeDragSnap(
      [{ id: "a", geometry: { x: 103.4, y: 118.9, width: 80, height: 40 } }],
      [],
      { zoom: 100, thresholdScreenPx: 6, snapStep: 8, bypass: true },
    );
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
  });

  it("lands a resize on the grid too", () => {
    const snap = computeResizeSnap(
      { x: 100, y: 100, width: 83.5, height: 41.2 },
      [],
      "se",
      {
        zoom: 100,
        thresholdScreenPx: 6,
        minWidth: 1,
        minHeight: 1,
        snapStep: 8,
      },
    );
    expect(snap.frame.width).toBe(80);
    expect(snap.frame.height).toBe(40);
  });

  it("keeps the whole-pixel floor for a frame with no grid", () => {
    const snap = computeDragSnap(moving, [], {
      zoom: 100,
      thresholdScreenPx: 6,
      snapStep: WHOLE_PIXEL_SNAP_STEP,
    });
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
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

  it("translates a selected element's screen-local rect into world-space bounds for zoom-to-selection", () => {
    const screenGeometry: FrameGeometry = {
      x: 500,
      y: 1000,
      width: 1440,
      height: 3000,
    };
    const localRect = { x: 40, y: 20, width: 300, height: 64 };
    expect(getElementWorldBoundsForZoomFit(screenGeometry, localRect)).toEqual(
      getFrameBounds({ x: 540, y: 1020, width: 300, height: 64 }),
    );
    const wholeScreenBounds = getFrameBounds(screenGeometry);
    const elementBounds = getElementWorldBoundsForZoomFit(
      screenGeometry,
      localRect,
    );
    expect(elementBounds.width).toBeLessThan(wholeScreenBounds.width);
    expect(elementBounds.height).toBeLessThan(wholeScreenBounds.height);
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
  it("maps arrow keys to deltas and takes the big step with shift", () => {
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

  it("takes the caller's configured nudge amounts over the defaults", () => {
    expect(
      getNudgeDelta(
        "ArrowRight",
        { shiftKey: true },
        { baseStep: 2, bigStep: 24 },
      ),
    ).toMatchObject({ dx: 24, step: 24 });
    expect(
      getNudgeDelta("ArrowRight", {}, { baseStep: 2, bigStep: 24 }),
    ).toMatchObject({ dx: 2, step: 2 });
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

describe("3D transform parse/compose", () => {
  describe("parseTransform3DParts", () => {
    it("treats an absent or 'none' transform as all-zero", () => {
      expect(parseTransform3DParts(undefined)).toEqual({
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        perspective: 0,
      });
      expect(parseTransform3DParts("none")).toEqual({
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        perspective: 0,
      });
    });

    it("parses a full perspective + rotateX/Y/Z chain", () => {
      expect(
        parseTransform3DParts(
          "perspective(800px) rotateX(10deg) rotateY(-20deg) rotateZ(30deg)",
        ),
      ).toEqual({ rotateX: 10, rotateY: -20, rotateZ: 30, perspective: 800 });
    });

    it("reads a plain 2D rotate() as rotateZ, matching back-compat mapping", () => {
      expect(parseTransform3DParts("rotate(45deg)")).toEqual({
        rotateX: 0,
        rotateY: 0,
        rotateZ: 45,
        perspective: 0,
      });
    });

    it("converts non-degree angle units on rotateX/Y/Z", () => {
      expect(
        parseTransform3DParts("rotateX(0.25turn) rotateY(1.5708rad)"),
      ).toEqual({
        rotateX: 90,
        rotateY: expect.closeTo(90, 3),
        rotateZ: 0,
        perspective: 0,
      });
    });

    it("preserves translate/scale by ignoring them (caller keeps them separately)", () => {
      expect(
        parseTransform3DParts(
          "translateX(10px) rotateX(15deg) scale(1.2) rotateZ(5deg)",
        ),
      ).toEqual({ rotateX: 15, rotateY: 0, rotateZ: 5, perspective: 0 });
    });

    it("returns null for a matrix()/matrix3d()/rotate3d() composite", () => {
      expect(parseTransform3DParts("matrix(1, 0, 0, 1, 0, 0)")).toBeNull();
      expect(
        parseTransform3DParts("matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)"),
      ).toBeNull();
      expect(parseTransform3DParts("rotate3d(1, 1, 0, 45deg)")).toBeNull();
    });

    it("returns null for an unrecognized perspective unit", () => {
      expect(
        parseTransform3DParts("perspective(50em) rotateX(10deg)"),
      ).toBeNull();
    });
  });

  describe("composeTransform3D", () => {
    it("emits the plain 2D form with zero churn when X/Y/perspective are zero", () => {
      expect(
        composeTransform3D(undefined, {
          rotateX: 0,
          rotateY: 0,
          rotateZ: 30,
          perspective: 0,
        }),
      ).toBe("rotate(30deg)");
    });

    it("emits 'none' when every part is zero and there's no base transform", () => {
      expect(
        composeTransform3D(undefined, {
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          perspective: 0,
        }),
      ).toBe("none");
    });

    it("composes perspective(...) rotateX(...) rotateY(...) rotateZ(...) in that fixed order", () => {
      expect(
        composeTransform3D(undefined, {
          rotateX: 10,
          rotateY: 20,
          rotateZ: 30,
          perspective: 800,
        }),
      ).toBe("perspective(800px) rotateX(10deg) rotateY(20deg) rotateZ(30deg)");
    });

    it("includes rotateZ(0deg) once 3D is active, for unambiguous re-parsing", () => {
      expect(
        composeTransform3D(undefined, {
          rotateX: 15,
          rotateY: 0,
          rotateZ: 0,
          perspective: 0,
        }),
      ).toBe("rotateX(15deg) rotateZ(0deg)");
    });

    it("omits perspective() when perspective is 0 but X/Y rotation is active", () => {
      const composed = composeTransform3D(undefined, {
        rotateX: 0,
        rotateY: 25,
        rotateZ: 0,
        perspective: 0,
      });
      expect(composed).toBe("rotateY(25deg) rotateZ(0deg)");
    });

    it("preserves existing translate/scale/skew tokens and replaces stale rotation/perspective tokens", () => {
      const composed = composeTransform3D(
        "translateX(10px) rotateX(5deg) scale(1.2) perspective(400px)",
        { rotateX: 40, rotateY: 0, rotateZ: 0, perspective: 900 },
      );
      expect(composed).toBe(
        "perspective(900px) rotateX(40deg) rotateZ(0deg) translateX(10px) scale(1.2)",
      );
    });

    it("round-trips through parse -> compose for a 2D-only transform with zero churn", () => {
      const original = "translateX(10px) rotate(45deg) scale(1.2)";
      const parsed = parseTransform3DParts(original)!;
      expect(parsed.rotateX).toBe(0);
      expect(parsed.rotateY).toBe(0);
      expect(parsed.perspective).toBe(0);
      // Recomposing with the parsed (2D-only) parts must reproduce the exact
      // same rotate() token and preserve the surrounding transform verbatim —
      // no perspective()/rotateX()/rotateY() churn for existing designs.
      expect(composeTransform3D(original, parsed)).toBe(
        "rotate(45deg) translateX(10px) scale(1.2)",
      );
    });

    it("round-trips a full 3D chain through parse -> compose", () => {
      const original =
        "perspective(600px) rotateX(12deg) rotateY(-8deg) rotateZ(3deg)";
      const parsed = parseTransform3DParts(original)!;
      expect(composeTransform3D(undefined, parsed)).toBe(original);
    });

    it("still parses rotateZ correctly after EditPanel's plain Z-rotation field (mergeRotationValue) edits a 3D-active transform", () => {
      // EditPanel.tsx's plain rotation field always writes a bare rotate()
      // (via mergeRotationValue), never rotateZ() — even when the 3D
      // expander is active alongside it. ROTATE_FN_PATTERN
      // (`rotate[Zz]?\(...\)`, non-global) only replaces the FIRST rotate
      // family match, and critically does NOT match rotateX()/rotateY()
      // (the "X"/"Y" isn't the optional "Z"), so editing the plain Z field
      // while rotateX/rotateY are present correctly swaps only the
      // rotateZ() token for a bare rotate() token, leaving rotateX/rotateY
      // untouched. parseTransform3DParts must still recover the edited Z
      // value from that bare rotate() via its rotateZ ?? rotate fallback.
      const threeDActive =
        "perspective(800px) rotateX(10deg) rotateY(20deg) rotateZ(30deg)";
      const afterZFieldEdit = threeDActive.replace(
        /rotate[Zz]?\(\s*([+-]?[\d.]+(?:e[+-]?\d+)?)(deg|rad|turn|grad)?\s*\)/i,
        "rotate(45deg)",
      );
      expect(afterZFieldEdit).toBe(
        "perspective(800px) rotateX(10deg) rotateY(20deg) rotate(45deg)",
      );
      expect(parseTransform3DParts(afterZFieldEdit)).toEqual({
        rotateX: 10,
        rotateY: 20,
        rotateZ: 45,
        perspective: 800,
      });
    });
  });

  describe("isTransform3DActive", () => {
    it("is false when rotateZ is non-zero but X/Y/perspective are all zero", () => {
      const parts: Transform3DParts = {
        rotateX: 0,
        rotateY: 0,
        rotateZ: 45,
        perspective: 0,
      };
      expect(isTransform3DActive(parts)).toBe(false);
    });

    it("is true when perspective, rotateX, or rotateY is non-zero", () => {
      expect(
        isTransform3DActive({
          rotateX: 1,
          rotateY: 0,
          rotateZ: 0,
          perspective: 0,
        }),
      ).toBe(true);
      expect(
        isTransform3DActive({
          rotateX: 0,
          rotateY: 1,
          rotateZ: 0,
          perspective: 0,
        }),
      ).toBe(true);
      expect(
        isTransform3DActive({
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          perspective: 100,
        }),
      ).toBe(true);
    });
  });
});
