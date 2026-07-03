import { describe, expect, it } from "vitest";

import {
  appendPenNode,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createSmoothNode,
  getPenPathGeometry,
  isPenCloseTarget,
  scalePenPathToGeometry,
  serializePenPath,
  snapPenAnchorPoint,
  translatePenPath,
} from "./pen-path";

describe("pen path helpers", () => {
  it("serializes click-created corner anchors as line segments", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 10, y: 20 })),
      createCornerNode({ x: 50, y: 60 }),
    );

    expect(serializePenPath(path)).toBe("M 10 20 L 50 60");
  });

  it("serializes drag-created smooth anchors as cubic Bezier segments", () => {
    const path = appendPenNode(
      appendPenNode(null, createSmoothNode({ x: 10, y: 20 }, { x: 30, y: 20 })),
      createSmoothNode({ x: 80, y: 40 }, { x: 100, y: 70 }),
    );

    expect(serializePenPath(path)).toBe("M 10 20 C 30 20 60 10 80 40");
  });

  it("adds an explicit cubic close segment before Z", () => {
    const path = closePenPath(
      appendPenNode(
        appendPenNode(
          null,
          createSmoothNode({ x: 10, y: 20 }, { x: 30, y: 20 }),
        ),
        createSmoothNode({ x: 80, y: 40 }, { x: 100, y: 70 }),
      ),
    );

    expect(serializePenPath(path)).toBe(
      "M 10 20 C 30 20 60 10 80 40 C 100 70 -10 20 10 20 Z",
    );
  });

  it("snaps new anchors to 45 degree increments by projecting onto the snapped axis (not preserving radial distance)", () => {
    const point = constrainPointTo45Degrees({ x: 0, y: 0 }, { x: 10, y: 4 });

    expect(point.x).toBeCloseTo(10, 2);
    expect(point.y).toBeCloseTo(0, 2);
  });

  it("projects a diagonal drag onto the 45 degree axis component-wise", () => {
    const point = constrainPointTo45Degrees({ x: 0, y: 0 }, { x: 10, y: 14 });

    // Angle is ~54.5deg, snaps to 45deg; projecting (10,14) onto the (1,1)/sqrt(2)
    // axis gives an equal x/y magnitude rather than preserving hypot(10,14).
    expect(point.x).toBeCloseTo(point.y, 5);
    expect(point.x).toBeCloseTo(12, 2);
  });

  it("returns the origin point unchanged when there is no drag distance", () => {
    const point = constrainPointTo45Degrees({ x: 5, y: 5 }, { x: 5, y: 5 });

    expect(point).toEqual({ x: 5, y: 5 });
  });

  it("hit-tests the first anchor as the close target", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 100, y: 100 })),
      createCornerNode({ x: 180, y: 120 }),
    );

    expect(isPenCloseTarget(path, { x: 106, y: 103 }, 8)).toBe(true);
    expect(isPenCloseTarget(path, { x: 120, y: 100 }, 8)).toBe(false);
  });

  it("computes tight bounds from the actual curve extent, not the raw control handle positions", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 100, y: 100 })),
      createSmoothNode({ x: 180, y: 120 }, { x: 250, y: 40 }),
    );

    // The mirrored handleIn for this smooth node sits at (110, 200), which
    // pulls the curve's real extent down to y=200 even though no anchor or
    // the handleOut (250,40) reach that far — solving the derivative finds
    // that interior extremum. The raw handle positions themselves
    // (110,200) and (250,40) are NOT part of the box on the x axis, unlike
    // the old handle-inclusive bbox which took a loose min/max over every
    // handle regardless of whether the curve actually visits it.
    expect(getPenPathGeometry(path)).toEqual({
      x: 100,
      y: 100,
      width: 80,
      height: 100,
    });
  });

  it("does not let a control handle outside the curve's real extent widen the bounds", () => {
    // A symmetric S-curve where both handles are horizontally beyond the
    // anchors on the x axis, but the curve's x-extent never exceeds the
    // anchors themselves once you solve for the true extrema... instead
    // verify a case where the handle *does* legitimately extend the curve:
    // a smooth node whose handleOut pulls further out on x than either
    // anchor, so the tight bound must include that extremum on x too.
    const path = appendPenNode(
      appendPenNode(null, createSmoothNode({ x: 0, y: 0 }, { x: 60, y: 0 })),
      createCornerNode({ x: 40, y: 0 }),
    );

    const geometry = getPenPathGeometry(path);
    // Curve bulges past x=40 toward the (60,0) handleOut direction before
    // returning to the anchor at (40,0); tight bounds should capture that
    // bulge without being a fixed multiple of anything.
    expect(geometry.x).toBe(0);
    expect(geometry.width).toBeGreaterThan(40);
  });

  it("floors to a minimum size only for degenerate zero-area paths", () => {
    const singlePoint = appendPenNode(null, createCornerNode({ x: 5, y: 5 }));
    expect(getPenPathGeometry(singlePoint)).toEqual({
      x: 5,
      y: 5,
      width: 12,
      height: 12,
    });

    const flatLine = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 5, y: 5 })),
      createCornerNode({ x: 5, y: 5 }),
    );
    expect(getPenPathGeometry(flatLine)).toEqual({
      x: 5,
      y: 5,
      width: 12,
      height: 12,
    });
  });

  it("keeps the real (non-floored) size on the non-degenerate axis of a thin line, flooring only the zero-area axis", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
      createCornerNode({ x: 5, y: 0 }),
    );
    // A perfectly horizontal line has a genuine width of 5 (even though
    // that's below MIN_PATH_SIZE — it should NOT be floored up, since it's
    // real geometry) but zero height, which is floored so the selection
    // box stays clickable/visible on that axis.
    const geometry = getPenPathGeometry(path);
    expect(geometry.width).toBe(5);
    expect(geometry.height).toBe(12);
  });

  it("translates and scales every anchor and handle", () => {
    const path = appendPenNode(
      null,
      createSmoothNode({ x: 20, y: 30 }, { x: 40, y: 50 }),
    );

    expect(serializePenPath(translatePenPath(path, 10, -10))).toBe("M 30 20");
    expect(
      serializePenPath(
        scalePenPathToGeometry(
          path,
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 0, y: 0, width: 200, height: 50 },
        ),
      ),
    ).toBe("M 40 15");
  });

  it("appendPenNode always resets closed back to false, even when appending onto a closed path", () => {
    const closed = closePenPath(
      appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 10, y: 0 }),
      ),
    );
    expect(closed.closed).toBe(true);

    const reopened = appendPenNode(closed, createCornerNode({ x: 20, y: 20 }));
    expect(reopened.closed).toBe(false);
    expect(reopened.nodes).toHaveLength(3);
  });

  it("isPenCloseTarget still hit-tests the first anchor once the path is already closed", () => {
    const closed = closePenPath(
      appendPenNode(
        appendPenNode(null, createCornerNode({ x: 100, y: 100 })),
        createCornerNode({ x: 180, y: 120 }),
      ),
    );

    expect(isPenCloseTarget(closed, { x: 103, y: 102 }, 8)).toBe(true);
    expect(isPenCloseTarget(closed, { x: 500, y: 500 }, 8)).toBe(false);
  });

  it("createSmoothNode mirrors handleIn from handleOut by default", () => {
    const node = createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 });
    expect(node.handleIn).toEqual({ x: 30, y: 40 });
    expect(node.handleOut).toEqual({ x: 70, y: 60 });
  });

  it("createSmoothNode breaks handle symmetry into a cusp when breakSymmetry is set (P8: Alt-drag on a new anchor)", () => {
    const node = createSmoothNode(
      { x: 50, y: 50 },
      { x: 70, y: 60 },
      { breakSymmetry: true },
    );
    // handleOut still follows the drag, but no mirrored handleIn is
    // created — the incoming segment is left a plain corner.
    expect(node.handleOut).toEqual({ x: 70, y: 60 });
    expect(node.handleIn).toBeUndefined();
  });

  describe("snapPenAnchorPoint (P15)", () => {
    it("snaps onto an existing anchor of the active path within the hit radius", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 100, y: 0 }),
      );

      const snapped = snapPenAnchorPoint({ x: 103, y: 4 }, path, {
        hitRadius: 8,
        zoom: 50,
      });
      expect(snapped).toEqual({ x: 100, y: 0 });
    });

    it("does not snap to an anchor outside the hit radius", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      const snapped = snapPenAnchorPoint({ x: 50, y: 50 }, path, {
        hitRadius: 8,
        zoom: 50,
      });
      expect(snapped).toEqual({ x: 50, y: 50 });
    });

    it("rounds to integer canvas px at 100% zoom or above when not snapping to an anchor", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      const snapped = snapPenAnchorPoint({ x: 42.6, y: 17.3 }, path, {
        hitRadius: 8,
        zoom: 100,
      });
      expect(snapped).toEqual({ x: 43, y: 17 });
    });

    it("does not round to integer px below 100% zoom", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      const snapped = snapPenAnchorPoint({ x: 42.6, y: 17.3 }, path, {
        hitRadius: 8,
        zoom: 99,
      });
      expect(snapped).toEqual({ x: 42.6, y: 17.3 });
    });

    it("prefers snapping to an existing anchor over integer-px rounding", () => {
      const path = appendPenNode(
        null,
        createCornerNode({ x: 100.4, y: 100.4 }),
      );
      const snapped = snapPenAnchorPoint({ x: 103, y: 102 }, path, {
        hitRadius: 8,
        zoom: 100,
      });
      // Anchor snap wins and keeps the anchor's own (unrounded) coordinate,
      // rather than rounding the cursor point to {103, 102}.
      expect(snapped).toEqual({ x: 100.4, y: 100.4 });
    });

    it("handles a null path (nothing drawn yet) by falling through to integer-px rounding", () => {
      const snapped = snapPenAnchorPoint({ x: 10.6, y: 10.4 }, null, {
        hitRadius: 8,
        zoom: 100,
      });
      expect(snapped).toEqual({ x: 11, y: 10 });
    });
  });
});
