import { describe, expect, it } from "vitest";

import {
  appendPenNode,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createSmoothNode,
  getPenPathGeometry,
  isPenCloseTarget,
  offsetPenPath,
  scalePenPathToGeometry,
  serializePenPath,
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

  it("snaps new anchors to 45 degree increments when constrained", () => {
    const point = constrainPointTo45Degrees({ x: 0, y: 0 }, { x: 10, y: 4 });

    expect(point.x).toBeCloseTo(10.77, 2);
    expect(point.y).toBeCloseTo(0, 2);
  });

  it("hit-tests the first anchor as the close target", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 100, y: 100 })),
      createCornerNode({ x: 180, y: 120 }),
    );

    expect(isPenCloseTarget(path, { x: 106, y: 103 }, 8)).toBe(true);
    expect(isPenCloseTarget(path, { x: 120, y: 100 }, 8)).toBe(false);
  });

  it("includes handles in geometry so curves do not clip", () => {
    const path = appendPenNode(
      appendPenNode(null, createCornerNode({ x: 100, y: 100 })),
      createSmoothNode({ x: 180, y: 120 }, { x: 250, y: 40 }),
    );

    expect(getPenPathGeometry(path)).toEqual({
      x: 100,
      y: 40,
      width: 150,
      height: 160,
    });
  });

  it("translates, scales, and offsets every anchor and handle", () => {
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
    expect(serializePenPath(offsetPenPath(path, { x: 10, y: 10 }))).toBe(
      "M 10 20",
    );
  });
});
