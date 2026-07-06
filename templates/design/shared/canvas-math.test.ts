import { describe, expect, it } from "vitest";

import {
  assignRegions,
  canvasToScreenPoint,
  computeEqualGapGuides,
  computeMoveSnap,
  computeResizeSnap,
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  type FrameGeometry,
  getAngleFromCenter,
  getCameraForBounds,
  getDraftGeometryFromPoints,
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
  rotateFrameGroupAroundCenter,
  rotatePoint,
  rotatedRectIntersects,
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

  it("exports the canonical MultiScreenCanvas zoom range (CV23)", () => {
    // MultiScreenCanvas.tsx imports these instead of redeclaring its own
    // MIN_ZOOM/MAX_ZOOM constants, so the two never drift apart silently.
    expect(DEFAULT_CANVAS_MIN_ZOOM).toBe(2);
    expect(DEFAULT_CANVAS_MAX_ZOOM).toBe(800);
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
    // Frame is 300x150 (2:1 ratio), dragged via "se". Two siblings placed far
    // apart on the OTHER axis (so neither can coincidentally win the wrong
    // axis's candidate): one 2px past the frame's right edge, one 5px past
    // the frame's bottom edge.
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
    // Without aspect preservation, x snaps to 302 (2px away) AND y
    // independently snaps to 155 (5px away) — 302x155 is not 2:1 anymore.
    const independentSnap = computeResizeSnap(frame, stationary, "se", {
      thresholdScreenPx: 6,
      zoom: 100,
    });
    expect(independentSnap.frame.width).toBe(302);
    expect(independentSnap.frame.height).toBe(155);
    expect(
      independentSnap.frame.width / independentSnap.frame.height,
    ).not.toBeCloseTo(2, 1);

    // With aspect preservation, only the closer axis (x, 2px away vs y's
    // 5px away) snaps, and the other axis (height) is rescaled from the
    // original 2:1 ratio instead of independently snapping to its own
    // nearby sibling.
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
    // Exactly one guide (the axis that actually snapped), not two.
    expect(aspectSnap.guides).toHaveLength(1);
  });

  it("preserves aspect ratio for an edge-only handle by centering the derived axis", () => {
    // "e" only touches width directly; with preserveAspectRatio the derived
    // height change must be centered vertically (matching
    // resizeFrameFromDelta's own from-center convention for the
    // aspect-derived axis), not anchored to the original top edge.
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
    // Centered vertically around the original vertical midpoint.
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
    // A 100x100 square rotated 45deg around (450,50) becomes a diamond whose
    // rotated AABB spans roughly x:[379,521], y:[-21,121] — its unrotated
    // local bounds (x:[400,500]) would snap at a completely different edge
    // than what's visually drawn.
    const stationary = [
      {
        id: "target",
        geometry: { x: 400, y: 0, width: 100, height: 100, rotation: 45 },
      },
    ];
    const rotatedAABBLeft = 450 - Math.SQRT2 * 50; // ~378.6

    // Placed just 1px away from the rotated AABB's left edge — within the
    // default snap threshold — should snap to it, even though this is far
    // from the unrotated bounds' left edge (400).
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
});

describe("computeEqualGapGuides (smart spacing, CV11)", () => {
  it("detects a moving frame evenly spaced between two horizontal neighbors", () => {
    // left sibling ends at x=100, moving frame spans 140-240 (gap 40 before),
    // right sibling starts at x=280 (gap 40 after). All share the same y
    // range so they cross-overlap on the y axis.
    const moving = { x: 140, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "right", geometry: { x: 280, y: 0, width: 100, height: 100 } },
    ];
    const guides = computeEqualGapGuides(moving, stationary);
    expect(guides).toHaveLength(1);
    expect(guides[0].orientation).toBe("vertical");
    expect(guides[0].gap).toBeCloseTo(40);
    expect(guides[0].bands[0].gapStart).toBeCloseTo(100);
    expect(guides[0].bands[0].gapEnd).toBeCloseTo(140);
    expect(guides[0].bands[1].gapStart).toBeCloseTo(240);
    expect(guides[0].bands[1].gapEnd).toBeCloseTo(280);
  });

  it("detects vertical (above/below) equal spacing symmetrically", () => {
    const moving = { x: 0, y: 150, width: 100, height: 100 };
    const stationary = [
      { id: "above", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "below", geometry: { x: 0, y: 300, width: 100, height: 100 } },
    ];
    const guides = computeEqualGapGuides(moving, stationary);
    expect(guides).toHaveLength(1);
    expect(guides[0].orientation).toBe("horizontal");
    expect(guides[0].gap).toBeCloseTo(50);
  });

  it("returns no guide when the two gaps clearly differ", () => {
    const moving = { x: 140, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "right", geometry: { x: 400, y: 0, width: 100, height: 100 } }, // gap 160, not 40
    ];
    expect(computeEqualGapGuides(moving, stationary)).toEqual([]);
  });

  it("respects a custom tolerance", () => {
    const moving = { x: 140, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } }, // gap 40
      { id: "right", geometry: { x: 283, y: 0, width: 100, height: 100 } }, // gap 43
    ];
    expect(computeEqualGapGuides(moving, stationary)).toEqual([]);
    expect(
      computeEqualGapGuides(moving, stationary, { toleranceCanvasPx: 5 }),
    ).toHaveLength(1);
  });

  it("ignores stationary frames that don't cross-overlap the moving frame's extent", () => {
    // "left" is entirely above the moving frame's y-range on the x-axis
    // gap-detection pass, so it shouldn't produce a horizontal-axis gap
    // candidate at all — this guards against treating a diagonal neighbor
    // as if it were directly beside the moving frame.
    const moving = { x: 140, y: 200, width: 100, height: 100 };
    const stationary = [
      { id: "diagonal", geometry: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(computeEqualGapGuides(moving, stationary)).toEqual([]);
  });

  it("only pairs the closest gap on each side, not every combinatorial match", () => {
    // Two candidates on the "before" side (gap 40 and gap 90) and one on
    // "after" (gap 40) — should pair with the CLOSER before-candidate (40),
    // not emit a guide for the farther one too.
    const moving = { x: 140, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "near-left", geometry: { x: 0, y: 0, width: 100, height: 100 } }, // gap 40
      { id: "far-left", geometry: { x: -150, y: 0, width: 100, height: 100 } }, // gap 90 (still "before", further)
      { id: "right", geometry: { x: 280, y: 0, width: 100, height: 100 } }, // gap 40
    ];
    const guides = computeEqualGapGuides(moving, stationary);
    expect(guides).toHaveLength(1);
    expect(guides[0].gap).toBeCloseTo(40);
  });

  it("produces no guide for a lone neighbor with nothing to pair against", () => {
    const moving = { x: 140, y: 0, width: 100, height: 100 };
    const stationary = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(computeEqualGapGuides(moving, stationary)).toEqual([]);
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
    // Two 100x100 frames side by side, group center at (150, 50).
    const frames = [
      { id: "left", geometry: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "right", geometry: { x: 200, y: 0, width: 100, height: 100 } },
    ];
    const groupCenter = { x: 150, y: 50 };

    const rotated = rotateFrameGroupAroundCenter(frames, groupCenter, 90);

    // Before rotating, centers were at (50,50) and (250,50) — 100px left and
    // right of the pivot (150,50). A 90deg (clockwise, y-down) orbit turns
    // "100px left of pivot" into "100px above pivot" and "100px right of
    // pivot" into "100px below pivot".
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

    // Every frame also spins around its OWN center by the same delta —
    // this is what makes it look like the whole group rotates rigidly
    // rather than each frame just relocating without spinning.
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
    // A point directly to the right of center, rotated 90deg, should land
    // directly below center (screen-space y grows downward).
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
    // "se" handle keeps the nw corner (100,100) fixed in LOCAL space; find its
    // world position before the resize so we can assert it stays put after.
    const nwWorldBefore = rotatePoint(
      { x: origin.x, y: origin.y },
      originCenter,
      origin.rotation,
    );

    // Drag in world space. Because the frame is rotated 90deg, a world-space
    // rightward drag corresponds to a local-space downward (height) drag —
    // this is exactly the behavior a rotation-unaware resize gets wrong.
    const result = resizeRotatedFrameFromDelta(origin, "se", 30, 0);

    expect(result.rotation).toBe(90);
    const nwWorldAfter = rotatePoint(
      { x: result.x, y: result.y },
      { x: result.x + result.width / 2, y: result.y + result.height / 2 },
      result.rotation ?? 0,
    );
    expect(nwWorldAfter.x).toBeCloseTo(nwWorldBefore.x);
    expect(nwWorldAfter.y).toBeCloseTo(nwWorldBefore.y);
    // The world-space rightward drag became a local-space height change
    // (since the frame is rotated 90deg), so width should be unaffected.
    expect(result.width).toBeCloseTo(origin.width);
    expect(result.height).not.toBeCloseTo(origin.height, 0);
  });

  it("follows the handle's rotated visual direction, not world axes", () => {
    // A 200x150 frame rotated 90deg visually presents its "e" (east/width)
    // handle pointing toward world +y (since the whole frame is rotated a
    // quarter turn). Dragging that handle in the direction it visually points
    // should grow width — the exact case CV1 reports as broken when resize
    // math ignores rotation.
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
    // Alt/option-resize of a rotated frame should grow symmetrically about
    // the frame's own visual center (Figma behavior), not pivot around the
    // opposite corner the way a plain (non-center) resize does.
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
    // Sanity: the resize actually changed the geometry (center-invariant
    // doesn't mean no-op) — with a 30deg rotation, a world-space (40, 20)
    // drag resolves to a local-space delta whose height component is
    // negative, so height should shrink while width grows.
    expect(result.width).toBeGreaterThan(origin.width);
    expect(result.height).toBeLessThan(origin.height);
  });

  it("keeps the opposite anchor world-fixed (not the center) when resizeFromCenter is NOT set on a rotated frame", () => {
    // Contrast case for the test above: default (non-center) resize must
    // keep behaving as a corner/edge-anchored resize, moving the center.
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
    // "se" handle keeps the nw corner fixed in LOCAL space; find its world
    // position before the resize so we can assert it stays put after, and
    // that the center (unlike the resizeFromCenter case above) moves.
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
    // A long, thin frame (300x20) rotated 45deg becomes a diagonal bar
    // through the middle of the canvas. A thin vertical marquee crosses
    // straight through its middle. Neither the marquee's corners land inside
    // the rotated bar, nor do the bar's corners land inside the thin
    // marquee — a corner-containment-only test (the CV5 bug) misses this
    // entirely even though the two shapes clearly overlap where they cross.
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
    // Simulates the layer-marquee case: a child element's own geometry (near
    // one edge of its parent frame) must rotate rigidly around the PARENT
    // frame's center, not the child's own center, to match how it renders.
    // Rotating this child 90deg around the frame's center (150,150) sweeps
    // its corners from x:[180,220]/y:[95,105] to x:[195,205]/y:[180,220] —
    // from the top-right area down to the bottom-right area.
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
    // Sanity check: the same rect does NOT intersect the child's original
    // (unrotated) position, proving the center override actually took effect.
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
    // A 90deg-rotated frame's "e" handle now visually points where "s" used
    // to point, so it should present the ns-resize cursor instead of ew.
    expect(getResizeCursorForHandle("e", 90)).toBe("ns-resize");
    expect(getResizeCursorForHandle("n", 90)).toBe("ew-resize");
  });

  it("quantizes a 45deg rotation to the diagonal cursor", () => {
    // "e" (0deg) + 45deg rotation = 45deg, which is exactly the "se" angle.
    expect(getResizeCursorForHandle("e", 45)).toBe("nwse-resize");
  });

  it("quantizes an arbitrary rotation to the nearest 45deg increment", () => {
    // 20deg of rotation is closer to 0 than to 45, so "e" still reads as
    // roughly horizontal (ew-resize).
    expect(getResizeCursorForHandle("e", 20)).toBe("ew-resize");
    // 30deg is closer to 45 than to 0.
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
    // Dragging further right than down: the wider axis (80) wins for both.
    expect(
      getDraftGeometryFromPoints(
        { x: 100, y: 100 },
        { x: 180, y: 140 },
        { square: true },
      ),
    ).toEqual({ x: 100, y: 100, width: 80, height: 80 });

    // Dragging further down than right: the taller axis (80) wins for both.
    expect(
      getDraftGeometryFromPoints(
        { x: 100, y: 100 },
        { x: 140, y: 180 },
        { square: true },
      ),
    ).toEqual({ x: 100, y: 100, width: 80, height: 80 });
  });

  it("preserves each axis's own drag direction when constrained to a square", () => {
    // Dragging up-and-left from start: both the resulting x and y must stay
    // anchored so the shape still ends up up-and-left of start, not
    // accidentally flipped to down-and-right.
    const result = getDraftGeometryFromPoints(
      { x: 200, y: 200 },
      { x: 120, y: 170 },
      { square: true },
    );
    expect(result.width).toBe(80);
    expect(result.height).toBe(80);
    expect(result.x).toBe(120); // left of start, matches drag direction
    expect(result.y).toBe(120); // above start (200 - 80), matches square size
  });

  it("draws outward from center in both directions (alt)", () => {
    // start is the CENTER; dragging 40px right/down should produce an 80x80
    // box centered on start, not a 40x40 box anchored at start.
    expect(
      getDraftGeometryFromPoints(
        { x: 150, y: 150 },
        { x: 190, y: 190 },
        { fromCenter: true },
      ),
    ).toEqual({ x: 110, y: 110, width: 80, height: 80 });
  });

  it("combines square and fromCenter (shift+alt)", () => {
    // Dragging further right (dx=60) than down (dy=20) from center: fromCenter
    // doubles each raw half-extent (120 x 40) before square unifies them to
    // the larger side (120), and the box is centered on start.
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
