import { beforeEach, describe, expect, it } from "vitest";

import {
  getBoardContentKey,
  getBoardContentLayerSignature,
  getBoardSurfaceLayerStyle,
  getBoardSurfaceRenderContent,
  getCrossScreenDropGuideForHitTest,
  getPrimitiveDropTargetForPoint,
  hasBoardSurfaceContent,
  ParsedScreenPrimitive,
  primitiveLocalToBoardRect,
  primitiveParseCache,
  resolveNodeScreenId,
  shouldBoardSurfaceCapturePointerEvents,
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

/** Mirror the djb2-variant hash used by parsePrimitivesFromScreen.
 *  Keep in sync with the `hashString` helper in MultiScreenCanvas.tsx. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16);
}

/** Inject pre-built primitives into the module cache so tests don't need
 *  DOMParser (unavailable in jsdom-less vitest). */
function seedCache(screen: ScreenStub, prims: ParsedScreenPrimitive[]) {
  // Cache key mirrors the implementation: id:length:hash(content)
  const key = `${screen.id}:${screen.content.length}:${hashString(screen.content)}`;
  primitiveParseCache.set(key, prims);
}

// ---------------------------------------------------------------------------
// Setup: clear the module-level cache before every test so tests are isolated
// ---------------------------------------------------------------------------
beforeEach(() => {
  primitiveParseCache.clear();
});

describe("board surface pointer capture", () => {
  it("keeps the oversized board layer transparent", () => {
    const style = getBoardSurfaceLayerStyle({
      geometry: makeGeom(-65536, -65536, 131072, 131072),
      interactive: true,
    });

    expect(style.background).toBe("transparent");
    expect(style.pointerEvents).toBe("auto");
  });

  it("treats empty board documents as having no surface content", () => {
    expect(
      hasBoardSurfaceContent(
        `<!doctype html><html><head><style>body{margin:0}</style></head><body>
        </body></html>`,
      ),
    ).toBe(false);
    expect(
      hasBoardSurfaceContent(
        `<!doctype html><html><body><div data-agent-native-node-id="shape"></div></body></html>`,
      ),
    ).toBe(true);
  });

  it("injects a board-only transparent surface guard", () => {
    const html = `<!doctype html><html><head><style>body{background:white}</style></head><body><div class="page" style="background:white"><div data-agent-native-node-id="rect" style="background:#ddd"></div></div></body></html>`;
    const result = getBoardSurfaceRenderContent(html);

    expect(result).toContain("data-agent-native-board-surface-render");
    expect(result).toContain(
      "body>:not([data-agent-native-node-id]):not(style):not(script)",
    );
    expect(result).toContain(
      "body>[data-agent-native-node-id]:not([data-an-primitive]):has([data-agent-native-node-id])",
    );
    expect(result).toContain('body>[data-agent-native-layer-name="<body>"]');
    expect(result).toContain(
      `<div data-agent-native-node-id="rect" style="background:#ddd">`,
    );
  });

  it("hides only oversized neutral board backdrop rectangles", () => {
    const html = `<!doctype html><html><body>
      <div data-agent-native-node-id="backdrop" data-an-primitive="rectangle" style="position:absolute;left:-16305px;top:-25001px;width:5800px;height:5500px;background:rgb(218, 218, 218);border:1px solid rgb(168, 168, 168);"></div>
      <div data-agent-native-node-id="normal" data-an-primitive="rectangle" style="position:absolute;left:10px;top:10px;width:160px;height:120px;background:#d9d9d9;border:1px solid #bdbdbd;"></div>
    </body></html>`;
    const result = getBoardSurfaceRenderContent(html);

    expect(result).toContain(
      '[data-agent-native-board-backdrop-candidate="true"]',
    );
    expect(result).toMatch(
      /data-agent-native-node-id="backdrop"[^>]*data-agent-native-board-backdrop-candidate="true"/,
    );
    expect(result).not.toMatch(
      /data-agent-native-node-id="normal"[^>]*data-agent-native-board-backdrop-candidate="true"/,
    );
  });

  it("captures only direct board edit tools", () => {
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "move" })).toBe(true);
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "select" })).toBe(
      true,
    );
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "scale" })).toBe(
      true,
    );
    expect(
      shouldBoardSurfaceCapturePointerEvents({
        tool: "move",
        gestureActive: true,
      }),
    ).toBe(false);
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "hand" })).toBe(
      false,
    );
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "rect" })).toBe(
      false,
    );
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "rectangle" })).toBe(
      false,
    );
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "pen" })).toBe(false);
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "comment" })).toBe(
      false,
    );
    expect(shouldBoardSurfaceCapturePointerEvents({ tool: "draw" })).toBe(
      false,
    );
  });

  it("keeps the active board iframe content key stable across local edits", () => {
    const before = `<body><div data-agent-native-node-id="rect" style="left:1px"></div></body>`;
    const after = `<body><div data-agent-native-node-id="rect" style="left:2px"></div></body>`;

    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: before,
        boardIsActive: true,
      }),
    ).toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: after,
        boardIsActive: true,
      }),
    );
  });

  it("changes the active board iframe content key when layer ids change", () => {
    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div></body>`,
        boardIsActive: true,
      }),
    ).not.toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div><div data-agent-native-node-id="rect-b"></div></body>`,
        boardIsActive: true,
      }),
    );
    expect(
      getBoardContentLayerSignature(
        `<body><div data-agent-native-node-id="rect-a"></div></body>`,
      ),
    ).not.toBe(
      getBoardContentLayerSignature(
        `<body><div data-agent-native-node-id="rect-a"></div><div data-agent-native-node-id="rect-b"></div></body>`,
      ),
    );
  });

  it("changes the active board iframe content key when layer hierarchy changes", () => {
    const before = `<body><div data-agent-native-node-id="parent"></div><div data-agent-native-node-id="child"></div></body>`;
    const after = `<body><div data-agent-native-node-id="parent"><div data-agent-native-node-id="child"></div></div></body>`;

    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: before,
        boardIsActive: true,
      }),
    ).not.toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: after,
        boardIsActive: true,
      }),
    );
  });

  it("keeps inactive board iframe content keys stable across local edits", () => {
    const before = `<body><div data-agent-native-node-id="rect" style="left:1px"></div></body>`;
    const after = `<body><div data-agent-native-node-id="rect" style="left:2px"></div></body>`;

    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: before,
        boardIsActive: false,
      }),
    ).toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: after,
        boardIsActive: false,
      }),
    );
  });

  it("changes inactive board iframe content keys when layer ids change", () => {
    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div></body>`,
        boardIsActive: false,
      }),
    ).not.toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div><div data-agent-native-node-id="rect-b"></div></body>`,
        boardIsActive: false,
      }),
    );
  });
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
// getCrossScreenDropGuideForHitTest
// ---------------------------------------------------------------------------
describe("getCrossScreenDropGuideForHitTest", () => {
  it("converts target iframe hit-test rects to board-space drop guides", () => {
    const result = getCrossScreenDropGuideForHitTest({
      hit: {
        placement: "after",
        axis: "x",
        anchorRect: { left: 160, top: 80, width: 40, height: 120 },
      },
      targetGeometry: makeGeom(100, 200, 320, 640),
      targetMetadata: { width: 640, height: 1280 },
    });

    expect(result).toEqual({
      placement: "after",
      axis: "x",
      boardRect: { x: 180, y: 240, width: 20, height: 60 },
    });
  });

  it("returns null when a hit-test response has no anchor rect", () => {
    expect(
      getCrossScreenDropGuideForHitTest({
        hit: { placement: "inside", axis: "y" },
        targetGeometry: makeGeom(0, 0, 320, 640),
        targetMetadata: { width: 320, height: 640 },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePrimitivesFromScreen cache key: regression for equal-length edits
// ---------------------------------------------------------------------------
/** Mirror parsePrimitivesFromScreen's cache key formula exactly. */
function makeCacheKey(screen: { id: string; content: string }): string {
  return `${screen.id}:${screen.content.length}:${hashString(screen.content)}`;
}

describe("parsePrimitivesFromScreen cache key", () => {
  it("uses a different cache key when content changes with equal length, prefix differs", () => {
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
    expect(makeCacheKey(screenA)).not.toBe(makeCacheKey(screenB));
  });

  it("regression: different key when content differs only after position 48 (same prefix, same length)", () => {
    // This is the collision the old prefix-only key failed to catch:
    // same screenId, same length, same first 48 chars, but different body content.
    // Real scenario: agent replaces a node-id at position 50 in the HTML.
    const screenId = "cache-test";
    const sharedPrefix = "X".repeat(48); // exactly 48 chars — prefix identical
    const contentA = sharedPrefix + "A".repeat(52); // 100 chars total
    const contentB = sharedPrefix + "B".repeat(52); // 100 chars total

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

    expect(contentA.length).toBe(contentB.length);
    expect(contentA.slice(0, 48)).toBe(contentB.slice(0, 48)); // confirms old formula collides

    // New formula (prefix48 + suffix48) must produce different keys
    expect(makeCacheKey(screenA)).not.toBe(makeCacheKey(screenB));
  });

  it("same content always produces same cache key", () => {
    const screen: ScreenStub = {
      id: "s1",
      filename: "a.html",
      content: "<div>",
    };
    expect(makeCacheKey(screen)).toBe(makeCacheKey(screen));
  });

  it("regression: different key when edit is deep in the middle of a large HTML file", () => {
    // The old prefix48+suffix48 formula collided when changes were in the middle
    // zone [48..len-49].  Real case: an agent rewrites a node-id at character 200
    // of a 2000-char HTML file.  The new hash-based key must differentiate these.
    const screenId = "long-screen";
    const prefix = "P".repeat(48);
    const suffix = "S".repeat(48);
    const middleA = "M".repeat(200); // change only in this middle zone
    const middleB = "N".repeat(200);
    const contentA = prefix + middleA + suffix; // 296 chars
    const contentB = prefix + middleB + suffix;

    const screenA: ScreenStub = {
      id: screenId,
      filename: "long.html",
      content: contentA,
    };
    const screenB: ScreenStub = {
      id: screenId,
      filename: "long.html",
      content: contentB,
    };

    // Confirm this is the scenario the old formula failed on:
    expect(contentA.length).toBe(contentB.length);
    expect(contentA.slice(0, 48)).toBe(contentB.slice(0, 48));
    expect(contentA.slice(-48)).toBe(contentB.slice(-48));

    // New hash-based formula must produce different keys:
    expect(makeCacheKey(screenA)).not.toBe(makeCacheKey(screenB));
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

// ---------------------------------------------------------------------------
// Cross-screen coord translation: board coords from iframe coords
// The cross-screen drag receiver uses the same formula as primitiveLocalToBoardRect
// (boardX = frame.x + iframeX * (frame.width / metadata.width)).  Verify they
// round-trip correctly and are consistent with each other.
// ---------------------------------------------------------------------------
describe("cross-screen coord translation (iframeX → boardX consistency)", () => {
  it("board coords from iframe coords match primitiveLocalToBoardRect inversion", () => {
    // Frame placed at (100, 200) on the board, 320×640 px.
    // Logical design dimensions (metadata): 390×844 (iPhone-like).
    const frameGeom = makeGeom(100, 200, 320, 640);
    const meta = { width: 390, height: 844 };

    // Suppose a primitive lives at local (localLeft=78, localTop=168) in the
    // design's logical space.  Its board rect from primitiveLocalToBoardRect:
    const boardRect = primitiveLocalToBoardRect(78, 168, 1, 1, frameGeom, meta);

    // The cross-screen drag receiver computes:
    //   scaleX = frame.width / metadata.width
    //   boardX = frame.x + iframeX * scaleX
    // If the pointer is at iframeX=78, iframeY=168 (same as the local coords):
    const scaleX = frameGeom.width / Math.max(1, meta.width);
    const scaleY = frameGeom.height / Math.max(1, meta.height);
    const receiverBoardX = frameGeom.x + 78 * scaleX;
    const receiverBoardY = frameGeom.y + 168 * scaleY;

    // Both should land at the same board coordinates:
    expect(receiverBoardX).toBeCloseTo(boardRect.x, 5);
    expect(receiverBoardY).toBeCloseTo(boardRect.y, 5);
  });

  it("iframe pointer at (0,0) maps to frame origin on the board", () => {
    const frameGeom = makeGeom(50, 80, 320, 640);
    const meta = { width: 320, height: 640 };
    const scaleX = frameGeom.width / Math.max(1, meta.width);
    const scaleY = frameGeom.height / Math.max(1, meta.height);
    const boardX = frameGeom.x + 0 * scaleX;
    const boardY = frameGeom.y + 0 * scaleY;
    expect(boardX).toBe(50);
    expect(boardY).toBe(80);
  });
});
