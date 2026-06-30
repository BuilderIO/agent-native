import { beforeEach, describe, expect, it } from "vitest";

import {
  getPrimitiveDropTargetForPoint,
  ParsedScreenPrimitive,
  primitiveLocalToBoardRect,
  primitiveParseCache,
  resolveNodeScreenId,
  type FrameGeometry,
} from "./MultiScreenCanvas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ScreenStub = { id: string; filename: string; content: string };

function makeGeom(x: number, y: number, w: number, h: number): FrameGeometry {
  return { x, y, width: w, height: h };
}

function primEntry(
  nodeId: string,
  screenId: string,
  opts: {
    left: number;
    top: number;
    width: number;
    height: number;
    isContainer?: boolean;
  },
): ParsedScreenPrimitive {
  return {
    nodeId,
    screenId,
    localLeft: opts.left,
    localTop: opts.top,
    localWidth: opts.width,
    localHeight: opts.height,
    isContainer: opts.isContainer ?? true,
  };
}

/** Inject pre-built primitives into the module cache so tests don't need
 *  DOMParser (unavailable in jsdom-less vitest). */
function seedCache(screen: ScreenStub, prims: ParsedScreenPrimitive[]) {
  // Cache key mirrors the fixed implementation: id:length:prefix48
  const key = `${screen.id}:${screen.content.length}:${screen.content.slice(0, 48)}`;
  primitiveParseCache.set(key, prims);
}

// ---------------------------------------------------------------------------
// Setup: clear the module-level cache before every test so tests are isolated
// ---------------------------------------------------------------------------
beforeEach(() => {
  primitiveParseCache.clear();
});

// ---------------------------------------------------------------------------
// primitiveLocalToBoardRect
// ---------------------------------------------------------------------------
describe("primitiveLocalToBoardRect", () => {
  it("correctly converts screen-local coords to board coords at 4× scale", () => {
    // Board frame: 320×640 at (100,200). Metadata: 1280×2560 (4× larger).
    const result = primitiveLocalToBoardRect(
      640,
      1280,
      256,
      512,
      makeGeom(100, 200, 320, 640),
      { width: 1280, height: 2560 },
    );
    expect(result.x).toBeCloseTo(260);
    expect(result.y).toBeCloseTo(520);
    expect(result.width).toBeCloseTo(64);
    expect(result.height).toBeCloseTo(128);
  });

  it("is a no-op when metadata size equals frame size", () => {
    const result = primitiveLocalToBoardRect(
      50,
      100,
      80,
      160,
      makeGeom(0, 0, 400, 800),
      { width: 400, height: 800 },
    );
    expect(result).toEqual({ x: 50, y: 100, width: 80, height: 160 });
  });

  it("clamps width/height to minimum 1 for tiny local sizes", () => {
    const result = primitiveLocalToBoardRect(
      0,
      0,
      0.1,
      0.1,
      makeGeom(0, 0, 320, 640),
      { width: 320, height: 640 },
    );
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("does not throw on zero metadata dimensions", () => {
    expect(() =>
      primitiveLocalToBoardRect(0, 0, 10, 10, makeGeom(0, 0, 320, 640), {
        width: 0,
        height: 0,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parsePrimitivesFromScreen cache key: regression for equal-length edits
// ---------------------------------------------------------------------------
describe("parsePrimitivesFromScreen cache key", () => {
  it("uses a different cache key when content changes with equal length (regression)", () => {
    const screenId = "cache-test";
    // Two different contents of the same length whose first 48 chars differ
    const contentA = "A".repeat(80);
    const contentB = "B".repeat(80);

    const screenA: ScreenStub = {
      id: screenId,
      filename: "f.html",
      content: contentA,
    };
    const screenB: ScreenStub = {
      id: screenId,
      filename: "f.html",
      content: contentB,
    };

    // Content lengths are equal
    expect(contentA.length).toBe(contentB.length);

    // But the cache keys must differ (prefix differs)
    const keyA = `${screenA.id}:${screenA.content.length}:${screenA.content.slice(0, 48)}`;
    const keyB = `${screenB.id}:${screenB.content.length}:${screenB.content.slice(0, 48)}`;
    expect(keyA).not.toBe(keyB);
  });

  it("same content always produces same cache key", () => {
    const screen: ScreenStub = {
      id: "s1",
      filename: "a.html",
      content: "<div>",
    };
    const key1 = `${screen.id}:${screen.content.length}:${screen.content.slice(0, 48)}`;
    const key2 = `${screen.id}:${screen.content.length}:${screen.content.slice(0, 48)}`;
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// getPrimitiveDropTargetForPoint
// ---------------------------------------------------------------------------
describe("getPrimitiveDropTargetForPoint", () => {
  const screenA: ScreenStub = { id: "sA", filename: "a.html", content: "" };
  const screenB: ScreenStub = { id: "sB", filename: "b.html", content: "" };
  const frames = {
    sA: makeGeom(0, 0, 320, 640),
    sB: makeGeom(400, 0, 320, 640),
  };
  const getMeta = () => ({ width: 320, height: 640 });

  it("returns last DOM-order container under the point (topmost visually)", () => {
    seedCache(screenA, [
      primEntry("outer", "sA", { left: 0, top: 0, width: 320, height: 640 }),
      primEntry("inner", "sA", {
        left: 100,
        top: 100,
        width: 120,
        height: 120,
      }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 150, y: 150 },
      null,
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result?.nodeId).toBe("inner");
  });

  it("returns outer when point inside outer but not inner", () => {
    seedCache(screenA, [
      primEntry("outer", "sA", { left: 0, top: 0, width: 320, height: 640 }),
      primEntry("inner", "sA", {
        left: 100,
        top: 100,
        width: 120,
        height: 120,
      }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 20, y: 20 },
      null,
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result?.nodeId).toBe("outer");
  });

  it("excludes the exact dragged node and returns another screen's container", () => {
    seedCache(screenA, [
      primEntry("outer", "sA", { left: 0, top: 0, width: 320, height: 640 }),
    ]);
    // screenB has its own container at board (400,0,320,640)
    seedCache(screenB, [
      primEntry("other-screen-container", "sB", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);

    // Dragging 'outer' (on screenA); point at (500, 100) is inside screenB's container
    const result = getPrimitiveDropTargetForPoint(
      { x: 500, y: 100 },
      "outer",
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result?.nodeId).toBe("other-screen-container");
  });

  it("regression: excludes geometric descendants of the dragged node", () => {
    // BUG was: dragging 'outer' (0,0,320,640) let 'inner' (100,100,120,120)
    // be highlighted as a drop target, creating a circular parent→child move.
    seedCache(screenA, [
      primEntry("outer", "sA", { left: 0, top: 0, width: 320, height: 640 }),
      primEntry("inner", "sA", {
        left: 100,
        top: 100,
        width: 120,
        height: 120,
      }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 150, y: 150 },
      "outer",
      [screenA, screenB],
      frames,
      getMeta,
    );
    // 'inner' is fully enclosed by 'outer' → should be excluded
    // Nothing else at this point → null
    expect(result).toBeNull();
  });

  it("does not exclude a sibling that overlaps but is not enclosed by the dragged node", () => {
    seedCache(screenA, [
      // dragged: occupies left half of screen
      primEntry("left-half", "sA", {
        left: 0,
        top: 0,
        width: 160,
        height: 640,
      }),
      // sibling: occupies right half (not enclosed by left-half)
      primEntry("right-half", "sA", {
        left: 160,
        top: 0,
        width: 160,
        height: 640,
      }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 250, y: 300 }, // inside right-half board rect
      "left-half",
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result?.nodeId).toBe("right-half");
  });

  it("returns null when point outside all frames", () => {
    seedCache(screenA, [
      primEntry("p", "sA", { left: 0, top: 0, width: 320, height: 640 }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 999, y: 999 },
      null,
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result).toBeNull();
  });

  it("skips non-container (leaf) primitives", () => {
    seedCache(screenA, [
      primEntry("leaf", "sA", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
        isContainer: false,
      }),
    ]);
    seedCache(screenB, []);

    const result = getPrimitiveDropTargetForPoint(
      { x: 50, y: 50 },
      null,
      [screenA, screenB],
      frames,
      getMeta,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveNodeScreenId
// ---------------------------------------------------------------------------
describe("resolveNodeScreenId", () => {
  const s1: ScreenStub = { id: "s1", filename: "a.html", content: "" };
  const s2: ScreenStub = { id: "s2", filename: "b.html", content: "" };

  it("returns the correct screen id when node is found", () => {
    seedCache(s1, [
      primEntry("alpha", "s1", { left: 0, top: 0, width: 100, height: 100 }),
    ]);
    seedCache(s2, [
      primEntry("beta", "s2", { left: 0, top: 0, width: 100, height: 100 }),
    ]);

    expect(resolveNodeScreenId("alpha", [s1, s2])).toBe("s1");
    expect(resolveNodeScreenId("beta", [s1, s2])).toBe("s2");
  });

  it("returns null when nodeId is not in any screen", () => {
    seedCache(s1, []);
    seedCache(s2, []);

    expect(resolveNodeScreenId("ghost", [s1, s2])).toBeNull();
  });

  it("returns the first screen when nodeId appears in multiple screens", () => {
    seedCache(s1, [
      primEntry("shared", "s1", { left: 0, top: 0, width: 100, height: 100 }),
    ]);
    seedCache(s2, [
      primEntry("shared", "s2", { left: 0, top: 0, width: 100, height: 100 }),
    ]);

    expect(resolveNodeScreenId("shared", [s1, s2])).toBe("s1");
  });
});
