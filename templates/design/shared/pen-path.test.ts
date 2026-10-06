import { describe, expect, it } from "vitest";

import {
  appendPenNode,
  setPenNodeMirroring,
  serializeRoundedPenPath,
  penNodeMirroring,
  hitTestPenSegment,
  continuePenPathFromEndpoint,
  bendPenSegment,
  closePenPath,
  clonePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createPenCuspLatch,
  createPenDragNode,
  createSmoothNode,
  getPenPathGeometry,
  hitTestPenAnchor,
  hitTestPenHandle,
  isPenCloseTarget,
  movePenAnchor,
  movePenHandle,
  parsePenNodes,
  penCornerRadiusFromAttribute,
  resumePenPathAtEnd,
  scalePenPathToGeometry,
  serializePenNodes,
  serializePenPath,
  maxPenCornerRadius,
  setPenNodeCornerRadius,
  setPenNodeType,
  snapPenAnchorPoint,
  translatePenPath,
  type PenPath,
} from "./pen-path";

describe("pen path helpers", () => {
  it("reads only finite positive corner radii from attributes", () => {
    expect(penCornerRadiusFromAttribute("8.5")).toBe(8.5);
    expect(penCornerRadiusFromAttribute(null)).toBe(0);
    expect(penCornerRadiusFromAttribute("0")).toBe(0);
    expect(penCornerRadiusFromAttribute("nope")).toBe(0);
  });

  it("serializes click-created corner anchors as line segments", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 10, y: 20 })),
      createCornerNode({ x: 50, y: 60 }),
    );

    expect(serializePenPath(path)).toBe("M 10 20 L 50 60");
  });

  it("rounds one straight-sided anchor and preserves its radius in serialized nodes", () => {
    const square = closePenPath(
      appendPenNode(
        appendPenNode(
          appendPenNode(
            appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
            createCornerNode({ x: 100, y: 0 }),
          ),
          createCornerNode({ x: 100, y: 100 }),
        ),
        createCornerNode({ x: 0, y: 100 }),
      ),
    );
    const rounded = setPenNodeCornerRadius(square, 1, 12)!;

    expect(maxPenCornerRadius(square, 1)).toBeCloseTo(50);
    expect(serializePenPath(rounded)).toBe(
      "M 0 0 L 88 0 A 12 12 0 0 1 100 12 L 100 100 L 0 100 L 0 0 Z",
    );
    expect(rounded.nodes[0]?.cornerRadius).toBeUndefined();
    expect(parsePenNodes(serializePenNodes(rounded))).toEqual(rounded);

    const scaled = scalePenPathToGeometry(rounded, getPenPathGeometry(square), {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    const cloned = clonePenPath(scaled);
    expect(cloned.nodes[1]?.cornerRadius).toBe(12);
    expect(getPenPathGeometry(cloned)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(parsePenNodes(serializePenNodes(cloned))).toEqual(cloned);
  });

  it("reads legacy Pen tuples and rejects rounding across curved segments", () => {
    expect(
      parsePenNodes("[1,[0,0,null,null,null,null],[10,0,null,null,null,null]]"),
    ).toEqual({
      closed: true,
      nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } }],
    });

    const curved = closePenPath(
      appendPenNode(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createSmoothNode({ x: 100, y: 0 }, { x: 120, y: 0 }),
        ),
        createCornerNode({ x: 100, y: 100 }),
      ),
    );
    expect(maxPenCornerRadius(curved, 1)).toBeNull();
    expect(setPenNodeCornerRadius(curved, 1, 8)).toBeNull();
  });

  it("fails closed for open paths even when the selected point has two straight neighbors", () => {
    const openPath = appendPenNode(
      appendPenNode(
        appendPenNode(
          appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
          createCornerNode({ x: 100, y: 0 }),
        ),
        createCornerNode({ x: 100, y: 100 }),
      ),
      createCornerNode({ x: 0, y: 100 }),
    );

    expect(maxPenCornerRadius(openPath, 1)).toBeNull();
    expect(setPenNodeCornerRadius(openPath, 1, 12)).toBeNull();
    expect(
      parsePenNodes(
        "[0,[0,0,null,null,null,null,null],[100,0,null,null,null,null,12],[100,100,null,null,null,null,null],[0,100,null,null,null,null,null]]",
      ),
    ).toBeNull();
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

    expect(getPenPathGeometry(path)).toEqual({
      x: 100,
      y: 100,
      width: 80,
      height: 100,
    });
  });

  it("does not let a control handle outside the curve's real extent widen the bounds", () => {
    const path = appendPenNode(
      appendPenNode(null, createSmoothNode({ x: 0, y: 0 }, { x: 60, y: 0 })),
      createCornerNode({ x: 40, y: 0 }),
    );

    const geometry = getPenPathGeometry(path);
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

  it("resumes an open path at its terminal anchor without adding a duplicate", () => {
    const path: PenPath = {
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 40, y: 20 }),
      ],
      closed: false,
    };
    const resumed = resumePenPathAtEnd(path, { x: 41, y: 20 }, 4);
    expect(resumed).toEqual(path);
    expect(resumed).not.toBe(path);
    expect(
      appendPenNode(resumed, createCornerNode({ x: 80, y: 20 })).nodes,
    ).toHaveLength(3);
    expect(path.nodes).toHaveLength(2);
    expect(resumePenPathAtEnd(path, { x: 80, y: 20 }, 4)).toBeNull();
    expect(
      resumePenPathAtEnd(closePenPath(path), { x: 40, y: 20 }, 4),
    ).toBeNull();
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
    expect(node.handleOut).toEqual({ x: 70, y: 60 });
    expect(node.handleIn).toBeUndefined();
  });

  describe("createPenDragNode (Alt on a new anchor)", () => {
    it("mirrors handleIn from handleOut while Alt is untouched", () => {
      const latch = createPenCuspLatch();
      const node = createPenDragNode(
        { x: 50, y: 50 },
        { x: 70, y: 60 },
        latch,
        false,
      );
      expect(node.handleIn).toEqual({ x: 30, y: 40 });
      expect(node.handleOut).toEqual({ x: 70, y: 60 });
    });

    it("freezes handleIn at the tangent Alt was pressed on instead of deleting it", () => {
      const latch = createPenCuspLatch();
      createPenDragNode({ x: 50, y: 50 }, { x: 70, y: 60 }, latch, false);
      const cusp = createPenDragNode(
        { x: 50, y: 50 },
        { x: 90, y: 20 },
        latch,
        true,
      );
      expect(cusp.handleIn).toEqual({ x: 30, y: 40 });
      expect(cusp.handleOut).toEqual({ x: 90, y: 20 });
    });

    it("stays broken after Alt is released mid-drag", () => {
      const latch = createPenCuspLatch();
      createPenDragNode({ x: 50, y: 50 }, { x: 70, y: 60 }, latch, false);
      createPenDragNode({ x: 50, y: 50 }, { x: 90, y: 20 }, latch, true);
      const afterRelease = createPenDragNode(
        { x: 50, y: 50 },
        { x: 120, y: 10 },
        latch,
        false,
      );
      expect(afterRelease.handleIn).toEqual({ x: 30, y: 40 });
      expect(afterRelease.handleOut).toEqual({ x: 120, y: 10 });
    });

    it("leaves the incoming segment a corner when Alt is held from the first tick", () => {
      const latch = createPenCuspLatch();
      const node = createPenDragNode(
        { x: 50, y: 50 },
        { x: 70, y: 60 },
        latch,
        true,
      );
      expect(node.handleIn).toBeUndefined();
      expect(node.handleOut).toEqual({ x: 70, y: 60 });
    });
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

    it("snaps to the nearest anchor when multiple anchors are within the hit radius", () => {
      const path = appendPenNode(
        appendPenNode(null, createCornerNode({ x: 0, y: 0 })),
        createCornerNode({ x: 100, y: 0 }),
      );

      const snapped = snapPenAnchorPoint({ x: 55, y: 0 }, path, {
        hitRadius: 60,
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
      expect(parsePenNodes("[2]")).toBeNull();
      expect(parsePenNodes('[0, "not-a-tuple"]')).toBeNull();
      expect(parsePenNodes("[0, [1, 2, 3]]")).toBeNull();
      expect(parsePenNodes("[0, [1, 2, null, 5, null, null]]")).toBeNull();
      expect(parsePenNodes('[0, [1, "x", null, null, null, null]]')).toBeNull();
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
      expect(moved.nodes[0].handleOut).toEqual({ x: 80, y: 50 });
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
      const moved = movePenHandle(path, 0, "in", { x: -5, y: 15 });
      expect(moved.nodes[0].handleIn).toEqual({ x: -5, y: 15 });
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
      expect(converted.nodes[0].handleOut!.x).toBeGreaterThan(0);
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

describe("continuePenPathFromEndpoint", () => {
  const path: PenPath = {
    closed: false,
    nodes: [
      { point: { x: 0, y: 0 }, handleOut: { x: 5, y: -5 } },
      { point: { x: 50, y: 0 }, handleIn: { x: 45, y: -5 } },
      createCornerNode({ x: 50, y: 50 }),
    ],
  };

  it("continues from the last anchor as drawn", () => {
    expect(continuePenPathFromEndpoint(path, { x: 51, y: 49 }, 4)).toEqual(
      path,
    );
  });

  it("reverses the path, handles included, when continuing from the first anchor", () => {
    const reversed = continuePenPathFromEndpoint(path, { x: 1, y: 1 }, 4);
    expect(reversed?.nodes.map((node) => node.point)).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(reversed?.nodes[1]).toMatchObject({ handleOut: { x: 45, y: -5 } });
    expect(reversed?.nodes[2]).toMatchObject({ handleIn: { x: 5, y: -5 } });
  });

  it("ignores middle anchors and closed paths", () => {
    expect(continuePenPathFromEndpoint(path, { x: 50, y: 0 }, 4)).toBeNull();
    expect(
      continuePenPathFromEndpoint({ ...path, closed: true }, { x: 0, y: 0 }, 4),
    ).toBeNull();
  });
});

describe("serializeRoundedPenPath", () => {
  const square: PenPath = {
    closed: true,
    nodes: [
      createCornerNode({ x: 0, y: 0 }),
      createCornerNode({ x: 100, y: 0 }),
      createCornerNode({ x: 100, y: 100 }),
      createCornerNode({ x: 0, y: 100 }),
    ],
  };

  it("rounds every corner of a closed path with a tangent arc", () => {
    expect(serializeRoundedPenPath(square, 10)).toBe(
      "M 10 0 L 90 0 A 10 10 0 0 1 100 10 L 100 90 A 10 10 0 0 1 90 100 " +
        "L 10 100 A 10 10 0 0 1 0 90 L 0 10 A 10 10 0 0 1 10 0 Z",
    );
  });

  it("clamps a huge radius so a square becomes its incircle", () => {
    expect(serializeRoundedPenPath(square, 500)).toContain("A 50 50 0 0 1");
  });

  it("shares each segment between its two corners, so a rhombus becomes a circle", () => {
    const rhombus: PenPath = {
      closed: true,
      nodes: [
        createCornerNode({ x: 50, y: 0 }),
        createCornerNode({ x: 100, y: 30 }),
        createCornerNode({ x: 50, y: 60 }),
        createCornerNode({ x: 0, y: 30 }),
      ],
    };
    const d = serializeRoundedPenPath(rhombus, 1000);
    const radii = [...d.matchAll(/A ([\d.]+) /g)].map((m) => Number(m[1]));
    expect(radii).toHaveLength(4);
    radii.forEach((r) => expect(r).toBeCloseTo(25.7, 0));
  });

  it("lets a rectangle's short sides limit every corner (a stadium)", () => {
    const rect: PenPath = {
      closed: true,
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 100, y: 0 }),
        createCornerNode({ x: 100, y: 40 }),
        createCornerNode({ x: 0, y: 40 }),
      ],
    };
    expect(serializeRoundedPenPath(rect, 1000)).toBe(
      "M 20 0 L 80 0 A 20 20 0 0 1 100 20 L 100 20 A 20 20 0 0 1 80 40 L 20 40 A 20 20 0 0 1 0 20 L 0 20 A 20 20 0 0 1 20 0 Z",
    );
  });

  it("keeps open endpoints sharp and rounds only interior corners", () => {
    const open: PenPath = { ...square, closed: false };
    expect(serializeRoundedPenPath(open, 10)).toBe(
      "M 0 0 L 90 0 A 10 10 0 0 1 100 10 L 100 90 A 10 10 0 0 1 90 100 L 0 100",
    );
  });

  it("falls back to the plain path at radius 0", () => {
    expect(serializeRoundedPenPath(square, 0)).toBe(serializePenPath(square));
  });
});

describe("bending a segment", () => {
  const line: PenPath = {
    closed: false,
    nodes: [
      createCornerNode({ x: 0, y: 0 }),
      createCornerNode({ x: 90, y: 0 }),
    ],
  };

  it("finds the grabbed segment and its curve parameter", () => {
    const hit = hitTestPenSegment(line, { x: 45, y: 2 }, 4);
    expect(hit?.segmentIndex).toBe(0);
    expect(hit?.t).toBeCloseTo(0.5, 1);
    expect(hitTestPenSegment(line, { x: 45, y: 20 }, 4)).toBeNull();
  });

  it("moves the grabbed point with the pointer and keeps both anchors", () => {
    const bent = bendPenSegment(line, 0, 0.5, { x: 0, y: 30 });
    expect(bent.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
    ]);
    const [from, to] = bent.nodes;
    const mid = {
      x:
        (from!.point.x +
          3 * from!.handleOut!.x +
          3 * to!.handleIn!.x +
          to!.point.x) /
        8,
      y:
        (from!.point.y +
          3 * from!.handleOut!.y +
          3 * to!.handleIn!.y +
          to!.point.y) /
        8,
    };
    expect(mid.x).toBeCloseTo(45);
    expect(mid.y).toBeCloseTo(30);
  });
});

describe("handle mirroring", () => {
  const cusp: PenPath = {
    closed: false,
    nodes: [
      createCornerNode({ x: 0, y: 0 }),
      {
        point: { x: 50, y: 50 },
        handleIn: { x: 50, y: 20 },
        handleOut: { x: 90, y: 50 },
      },
      createCornerNode({ x: 100, y: 0 }),
    ],
  };

  it("reads the mode off the handle geometry", () => {
    expect(penNodeMirroring(cusp.nodes[1]!)).toBe("none");
    const angle = setPenNodeMirroring(cusp, 1, "angle");
    expect(penNodeMirroring(angle.nodes[1]!)).toBe("angle");
    expect(angle.nodes[1]!.handleIn).toEqual({ x: 20, y: 50 });
    const both = setPenNodeMirroring(cusp, 1, "angleAndLength");
    expect(both.nodes[1]!.handleIn).toEqual({ x: 10, y: 50 });
    expect(penNodeMirroring(both.nodes[1]!)).toBe("angleAndLength");
  });

  it("drags the opposite handle according to the mode", () => {
    const angle = setPenNodeMirroring(cusp, 1, "angle");
    const moved = movePenHandle(angle, 1, "out", { x: 50, y: 90 });
    expect(moved.nodes[1]!.handleIn!.x).toBeCloseTo(50);
    expect(moved.nodes[1]!.handleIn!.y).toBeCloseTo(20);
    const free = movePenHandle(cusp, 1, "out", { x: 50, y: 90 });
    expect(free.nodes[1]!.handleIn).toEqual({ x: 50, y: 20 });
  });

  it("keeps a chosen mode even when the handles look symmetric", () => {
    const smooth = setPenNodeMirroring(cusp, 1, "angleAndLength");
    const free = setPenNodeMirroring(smooth, 1, "none");
    expect(penNodeMirroring(free.nodes[1]!)).toBe("none");
    const dragged = movePenHandle(free, 1, "out", { x: 50, y: 90 });
    expect(dragged.nodes[1]!.handleIn).toEqual(free.nodes[1]!.handleIn);
    expect(JSON.parse(serializePenNodes(free))[1]).toHaveLength(7);
    expect(parsePenNodes("[0,[0,0,null,null,null,null,null,2]]")).toBeNull();
  });

  it("gives a handle-less corner a smooth pair", () => {
    const corner: PenPath = {
      ...cusp,
      nodes: cusp.nodes.map((n, i) =>
        i === 1 ? createCornerNode(n.point) : n,
      ),
    };
    expect(
      penNodeMirroring(
        setPenNodeMirroring(corner, 1, "angleAndLength").nodes[1]!,
      ),
    ).toBe("angleAndLength");
  });
});
