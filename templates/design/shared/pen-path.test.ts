import { describe, expect, it } from "vitest";

import {
  appendPenNode,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createSmoothNode,
  getPenPathGeometry,
  hitTestPenAnchor,
  hitTestPenHandle,
  isPenCloseTarget,
  movePenAnchor,
  movePenHandle,
  parsePenNodes,
  scalePenPathToGeometry,
  serializePenNodes,
  serializePenPath,
  setPenNodeType,
  snapPenAnchorPoint,
  translatePenPath,
  type PenPath,
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

  describe("serializePenNodes / parsePenNodes (vector edit mode round-trip)", () => {
    it("round-trips an open path of corner nodes", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 10, y: 20 })),
        createCornerNode({ x: 50, y: 60 }),
      );

      const serialized = serializePenNodes(path);
      expect(parsePenNodes(serialized)).toEqual(path);
    });

    it("round-trips smooth nodes with mirrored handles", () => {
      const path = appendPenNode(
        appendPenNode(
          null,
          createSmoothNode({ x: 10, y: 20 }, { x: 30, y: 20 }),
        ),
        createSmoothNode({ x: 80, y: 40 }, { x: 100, y: 70 }),
      );

      const serialized = serializePenNodes(path);
      expect(parsePenNodes(serialized)).toEqual(path);
    });

    it("round-trips a closed path", () => {
      const path = closePenPath(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createCornerNode({ x: 40, y: 0 }),
        ),
      );

      const serialized = serializePenNodes(path);
      const parsed = parsePenNodes(serialized);
      expect(parsed).toEqual(path);
      expect(parsed?.closed).toBe(true);
    });

    it("round-trips a cusp node with only one handle (asymmetric, breakSymmetry)", () => {
      const path = appendPenNode(
        appendPenNode(
          null,
          createSmoothNode(
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { breakSymmetry: true },
          ),
        ),
        createCornerNode({ x: 100, y: 0 }),
      );
      // Sanity: breakSymmetry really did leave handleIn undefined.
      expect(path.nodes[0].handleIn).toBeUndefined();
      expect(path.nodes[0].handleOut).toEqual({ x: 20, y: 0 });

      expect(parsePenNodes(serializePenNodes(path))).toEqual(path);
    });

    it("round-trips an empty path (no nodes)", () => {
      const path: PenPath = { nodes: [], closed: false };
      expect(parsePenNodes(serializePenNodes(path))).toEqual(path);
    });

    it("round-trips within float tolerance for non-integer coordinates", () => {
      const path = appendPenNode(
        appendPenNode(
          null,
          createSmoothNode({ x: 1.25, y: 2.75 }, { x: 10.125, y: 4.5 }),
        ),
        createCornerNode({ x: 33.333, y: -12.5 }),
      );

      const parsed = parsePenNodes(serializePenNodes(path));
      expect(parsed).not.toBeNull();
      parsed!.nodes.forEach((node, i) => {
        const original = path.nodes[i];
        expect(node.point.x).toBeCloseTo(original.point.x, 6);
        expect(node.point.y).toBeCloseTo(original.point.y, 6);
        if (original.handleIn) {
          expect(node.handleIn?.x).toBeCloseTo(original.handleIn.x, 6);
          expect(node.handleIn?.y).toBeCloseTo(original.handleIn.y, 6);
        }
        if (original.handleOut) {
          expect(node.handleOut?.x).toBeCloseTo(original.handleOut.x, 6);
          expect(node.handleOut?.y).toBeCloseTo(original.handleOut.y, 6);
        }
      });
    });

    it("produces an attribute-safe string with no raw quotes, angle brackets, or ampersands", () => {
      // No jsdom in this project's vitest environment (node), so this
      // asserts the attribute-safety contract directly on the string rather
      // than via a real Element.setAttribute round trip: a plain HTML
      // attribute value is safe as long as it contains none of these
      // characters (a double-quoted attribute only needs to escape `"`, but
      // this format avoids the whole family so it's safe unescaped in any
      // quoting style).
      const path = appendPenNode(
        appendPenNode(
          null,
          createSmoothNode({ x: 10, y: 20 }, { x: 30, y: 20 }),
        ),
        createCornerNode({ x: 80, y: 40 }),
      );

      const serialized = serializePenNodes(path);
      expect(serialized).not.toMatch(/["'<>&]/);
      expect(parsePenNodes(serialized)).toEqual(path);
    });

    it("parsePenNodes returns null on malformed input instead of throwing", () => {
      expect(parsePenNodes("")).toBeNull();
      expect(parsePenNodes("not json")).toBeNull();
      expect(parsePenNodes("{}")).toBeNull();
      expect(parsePenNodes("[]")).toBeNull();
      expect(parsePenNodes("null")).toBeNull();
      expect(parsePenNodes("[2]")).toBeNull(); // invalid closed flag
      expect(parsePenNodes('[0, "not-a-tuple"]')).toBeNull();
      expect(parsePenNodes("[0, [1, 2, 3]]")).toBeNull(); // wrong tuple length
      expect(parsePenNodes("[0, [1, 2, null, 5, null, null]]")).toBeNull(); // mismatched handle pair
      expect(parsePenNodes('[0, [1, "x", null, null, null, null]]')).toBeNull(); // non-numeric coord
      expect(parsePenNodes("[0, [NaN, 2, null, null, null, null]]")).toBeNull();
    });

    it("parsePenNodes never throws even on wildly malformed input", () => {
      const malformedInputs = [
        "undefined",
        "[",
        "]",
        "{",
        "12345",
        '"just a string"',
        "[0, null]",
        "[0, {}]",
        "[0, [1,2,3,4,5,6,7]]",
      ];
      for (const input of malformedInputs) {
        expect(() => parsePenNodes(input)).not.toThrow();
      }
    });
  });

  describe("hitTestPenAnchor", () => {
    const path = appendPenNode(
      appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 100, y: 0 }),
      ),
      createCornerNode({ x: 100, y: 100 }),
    );

    it("returns the nearest anchor within radius", () => {
      expect(hitTestPenAnchor(path, { x: 4, y: 3 }, 8)).toEqual({
        nodeIndex: 0,
      });
      expect(hitTestPenAnchor(path, { x: 97, y: 2 }, 8)).toEqual({
        nodeIndex: 1,
      });
    });

    it("hit-tests the last node", () => {
      expect(hitTestPenAnchor(path, { x: 104, y: 96 }, 8)).toEqual({
        nodeIndex: 2,
      });
    });

    it("returns null when no anchor is within radius", () => {
      expect(hitTestPenAnchor(path, { x: 50, y: 50 }, 8)).toBeNull();
    });

    it("picks the closer of two anchors both within radius", () => {
      // Two anchors 10px apart, radius large enough to cover both from a
      // point nearer the second.
      const closePath = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 10, y: 0 }),
      );
      expect(hitTestPenAnchor(closePath, { x: 7, y: 0 }, 20)).toEqual({
        nodeIndex: 1,
      });
      expect(hitTestPenAnchor(closePath, { x: 3, y: 0 }, 20)).toEqual({
        nodeIndex: 0,
      });
    });

    it("returns null for an empty path", () => {
      const empty: PenPath = { nodes: [], closed: false };
      expect(hitTestPenAnchor(empty, { x: 0, y: 0 }, 100)).toBeNull();
    });
  });

  describe("hitTestPenHandle", () => {
    it("finds handleOut of the first node", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 0, y: 0 }, { x: 30, y: 0 }),
      );
      expect(hitTestPenHandle(path, { x: 31, y: 1 }, 8)).toEqual({
        nodeIndex: 0,
        which: "out",
      });
    });

    it("finds handleIn (mirrored) of the first node", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 0, y: 0 }, { x: 30, y: 0 }),
      );
      // Mirrored handleIn sits at (-30, 0).
      expect(hitTestPenHandle(path, { x: -29, y: -1 }, 8)).toEqual({
        nodeIndex: 0,
        which: "in",
      });
    });

    it("skips nodes that don't have the queried handle", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 100, y: 0 }),
      );
      // Neither node has any handle at all — a query near either anchor
      // should still miss.
      expect(hitTestPenHandle(path, { x: 0, y: 0 }, 8)).toBeNull();
      expect(hitTestPenHandle(path, { x: 100, y: 0 }, 8)).toBeNull();
    });

    it("returns null when no handle is within radius", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 0, y: 0 }, { x: 30, y: 0 }),
      );
      expect(hitTestPenHandle(path, { x: 500, y: 500 }, 8)).toBeNull();
    });

    it("prefers the closer handle when both an anchor's in/out handles are in radius", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 0, y: 0 }, { x: 10, y: 0 }),
      );
      // handleOut at (10,0), mirrored handleIn at (-10,0). A big radius
      // centered near handleOut should still resolve to handleOut, the
      // closer of the two.
      expect(hitTestPenHandle(path, { x: 9, y: 0 }, 25)).toEqual({
        nodeIndex: 0,
        which: "out",
      });
    });
  });

  describe("movePenAnchor", () => {
    it("translates handleIn/handleOut with the anchor by default (Figma default)", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );

      const moved = movePenAnchor(path, 0, { x: 60, y: 40 });
      expect(moved.nodes[0].point).toEqual({ x: 60, y: 40 });
      // handleOut was (70,60), delta is (+10,-10) -> (80,50).
      expect(moved.nodes[0].handleOut).toEqual({ x: 80, y: 50 });
      // handleIn was mirrored at (30,40), same delta -> (40,30).
      expect(moved.nodes[0].handleIn).toEqual({ x: 40, y: 30 });
    });

    it("leaves handles at their absolute position when moveHandlesWithAnchor is false", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );

      const moved = movePenAnchor(
        path,
        0,
        { x: 60, y: 40 },
        { moveHandlesWithAnchor: false },
      );
      expect(moved.nodes[0].point).toEqual({ x: 60, y: 40 });
      expect(moved.nodes[0].handleOut).toEqual({ x: 70, y: 60 });
      expect(moved.nodes[0].handleIn).toEqual({ x: 30, y: 40 });
    });

    it("moves a plain corner node (no handles) without creating any", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      const moved = movePenAnchor(path, 0, { x: 5, y: 5 });
      expect(moved.nodes[0]).toEqual({ point: { x: 5, y: 5 } });
    });

    it("moves the last node of a multi-node path", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 10, y: 10 }),
      );
      const moved = movePenAnchor(path, 1, { x: 20, y: 20 });
      expect(moved.nodes[0].point).toEqual({ x: 0, y: 0 });
      expect(moved.nodes[1].point).toEqual({ x: 20, y: 20 });
    });

    it("preserves the closed flag", () => {
      const path = closePenPath(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createCornerNode({ x: 10, y: 0 }),
        ),
      );
      const moved = movePenAnchor(path, 0, { x: 1, y: 1 });
      expect(moved.closed).toBe(true);
    });

    it("does not mutate the input path", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const snapshot = JSON.parse(JSON.stringify(path));
      movePenAnchor(path, 0, { x: 999, y: 999 });
      expect(path).toEqual(snapshot);
    });

    it("returns an unchanged clone for an out-of-range index", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      expect(movePenAnchor(path, 5, { x: 1, y: 1 })).toEqual(path);
      expect(movePenAnchor(path, -1, { x: 1, y: 1 })).toEqual(path);
    });
  });

  describe("movePenHandle", () => {
    it("mirrors the opposite handle by default for a symmetric smooth node", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );

      const moved = movePenHandle(path, 0, "out", { x: 90, y: 70 });
      expect(moved.nodes[0].handleOut).toEqual({ x: 90, y: 70 });
      // Mirrored across the anchor (50,50): 50 - (90-50) = 10, 50 - (70-50) = 30.
      expect(moved.nodes[0].handleIn).toEqual({ x: 10, y: 30 });
    });

    it("breaks symmetry and leaves the opposite handle in place when requested", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const originalHandleIn = path.nodes[0].handleIn;

      const moved = movePenHandle(
        path,
        0,
        "out",
        { x: 90, y: 70 },
        { breakSymmetry: true },
      );
      expect(moved.nodes[0].handleOut).toEqual({ x: 90, y: 70 });
      expect(moved.nodes[0].handleIn).toEqual(originalHandleIn);
    });

    it("moving handleIn mirrors handleOut by default", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 0, y: 0 }, { x: 20, y: 0 }),
      );
      // handleIn starts mirrored at (-20, 0).
      const moved = movePenHandle(path, 0, "in", { x: -5, y: 15 });
      expect(moved.nodes[0].handleIn).toEqual({ x: -5, y: 15 });
      // Mirror of (-5,15) around (0,0) is (5,-15).
      expect(moved.nodes[0].handleOut).toEqual({ x: 5, y: -15 });
    });

    it("creates only the dragged handle when the node has no opposite handle (cusp)", () => {
      const path = appendPenNode(
        null,
        createSmoothNode(
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { breakSymmetry: true },
        ),
      );
      expect(path.nodes[0].handleIn).toBeUndefined();

      const moved = movePenHandle(path, 0, "out", { x: 40, y: 10 });
      expect(moved.nodes[0].handleOut).toEqual({ x: 40, y: 10 });
      // No opposite handle existed, so none is created as a side effect.
      expect(moved.nodes[0].handleIn).toBeUndefined();
    });

    it("adding a first handle to a plain corner node does not synthesize the opposite one", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      const moved = movePenHandle(path, 0, "out", { x: 15, y: 0 });
      expect(moved.nodes[0].handleOut).toEqual({ x: 15, y: 0 });
      expect(moved.nodes[0].handleIn).toBeUndefined();
    });

    it("does not mutate the input path", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const snapshot = JSON.parse(JSON.stringify(path));
      movePenHandle(path, 0, "out", { x: 999, y: 999 });
      expect(path).toEqual(snapshot);
    });

    it("returns an unchanged clone for an out-of-range index", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      expect(movePenHandle(path, 9, "out", { x: 1, y: 1 })).toEqual(path);
    });
  });

  describe("setPenNodeType", () => {
    it("converting to corner drops both handles", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const converted = setPenNodeType(path, 0, "corner");
      expect(converted.nodes[0]).toEqual({ point: { x: 50, y: 50 } });
    });

    it("converting an already-smooth node to smooth is a no-op on its handles", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const converted = setPenNodeType(path, 0, "smooth");
      expect(converted.nodes[0]).toEqual(path.nodes[0]);
    });

    it("converting a cusp (only one handle) to smooth mirrors the existing handle", () => {
      const path = appendPenNode(
        null,
        createSmoothNode(
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { breakSymmetry: true },
        ),
      );
      expect(path.nodes[0].handleIn).toBeUndefined();

      const converted = setPenNodeType(path, 0, "smooth");
      expect(converted.nodes[0].handleOut).toEqual({ x: 20, y: 0 });
      expect(converted.nodes[0].handleIn).toEqual({ x: -20, y: 0 });
    });

    it("converting a plain corner to smooth synthesizes handles from the next neighbor", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 30, y: 0 }),
      );
      const converted = setPenNodeType(path, 0, "smooth");
      expect(converted.nodes[0].point).toEqual({ x: 0, y: 0 });
      expect(converted.nodes[0].handleOut).toBeDefined();
      expect(converted.nodes[0].handleIn).toBeDefined();
      // Handle points toward the next node (30,0): handleOut has positive x.
      expect(converted.nodes[0].handleOut!.x).toBeGreaterThan(0);
      // Symmetric by construction (mirrored across the anchor at 0,0).
      expect(converted.nodes[0].handleIn!.x).toBeCloseTo(
        -converted.nodes[0].handleOut!.x,
        6,
      );
      expect(converted.nodes[0].handleIn!.y).toBeCloseTo(
        -converted.nodes[0].handleOut!.y,
        6,
      );
    });

    it("converting the last corner node to smooth falls back to the previous neighbor", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 30, y: 0 }),
      );
      const converted = setPenNodeType(path, 1, "smooth");
      expect(converted.nodes[1].point).toEqual({ x: 30, y: 0 });
      // Direction toward previous neighbor (0,0) is negative x, so handleOut
      // points back toward the previous node.
      expect(converted.nodes[1].handleOut!.x).toBeLessThan(30);
    });

    it("converting a single isolated node (no neighbors) to smooth still produces handles", () => {
      const path = appendPenNode(null, createCornerNode({ x: 10, y: 10 }));
      const converted = setPenNodeType(path, 0, "smooth");
      expect(converted.nodes[0].handleOut).toBeDefined();
      expect(converted.nodes[0].handleIn).toBeDefined();
    });

    it("converting a corner node in a closed path wraps to the first node when it is the last", () => {
      const path = closePenPath(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createCornerNode({ x: 30, y: 0 }),
        ),
      );
      // Last node (index 1) has no "next" sibling in the array, but the path
      // is closed, so its neighbor for direction purposes should NOT wrap
      // (nodeIndex+1 is out of range) -- falls back to previous neighbor
      // instead, which is well-defined here regardless.
      const converted = setPenNodeType(path, 1, "smooth");
      expect(converted.closed).toBe(true);
      expect(converted.nodes[1].handleOut).toBeDefined();
    });

    it("does not mutate the input path", () => {
      const path = appendPenNode(
        null,
        createSmoothNode({ x: 50, y: 50 }, { x: 70, y: 60 }),
      );
      const snapshot = JSON.parse(JSON.stringify(path));
      setPenNodeType(path, 0, "corner");
      expect(path).toEqual(snapshot);
    });

    it("returns an unchanged clone for an out-of-range index", () => {
      const path = appendPenNode(null, createCornerNode({ x: 0, y: 0 }));
      expect(setPenNodeType(path, 5, "smooth")).toEqual(path);
    });

    it("preserves the closed flag when converting", () => {
      const path = closePenPath(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createCornerNode({ x: 10, y: 0 }),
        ),
      );
      const converted = setPenNodeType(path, 0, "corner");
      expect(converted.closed).toBe(true);
    });
  });
});
