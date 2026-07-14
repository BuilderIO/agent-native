import { getFrameGroupBounds, type FrameBounds } from "@shared/canvas-math";
import {
  hitTestPenAnchor,
  hitTestPenHandle,
  type PenPath,
} from "@shared/pen-path";
import { beforeEach, describe, expect, it } from "vitest";

import { computeAltHoverMeasurement } from "./multi-screen/alt-hover-measurement";
import {
  getBoardContentKey,
  getBoardContentLayerSignature,
  getBoardSurfaceContentBounds,
  getBoardSurfaceRenderContent,
  getBoardSurfaceStaticPreviewContent,
  hasBoardSurfaceContent,
} from "./multi-screen/board-surface-html";
import {
  shouldBoardSurfaceCapturePointerEvents,
  shouldBeginCanvasPan,
  shouldShowBreakpointMenuAffordance,
} from "./multi-screen/canvas-tools";
import {
  boardPointToScreenLocalPoint,
  screenLocalPointToBoardPoint,
} from "./multi-screen/coordinate-transforms";
import {
  getCrossScreenDropGuideForHitTest,
  getCrossScreenDropGuideStyle,
} from "./multi-screen/cross-screen-drop";
import {
  draftPrimitiveToInsert,
  getDraftPreviewGeometryForTool,
} from "./multi-screen/draft-primitives";
import {
  frameStyleLeftTop,
  getBreakpointFrameGeometry,
  getLayerSelectableBounds,
  getOutsideFrameDraftFallback,
} from "./multi-screen/frame-geometry";
import { screenPxToCanvasPx } from "./multi-screen/gradient-overlay-geometry";
import {
  getActiveScreenIframeId,
  getBreakpointIframeId,
  getPrimaryIframeId,
  isBreakpointSelectionTarget,
} from "./multi-screen/iframe-targeting";
import {
  BOARD_SURFACE_RENDER_MAX_SIZE,
  boardPointToBoardSurfaceLocalPoint,
  boardSurfaceLocalPointToBoardPoint,
  getBoardSurfaceRenderGeometry,
  getBoardSurfaceLayerStyle,
  getBoardSurfaceStaticPreviewViewport,
  shouldRenderBoardSurfaceStaticPreview,
  SURFACE_PADDING,
} from "./multi-screen/overview-layout";
import {
  __clearPrimitiveParseCachesForTests,
  __getPrimitiveParseCacheSizesForTests,
  getPrimitiveDropTargetForPoint,
  isPrimitiveContainer,
  parsePrimitivesFromScreen,
  primitiveLocalToBoardRect,
  primitiveParseCache,
  resolveNodeScreenId,
  type ParsedScreenPrimitive,
} from "./multi-screen/primitive-drop-target";
import type { DraftPrimitive, FrameGeometry } from "./multi-screen/types";
import {
  vectorEditCanvasToLocalPoint,
  vectorEditLocalToCanvasPoint,
} from "./multi-screen/vector-edit-geometry";

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
  __clearPrimitiveParseCachesForTests();
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

  it("bounds negative and positive board nodes in persisted canvas coordinates", () => {
    const bounds = getBoardSurfaceContentBounds(`<!doctype html><body>
      <div data-agent-native-node-id="negative" data-an-primitive="rectangle" style="position:absolute;left:-165px;top:-90px;width:84px;height:76px"></div>
      <div data-agent-native-node-id="positive" data-an-primitive="rectangle" style="position:absolute;left:329px;top:210px;width:100px;height:60px"></div>
    </body>`);

    expect(bounds).toEqual({ x: -165, y: -90, width: 594, height: 360 });
  });

  it("includes nested overflow and ignores an instrumented document body", () => {
    expect(
      getBoardSurfaceContentBounds(
        '<html><body data-agent-native-node-id="body"></body></html>',
      ),
    ).toBeNull();

    const bounds =
      getBoardSurfaceContentBounds(`<!doctype html><body data-agent-native-node-id="body">
      <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:300px;top:100px;width:100px;height:100px">
        <div data-agent-native-node-id="overflow" data-an-primitive="rectangle" style="position:absolute;left:140px;top:120px;width:80px;height:60px"></div>
      </div>
    </body>`);
    expect(bounds).toEqual({ x: 300, y: 100, width: 220, height: 180 });
  });

  it("uses a browser-safe chunked paint window without changing logical board coordinates", () => {
    const logical = makeGeom(-65536, -65536, 131072, 131072);
    const negativeBounds = makeGeom(-165, -90, 84, 76);
    const screens = [makeGeom(100, 80, 320, 640)];
    const geometry = getBoardSurfaceRenderGeometry({
      logicalGeometry: logical,
      contentBounds: negativeBounds,
      screenGeometries: screens,
    });

    expect(geometry).toEqual({
      x: -4096,
      y: -4096,
      width: 8192,
      height: 8192,
    });
    expect(geometry.width).toBeLessThanOrEqual(BOARD_SURFACE_RENDER_MAX_SIZE);
    expect(geometry.height).toBeLessThanOrEqual(BOARD_SURFACE_RENDER_MAX_SIZE);
    // The iframe-local coordinate round-trip lands at the exact persisted
    // negative board coordinate; no fixed +/-65536 projection is involved.
    const iframeLocalX = negativeBounds.x - geometry.x;
    const iframeLocalY = negativeBounds.y - geometry.y;
    expect(geometry.x + iframeLocalX).toBe(negativeBounds.x);
    expect(geometry.y + iframeLocalY).toBe(negativeBounds.y);
  });

  it("keeps the render origin stable for nearby edits inside the same chunk", () => {
    const logical = makeGeom(-65536, -65536, 131072, 131072);
    const before = getBoardSurfaceRenderGeometry({
      logicalGeometry: logical,
      contentBounds: makeGeom(-165, -90, 84, 76),
      screenGeometries: [makeGeom(100, 80, 320, 640)],
    });
    const after = getBoardSurfaceRenderGeometry({
      logicalGeometry: logical,
      contentBounds: makeGeom(329, 210, 100, 60),
      screenGeometries: [makeGeom(100, 80, 320, 640)],
    });

    expect(after).toEqual(before);
  });

  it("keeps a low-zoom viewport browser-bounded while following its center", () => {
    const logical = makeGeom(-65536, -65536, 131072, 131072);
    // At the canvas minimum zoom (2%), a 1440x900 viewport spans 72,000 x
    // 45,000 board pixels. One iframe intentionally remains capped below
    // that span; it follows the live viewport center instead of regressing to
    // the origin or allocating the old 131,072px document.
    const lowZoomViewport = makeGeom(18_000, -12_000, 72_000, 45_000);
    const geometry = getBoardSurfaceRenderGeometry({
      logicalGeometry: logical,
      contentBounds: makeGeom(-165, -90, 84, 76),
      screenGeometries: [lowZoomViewport],
      focus: {
        x: lowZoomViewport.x + lowZoomViewport.width / 2,
        y: lowZoomViewport.y + lowZoomViewport.height / 2,
      },
    });

    expect(geometry.width).toBe(BOARD_SURFACE_RENDER_MAX_SIZE);
    expect(geometry.height).toBe(BOARD_SURFACE_RENDER_MAX_SIZE);
    expect(geometry.x).toBe(40_960);
    expect(geometry.y).toBe(-4096);
    expect(geometry.x + geometry.width / 2).toBeCloseTo(53_248, 0);
    expect(geometry.y + geometry.height / 2).toBeCloseTo(8192, 0);
  });

  it("covers a 2% viewport with one uniformly compressed inert board preview", () => {
    const logical = makeGeom(-65536, -65536, 131072, 131072);
    const active = makeGeom(-12288, -12288, 24576, 24576);
    const viewport = makeGeom(-36000, -22500, 72000, 45000);
    const staticViewport = getBoardSurfaceStaticPreviewViewport(logical);

    expect(
      shouldRenderBoardSurfaceStaticPreview({
        zoom: 2,
        viewportGeometry: viewport,
        renderGeometry: active,
      }),
    ).toBe(true);
    expect(staticViewport).toEqual({ width: 4096, height: 4096 });

    const content = getBoardSurfaceStaticPreviewContent({
      html: `<!doctype html><html><head>
        <meta http-equiv="refresh" content="0;url=https://example.test">
        <base href="https://example.test/">
        <link rel="stylesheet" href="https://example.test/app.css">
        <style>@import "https://example.test/import.css";.remote{background-image:url(https://example.test/bg.png);animation:pulse 1s infinite;transition:all 1s}</style>
        <script>window.duplicateRuntime = true</script>
      </head><body onload="start()">
        <iframe src="https://example.test/embed"></iframe>
        <object data="https://example.test/runtime"></object>
        <embed src="https://example.test/plugin">
        <audio autoplay src="https://example.test/audio.mp3"></audio>
        <video autoplay src="https://example.test/video.mp4"></video>
        <img src="https://example.test/image.png" srcset="https://example.test/image@2x.png 2x" style="background:url(https://example.test/inline.png)">
        <svg><image href="https://example.test/vector.png"></image><use xlink:href="https://example.test/icons.svg#star"></use></svg>
        <div data-agent-native-node-id="left" style="position:absolute;left:-50000px;top:0;width:100px;height:100px"></div>
        <div data-agent-native-node-id="right" style="position:absolute;left:50000px;top:0;width:100px;height:100px"></div>
      </body></html>`,
      logicalGeometry: logical,
      viewport: staticViewport,
    });

    expect(content).toContain("transform:scale(0.03125)!important");
    expect(content).toContain("translate:65536px 65536px!important");
    expect(content).toContain('data-agent-native-node-id="left"');
    expect(content).toContain('data-agent-native-node-id="right"');
    expect(content).not.toMatch(/<script|onload=|<iframe|<object|<embed/i);
    expect(content).not.toMatch(/<audio|<video|autoplay|http-equiv="refresh"/i);
    expect(content).not.toMatch(/<link|<meta|<base|@import|url\(/i);
    expect(content).not.toContain("https://example.test");
    expect(content).toContain("animation:none!important");
    expect(content).toContain("transition:none!important");
  });

  it("round-trips board drag and hit-test points through the finite iframe origin", () => {
    const renderGeometry = makeGeom(-4096, -4096, 8192, 8192);
    for (const boardPoint of [
      { x: -165, y: -90 },
      { x: 329, y: 210 },
    ]) {
      const localPoint = boardPointToBoardSurfaceLocalPoint(
        boardPoint,
        renderGeometry,
      );
      expect(localPoint.x).toBeGreaterThanOrEqual(0);
      expect(localPoint.y).toBeGreaterThanOrEqual(0);
      expect(localPoint.x).toBeLessThan(renderGeometry.width);
      expect(localPoint.y).toBeLessThan(renderGeometry.height);
      expect(
        boardSurfaceLocalPointToBoardPoint(localPoint, renderGeometry),
      ).toEqual(boardPoint);
    }
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
      'body>[data-agent-native-node-id]:not([data-an-primitive]):not([data-agent-native-preserve-styles="true"]):has([data-agent-native-node-id])',
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

  it("keeps the active board iframe content key stable when layer ids change", () => {
    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div></body>`,
        boardIsActive: true,
      }),
    ).toBe(
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

  it("keeps the active board iframe content key stable when layer hierarchy changes", () => {
    const before = `<body><div data-agent-native-node-id="parent"></div><div data-agent-native-node-id="child"></div></body>`;
    const after = `<body><div data-agent-native-node-id="parent"><div data-agent-native-node-id="child"></div></div></body>`;

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

  it("keeps inactive board iframe content keys stable when layer ids change", () => {
    expect(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div></body>`,
        boardIsActive: false,
      }),
    ).toBe(
      getBoardContentKey({
        boardFileId: "board",
        boardFileContent: `<body><div data-agent-native-node-id="rect-a"></div><div data-agent-native-node-id="rect-b"></div></body>`,
        boardIsActive: false,
      }),
    );
  });
});

describe("global canvas pan gestures", () => {
  it("keeps middle-mouse pan available regardless of the active edit tool", () => {
    expect(shouldBeginCanvasPan({ button: 1, tool: "move" })).toBe(true);
    expect(shouldBeginCanvasPan({ button: 1, tool: "pen" })).toBe(true);
  });

  it("uses left mouse only for the hand tool", () => {
    expect(shouldBeginCanvasPan({ button: 0, tool: "hand" })).toBe(true);
    expect(shouldBeginCanvasPan({ button: 0, tool: "move" })).toBe(false);
    expect(shouldBeginCanvasPan({ button: 2, tool: "hand" })).toBe(false);
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

  it("maps local primitive geometry through a rotated screen", () => {
    const result = primitiveLocalToBoardRect(
      0,
      0,
      20,
      40,
      { ...makeGeom(0, 0, 100, 200), rotation: 90 },
      { width: 100, height: 200 },
    );

    // Local center (10,20), rotated 90deg around frame center (50,100),
    // lands at board center (130,60).
    expect(result.x).toBeCloseTo(120);
    expect(result.y).toBeCloseTo(40);
    expect(result.width).toBe(20);
    expect(result.height).toBe(40);
    expect(result.rotation).toBe(90);
  });
});

describe("draftPrimitiveToInsert", () => {
  it("keeps a board-space draft visually stationary when inserted into a rotated screen", () => {
    const draft: DraftPrimitive = {
      id: "draft",
      kind: "rectangle",
      // This box is the board-space result of local (0,0,20,40) inside the
      // 90deg frame below. Its own global rotation is zero.
      geometry: { x: 120, y: 40, width: 20, height: 40 },
    };

    const insert = draftPrimitiveToInsert(draft, {
      ...makeGeom(0, 0, 100, 200),
      rotation: 90,
    });

    expect(insert.geometry).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 40,
      rotation: -90,
    });
  });
});

// ---------------------------------------------------------------------------
// frameStyleLeftTop (PERF9)
// ---------------------------------------------------------------------------
describe("frameStyleLeftTop", () => {
  it("matches Screen's inline style formula: SURFACE_PADDING + x / y - labelHeight", () => {
    const result = frameStyleLeftTop({ x: 100, y: 200 }, 28);
    expect(result).toEqual({
      left: SURFACE_PADDING + 100,
      top: SURFACE_PADDING + 200 - 28,
    });
  });

  it("defaults labelHeight to 0, matching DraftPrimitiveLayer's inline style (no label row)", () => {
    const result = frameStyleLeftTop({ x: 50, y: 75 });
    expect(result).toEqual({
      left: SURFACE_PADDING + 50,
      top: SURFACE_PADDING + 75,
    });
  });

  it("handles negative geometry (frames left/above the surface origin)", () => {
    const result = frameStyleLeftTop({ x: -500, y: -300 }, 14);
    expect(result).toEqual({
      left: SURFACE_PADDING - 500,
      top: SURFACE_PADDING - 300 - 14,
    });
  });

  it("is a pure function of x/y/labelHeight — ignores extra geometry fields", () => {
    const result = frameStyleLeftTop(
      { x: 10, y: 20, width: 999, height: 999 } as FrameGeometry,
      0,
    );
    expect(result).toEqual({
      left: SURFACE_PADDING + 10,
      top: SURFACE_PADDING + 20,
    });
  });
});

describe("layer marquee bounds", () => {
  it("does not include the screen-only label band above a layer", () => {
    expect(getLayerSelectableBounds(makeGeom(100, 200, 80, 40))).toEqual({
      left: 100,
      top: 200,
      right: 180,
      bottom: 240,
    });
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

  it("maps and rotates guides with their target screen", () => {
    const guide = getCrossScreenDropGuideForHitTest({
      hit: {
        anchorRect: { left: 0, top: 0, width: 20, height: 40 },
        placement: "inside",
        axis: "y",
      },
      targetGeometry: { ...makeGeom(0, 0, 100, 200), rotation: 90 },
      targetMetadata: { width: 100, height: 200 },
    });

    expect(guide?.boardRect.x).toBeCloseTo(120);
    expect(guide?.boardRect.y).toBeCloseTo(40);
    expect(guide?.boardRect.rotation).toBe(90);
    expect(
      getCrossScreenDropGuideStyle({
        guide: guide!,
        pan: { x: 0, y: 0 },
        scale: 1,
      }).transform,
    ).toBe("rotate(90deg)");
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
// parsePrimitivesFromScreen identity-first cache (PF17): repeated calls with
// the *same* content reference (the common case for a drag/marquee mousemove
// handler re-reading the active screen every frame) should skip re-hashing
// the full content string and return the memoized result directly.
// ---------------------------------------------------------------------------
describe("parsePrimitivesFromScreen identity cache", () => {
  it("treats a plain canvas frame as a child-drop container before Auto layout", () => {
    expect(
      isPrimitiveContainer({
        tagName: "div",
        primitiveKind: "frame",
        display: "",
        borderRadius: "",
      }),
    ).toBe(true);
    expect(
      isPrimitiveContainer({
        tagName: "div",
        primitiveKind: "text",
        display: "inline-block",
        borderRadius: "",
      }),
    ).toBe(false);
    expect(
      isPrimitiveContainer({
        tagName: "div",
        primitiveKind: "ellipse",
        display: "",
        borderRadius: "50%",
      }),
    ).toBe(false);
  });

  it("returns the same result reference for repeated calls with unchanged content", () => {
    const screen: ScreenStub = {
      id: "identity-screen",
      filename: "f.html",
      content: "<div data-agent-native-node-id='a'></div>",
    };
    // Seed the hash-keyed cache directly (DOMParser isn't available in this
    // jsdom-less vitest env — see the seedCache helper above) so the first
    // call resolves through the normal cache-hit path and populates the
    // identity cache, mirroring what a real parse would do.
    const seeded = [
      primEntry("a", "identity-screen", {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      }),
    ];
    seedCache(screen, seeded);

    const first = parsePrimitivesFromScreen(screen as never);
    const second = parsePrimitivesFromScreen(screen as never);

    // Same object reference in, same result reference out — the identity
    // fast path returned the memoized array without re-parsing/re-hashing.
    expect(first).toBe(seeded);
    expect(second).toBe(first);
  });

  it("re-parses when content changes even if the screen id is reused", () => {
    const screenId = "identity-screen-2";
    const screenV1: ScreenStub = {
      id: screenId,
      filename: "f.html",
      content: "A",
    };
    const screenV2: ScreenStub = {
      id: screenId,
      filename: "f.html",
      content: "B",
    };
    const seededV1 = [
      primEntry("v1", screenId, { left: 0, top: 0, width: 10, height: 10 }),
    ];
    const seededV2 = [
      primEntry("v2", screenId, { left: 0, top: 0, width: 20, height: 20 }),
    ];
    seedCache(screenV1, seededV1);
    seedCache(screenV2, seededV2);

    const first = parsePrimitivesFromScreen(screenV1 as never);
    const second = parsePrimitivesFromScreen(screenV2 as never);
    // Calling again with the original (now stale) content reference must not
    // incorrectly reuse screenV2's cached result.
    const third = parsePrimitivesFromScreen(screenV1 as never);

    expect(first).toBe(seededV1);
    expect(second).toBe(seededV2);
    expect(third).toBe(seededV1);
    expect(second).not.toBe(first);
  });

  it("bounds per-screen identity entries on long-lived boards", () => {
    for (let index = 0; index < 80; index += 1) {
      const screen: ScreenStub = {
        id: `identity-${index}`,
        filename: `${index}.html`,
        content: `content-${index}`,
      };
      seedCache(screen, []);
      parsePrimitivesFromScreen(screen as never);
    }

    expect(
      __getPrimitiveParseCacheSizesForTests().identity,
    ).toBeLessThanOrEqual(64);
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

  it("treats board-surface primitives as canvas-space drop targets", () => {
    const boardScreen: ScreenStub = {
      id: "board",
      filename: "__board__.html",
      content: "",
    };
    seedCache(boardScreen, [
      primEntry("outer-board-rect", "board", {
        left: 100,
        top: 100,
        width: 220,
        height: 160,
      }),
      primEntry("inner-board-rect", "board", {
        left: 140,
        top: 130,
        width: 40,
        height: 40,
      }),
    ]);

    const result = getPrimitiveDropTargetForPoint(
      { x: 150, y: 145 },
      null,
      [boardScreen],
      { board: makeGeom(-65536, -65536, 131072, 131072) },
      () => ({ width: 131072, height: 131072 }),
      { identityCoordinateScreenIds: new Set(["board"]) },
    );

    expect(result?.nodeId).toBe("inner-board-rect");
    expect(result?.boardRect).toEqual({
      x: 140,
      y: 130,
      width: 40,
      height: 40,
    });
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

  it("uses the visibly top overlapping screen instead of array fallthrough", () => {
    const overlappingFrames = {
      sA: makeGeom(0, 0, 320, 640),
      sB: makeGeom(0, 0, 320, 640),
    };
    seedCache(screenA, [
      primEntry("container-a", "sA", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);
    seedCache(screenB, [
      primEntry("container-b", "sB", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);

    // Equal z: later DOM sibling paints above the earlier one.
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 100, y: 100 },
        null,
        [screenA, screenB],
        overlappingFrames,
        getMeta,
      )?.nodeId,
    ).toBe("container-b");

    // The selected/active foreground boost wins even when it is earlier.
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 100, y: 100 },
        null,
        [screenA, screenB],
        overlappingFrames,
        getMeta,
        { foregroundScreenId: "sA" },
      )?.nodeId,
    ).toBe("container-a");
  });

  it("keeps the board behind an overlapping screen", () => {
    const boardScreen: ScreenStub = {
      id: "board",
      filename: "__board__.html",
      content: "",
    };
    seedCache(screenA, [
      primEntry("screen-container", "sA", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);
    seedCache(boardScreen, [
      primEntry("board-container", "board", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);

    const result = getPrimitiveDropTargetForPoint(
      { x: 100, y: 100 },
      null,
      [screenA, boardScreen],
      {
        sA: makeGeom(0, 0, 320, 640),
        board: makeGeom(-65536, -65536, 131072, 131072),
      },
      getMeta,
      {
        identityCoordinateScreenIds: new Set(["board"]),
        backgroundScreenIds: new Set(["board"]),
      },
    );

    expect(result?.nodeId).toBe("screen-container");
  });

  it("hit-tests containers inside rotated screens in board space", () => {
    seedCache(screenA, [
      primEntry("rotated-container", "sA", {
        left: 0,
        top: 0,
        width: 20,
        height: 40,
      }),
    ]);
    seedCache(screenB, []);
    const rotatedFrames = {
      sA: { ...makeGeom(0, 0, 100, 200), rotation: 90 },
      sB: makeGeom(400, 0, 320, 640),
    };

    // The primitive's rotated board center is (130,60), outside the frame's
    // unrotated x range but inside what is visibly painted after rotation.
    const result = getPrimitiveDropTargetForPoint(
      { x: 130, y: 60 },
      null,
      [screenA, screenB],
      rotatedFrames,
      () => ({ width: 100, height: 200 }),
    );

    expect(result?.nodeId).toBe("rotated-container");
    expect(result?.boardRect.rotation).toBe(90);
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

  it("does not mistake a container on another screen for a descendant", () => {
    const overlappingFrames = {
      sA: makeGeom(0, 0, 320, 640),
      sB: { ...makeGeom(0, 0, 320, 640), z: 1 },
    };
    seedCache(screenA, [
      primEntry("dragged-outer", "sA", {
        left: 0,
        top: 0,
        width: 320,
        height: 640,
      }),
    ]);
    seedCache(screenB, [
      primEntry("other-screen-inner", "sB", {
        left: 100,
        top: 100,
        width: 120,
        height: 120,
      }),
    ]);

    // The target is geometrically enclosed by the dragged node's old board
    // rect, but it belongs to a different screen and cannot be its descendant.
    const result = getPrimitiveDropTargetForPoint(
      { x: 150, y: 150 },
      "dragged-outer",
      [screenA, screenB],
      overlappingFrames,
      getMeta,
    );
    expect(result?.nodeId).toBe("other-screen-inner");
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
// Cross-screen coord translation: board coords from iframe coords. Verify the
// shared mapping matches primitive rect conversion and remains invertible when
// a screen frame is rotated.
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

  it("round-trips points through a rotated screen without drift", () => {
    const frameGeom = {
      ...makeGeom(100, 200, 320, 640),
      rotation: 37,
    };
    const viewport = { width: 390, height: 844 };
    const local = { x: 78, y: 168 };

    const board = screenLocalPointToBoardPoint(local, frameGeom, viewport);
    const roundTrip = boardPointToScreenLocalPoint(board, frameGeom, viewport);

    expect(roundTrip.x).toBeCloseTo(local.x, 8);
    expect(roundTrip.y).toBeCloseTo(local.y, 8);
  });
});

// ---------------------------------------------------------------------------
// getDraftPreviewGeometryForTool: shift/alt shape-draw modifiers (CV15)
// ---------------------------------------------------------------------------
describe("getDraftPreviewGeometryForTool shape-draw modifiers", () => {
  it("draws a plain rect with no modifiers", () => {
    const geometry = getDraftPreviewGeometryForTool(
      "rect",
      { x: 100, y: 100 },
      { x: 180, y: 140 },
      true,
    );
    expect(geometry).toEqual({ x: 100, y: 100, width: 80, height: 40 });
  });

  it("constrains rect to a square when shift is held", () => {
    const geometry = getDraftPreviewGeometryForTool(
      "rect",
      { x: 100, y: 100 },
      { x: 180, y: 140 },
      true,
      { shiftKey: true },
    );
    expect(geometry.width).toBe(geometry.height);
    expect(geometry.width).toBe(80);
  });

  it("constrains ellipse to a circle when shift is held", () => {
    const geometry = getDraftPreviewGeometryForTool(
      "ellipse",
      { x: 0, y: 0 },
      { x: 30, y: 90 },
      true,
      { shiftKey: true },
    );
    expect(geometry.width).toBe(geometry.height);
    expect(geometry.width).toBe(90);
  });

  it("draws outward from the start point as center when alt is held", () => {
    const geometry = getDraftPreviewGeometryForTool(
      "rect",
      { x: 150, y: 150 },
      { x: 190, y: 190 },
      true,
      { altKey: true },
    );
    expect(geometry).toEqual({ x: 110, y: 110, width: 80, height: 80 });
  });

  it("does not apply square/fromCenter to a line's bounding box, but does constrain its angle", () => {
    // A line's preview geometry is a path bounding box; shift constrains the
    // line's own angle (via the same 45deg pen-tool helper), not squareness.
    // (100,15) is ~8.5deg from horizontal — closest to the 0deg increment —
    // so shift should snap it flat, collapsing the bounding box height down
    // to the tool's minimum hit-box size instead of the unconstrained ~15.
    const unconstrained = getDraftPreviewGeometryForTool(
      "line",
      { x: 0, y: 0 },
      { x: 100, y: 15 },
      true,
    );
    const constrained = getDraftPreviewGeometryForTool(
      "line",
      { x: 0, y: 0 },
      { x: 100, y: 15 },
      true,
      { shiftKey: true },
    );
    expect(unconstrained.height).toBeGreaterThan(constrained.height);
  });
});

// ---------------------------------------------------------------------------
// Breakpoint sub-frame iframe id resolution (B15)
// ---------------------------------------------------------------------------
describe("breakpoint sub-frame iframe id resolution", () => {
  it("primary iframe id is the bare screen id", () => {
    expect(getPrimaryIframeId("screen-1")).toBe("screen-1");
  });

  it("breakpoint sub-frame ids are distinct per width and never collide with the primary", () => {
    const primary = getPrimaryIframeId("screen-1");
    const bp390 = getBreakpointIframeId("screen-1", 390);
    const bp768 = getBreakpointIframeId("screen-1", 768);
    expect(bp390).not.toBe(primary);
    expect(bp768).not.toBe(primary);
    expect(bp390).not.toBe(bp768);
  });

  it("resolves to the primary iframe when no breakpoint is active", () => {
    expect(
      getActiveScreenIframeId({
        id: "screen-1",
        breakpointWidths: [390, 768],
        activeBreakpointWidth: undefined,
      }),
    ).toBe("screen-1");
  });

  it("resolves to the active breakpoint sub-frame's own id when one is active", () => {
    expect(
      getActiveScreenIframeId({
        id: "screen-1",
        breakpointWidths: [390, 768],
        activeBreakpointWidth: 768,
      }),
    ).toBe(getBreakpointIframeId("screen-1", 768));
  });

  it("falls back to the primary iframe when activeBreakpointWidth is stale (not in breakpointWidths)", () => {
    // Defends against a screen whose activeBreakpointWidth points at a
    // breakpoint that was since removed — should not resolve to a
    // [data-screen-iframe-id] that no longer exists in the DOM.
    expect(
      getActiveScreenIframeId({
        id: "screen-1",
        breakpointWidths: [390],
        activeBreakpointWidth: 1280,
      }),
    ).toBe("screen-1");
  });

  it("resolves to the primary iframe for a screen with no breakpoints at all", () => {
    expect(getActiveScreenIframeId({ id: "screen-1" })).toBe("screen-1");
  });
});

// ---------------------------------------------------------------------------
// Breakpoint sub-frame geometry (BP-DEEP item 3a): undistorted, uniform scale
// ---------------------------------------------------------------------------
describe("getBreakpointFrameGeometry (BP-DEEP item 3a — no non-uniform scale)", () => {
  it("scales the iframe uniformly — never a different factor per axis", () => {
    // The original bug forced frameHeight to the PRIMARY frame's height
    // regardless of the breakpoint's own natural aspect, producing a
    // transform: scale(x, y) with x !== y (visible stretch/squish). The
    // fixed geometry always derives frameHeight from the breakpoint's OWN
    // naturalHeight, uniformly scaled — so the effective scale factor is
    // identical whichever axis you divide by.
    const geometry = getBreakpointFrameGeometry({
      widthPx: 768,
      naturalAspect: 900 / 1440, // e.g. a 1440x900 base document
      primaryScale: 0.5, // primary frame resized to half its natural width
    });
    const scaleX = geometry.frameWidth / 768;
    const scaleY = geometry.frameHeight / geometry.naturalHeight;
    expect(scaleX).toBeCloseTo(scaleY, 5);
    expect(scaleX).toBeCloseTo(0.5, 5);
  });

  it("does not force the breakpoint frame's height to equal the primary's height", () => {
    // A narrower breakpoint with the SAME aspect ratio as the primary is
    // naturally shorter in absolute px than the primary frame (768 wide vs.
    // 1440 wide) — the fix must not silently re-inflate it back up to the
    // primary's own on-canvas height.
    const primaryGeometryHeight = 900; // primary frame's own on-canvas height
    const geometry = getBreakpointFrameGeometry({
      widthPx: 768,
      naturalAspect: 900 / 1440,
      primaryScale: 1,
    });
    expect(geometry.frameHeight).toBeLessThan(primaryGeometryHeight);
  });

  it("falls back to an identity scale for invalid primaryScale input", () => {
    const zero = getBreakpointFrameGeometry({
      widthPx: 390,
      naturalAspect: 2,
      primaryScale: 0,
    });
    expect(zero.scale).toBe(1);
    const negative = getBreakpointFrameGeometry({
      widthPx: 390,
      naturalAspect: 2,
      primaryScale: -3,
    });
    expect(negative.scale).toBe(1);
    const notFinite = getBreakpointFrameGeometry({
      widthPx: 390,
      naturalAspect: 2,
      primaryScale: Number.NaN,
    });
    expect(notFinite.scale).toBe(1);
  });

  it("derives natural height from the breakpoint's own width and aspect ratio", () => {
    const geometry = getBreakpointFrameGeometry({
      widthPx: 390,
      naturalAspect: 2,
      primaryScale: 1,
    });
    expect(geometry.naturalHeight).toBe(780);
  });
});

// ---------------------------------------------------------------------------
// Breakpoint selection target (BP-DEEP v2 item 3): one selected frame at a time
// ---------------------------------------------------------------------------
describe("isBreakpointSelectionTarget (BP-DEEP v2 item 3)", () => {
  it("true when the active breakpoint width exists in the set", () => {
    expect(
      isBreakpointSelectionTarget({
        breakpointWidths: [390, 810],
        activeBreakpointWidth: 810,
      }),
    ).toBe(true);
  });

  it("false when no breakpoint is active (base is the target)", () => {
    expect(
      isBreakpointSelectionTarget({
        breakpointWidths: [390, 810],
        activeBreakpointWidth: undefined,
      }),
    ).toBe(false);
  });

  it("false for a stale active width no longer in the set — base keeps selection chrome", () => {
    expect(
      isBreakpointSelectionTarget({
        breakpointWidths: [390],
        activeBreakpointWidth: 810,
      }),
    ).toBe(false);
  });

  it("false for a screen with no breakpoints at all", () => {
    expect(isBreakpointSelectionTarget({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STEVE TEST BATCH 3 item 8b — overview breakpoint frame "…" menu gate
// ---------------------------------------------------------------------------
describe("shouldShowBreakpointMenuAffordance (item 8b)", () => {
  it("false when the viewer cannot edit, even if active", () => {
    expect(
      shouldShowBreakpointMenuAffordance({
        canEdit: false,
        hasRemoveOrChangeWidth: true,
        isActive: true,
        menuOpen: false,
      }),
    ).toBe(false);
  });

  it("false when neither Remove nor Change-width is wired", () => {
    expect(
      shouldShowBreakpointMenuAffordance({
        canEdit: true,
        hasRemoveOrChangeWidth: false,
        isActive: true,
        menuOpen: false,
      }),
    ).toBe(false);
  });

  it("false for an idle (non-active, closed-menu) frame", () => {
    expect(
      shouldShowBreakpointMenuAffordance({
        canEdit: true,
        hasRemoveOrChangeWidth: true,
        isActive: false,
        menuOpen: false,
      }),
    ).toBe(false);
  });

  it("true for the active breakpoint frame", () => {
    expect(
      shouldShowBreakpointMenuAffordance({
        canEdit: true,
        hasRemoveOrChangeWidth: true,
        isActive: true,
        menuOpen: false,
      }),
    ).toBe(true);
  });

  it("true while its own menu is open, even if not the active frame", () => {
    expect(
      shouldShowBreakpointMenuAffordance({
        canEdit: true,
        hasRemoveOrChangeWidth: true,
        isActive: false,
        menuOpen: true,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vector edit mode (P-VE1): coordinate mapping + hit-test priority
//
// MultiScreenCanvas isn't render-testable in this vitest environment (no
// jsdom `environment`, no @testing-library/react in this package — see the
// harness-limitation note in the smoke test below), so these tests cover the
// pure coordinate/hit-test logic that backs the interactive overlay:
// local<->canvas point mapping (vectorEditLocalToCanvasPoint /
// vectorEditCanvasToLocalPoint), the screen-px->canvas-px hit-radius
// conversion (screenPxToCanvasPx), and — via the already-tested pen-path.ts
// primitives — the "handles take priority over anchors when overlapping"
// hit-test ordering the overlay's mousedown handler relies on.
// ---------------------------------------------------------------------------
describe("vector edit: local/canvas coordinate mapping", () => {
  it("maps a local point to canvas space by adding the origin", () => {
    expect(
      vectorEditLocalToCanvasPoint({ x: 10, y: 20 }, { x: 100, y: 200 }),
    ).toEqual({ x: 110, y: 220 });
  });

  it("maps a canvas point back to local space by subtracting the origin", () => {
    expect(
      vectorEditCanvasToLocalPoint({ x: 110, y: 220 }, { x: 100, y: 200 }),
    ).toEqual({ x: 10, y: 20 });
  });

  it("round-trips local -> canvas -> local for arbitrary points/origins", () => {
    const origin = { x: -37.5, y: 812.25 };
    const local = { x: 4.5, y: -9 };
    const canvas = vectorEditLocalToCanvasPoint(local, origin);
    expect(vectorEditCanvasToLocalPoint(canvas, origin)).toEqual(local);
  });

  it("is a no-op when origin is (0,0)", () => {
    const local = { x: 42, y: -7 };
    expect(vectorEditLocalToCanvasPoint(local, { x: 0, y: 0 })).toEqual(local);
    expect(vectorEditCanvasToLocalPoint(local, { x: 0, y: 0 })).toEqual(local);
  });
});

describe("vector edit: screenPxToCanvasPx zoom conversion", () => {
  it("is a no-op at 100% zoom", () => {
    expect(screenPxToCanvasPx(8, 100)).toBe(8);
  });

  it("grows the canvas-space radius when zoomed out (matches a constant screen size)", () => {
    // At 50% zoom, one canvas px covers half a screen px, so hitting the
    // same *screen*-sized radius requires a larger canvas-space radius.
    expect(screenPxToCanvasPx(8, 50)).toBe(16);
  });

  it("shrinks the canvas-space radius when zoomed in", () => {
    expect(screenPxToCanvasPx(8, 200)).toBe(4);
  });

  it("falls back to the raw screen px for a non-positive zoom", () => {
    expect(screenPxToCanvasPx(8, 0)).toBe(8);
    expect(screenPxToCanvasPx(8, -10)).toBe(8);
  });
});

describe("vector edit: hit-test priority (handles over anchors when overlapping)", () => {
  // A node whose handleOut coincides exactly with the anchor point (e.g. a
  // freshly-converted "smooth" node whose handle hasn't been dragged out
  // yet) — both hitTestPenAnchor and hitTestPenHandle should match the same
  // point, and the overlay's mousedown handler must check handles first so
  // the handle wins.
  const overlappingPath: PenPath = {
    nodes: [
      {
        point: { x: 50, y: 50 },
        handleOut: { x: 50, y: 50 },
      },
    ],
    closed: false,
  };

  it("both an anchor and a handle can match the same point", () => {
    const point = { x: 50, y: 50 };
    expect(hitTestPenAnchor(overlappingPath, point, 8)).toEqual({
      nodeIndex: 0,
    });
    expect(hitTestPenHandle(overlappingPath, point, 8)).toEqual({
      nodeIndex: 0,
      which: "out",
    });
  });

  it("checking hitTestPenHandle before hitTestPenAnchor resolves the handle as the winner", () => {
    const point = { x: 50, y: 50 };
    // This mirrors MultiScreenCanvas's handleMouseDown vectorEdit branch:
    // hitTestPenHandle is checked first, and only falls through to
    // hitTestPenAnchor when no handle is in range.
    const handleHit = hitTestPenHandle(overlappingPath, point, 8);
    const winner = handleHit
      ? { kind: "handle" as const, ...handleHit }
      : (() => {
          const anchorHit = hitTestPenAnchor(overlappingPath, point, 8);
          return anchorHit ? { kind: "anchor" as const, ...anchorHit } : null;
        })();
    expect(winner).toEqual({ kind: "handle", nodeIndex: 0, which: "out" });
  });

  it("falls through to the anchor when no handle is in range", () => {
    const cornerPath: PenPath = {
      nodes: [{ point: { x: 0, y: 0 } }],
      closed: false,
    };
    expect(hitTestPenHandle(cornerPath, { x: 0, y: 0 }, 8)).toBeNull();
    expect(hitTestPenAnchor(cornerPath, { x: 0, y: 0 }, 8)).toEqual({
      nodeIndex: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Smoke-test harness note (P-VE1):
//
// The task asked for a smoke test asserting the vector-edit overlay renders
// the correct anchor/handle counts for a given path, if the harness supports
// component rendering. It does not: this package's vitest.config has no
// `test.environment` (defaults to "node", no DOM) and has no
// @testing-library/react (or any React renderer) dependency — confirmed by
// grepping every *.test.ts(x) file under app/components/design, none of
// which render a component; MotionDock.test.tsx and friends all test pure
// exported functions the same way this file does. Adding a DOM/render
// environment is a package-wide harness change out of scope for this
// overlay, so overlay rendering is instead covered indirectly: the anchor
// count always equals path.nodes.length and the handle count always equals
// the number of present handleIn/handleOut across all nodes (see
// VectorEditOverlay's canvasPath.nodes.map / .flatMap in MultiScreenCanvas.tsx),
// which is exactly what getPenPathGeometry/serializePenPath (already
// exercised elsewhere) are computed over, so a positive assertion here would
// only restate that mapping rather than exercise any DOM output.
// ---------------------------------------------------------------------------

describe("computeAltHoverMeasurement (Figma-parity alt-hover distance lines)", () => {
  function bounds(x: number, y: number, w: number, h: number): FrameBounds {
    const b = getFrameGroupBounds([
      { id: "x", geometry: makeGeom(x, y, w, h) },
    ]);
    if (!b) throw new Error("expected bounds");
    return b;
  }

  it("measures the horizontal gap when the hovered object is to the right", () => {
    const selection = bounds(0, 0, 100, 100);
    const hovered = bounds(150, 20, 50, 50);
    const { horizontal, vertical } = computeAltHoverMeasurement(
      selection,
      hovered,
    );
    expect(horizontal).not.toBeNull();
    expect(horizontal?.gap).toBe(50);
    expect(horizontal?.start).toBe(100);
    expect(horizontal?.end).toBe(150);
    expect(horizontal?.overlaps).toBe(false);
    // Boxes overlap vertically (0-100 vs 20-70), so the cross position is
    // centered on that overlap range (20 to 70), not the naive
    // center-to-center average.
    expect(horizontal?.crossPosition).toBe(45);
    expect(vertical).toBeNull();
  });

  it("measures the horizontal gap when the hovered object is to the left", () => {
    const selection = bounds(200, 0, 100, 100);
    const hovered = bounds(0, 0, 50, 50);
    const { horizontal } = computeAltHoverMeasurement(selection, hovered);
    expect(horizontal).not.toBeNull();
    expect(horizontal?.gap).toBe(150);
    expect(horizontal?.start).toBe(50);
    expect(horizontal?.end).toBe(200);
  });

  it("measures the vertical gap when the hovered object is below", () => {
    const selection = bounds(0, 0, 100, 100);
    const hovered = bounds(20, 200, 50, 50);
    const { horizontal, vertical } = computeAltHoverMeasurement(
      selection,
      hovered,
    );
    expect(horizontal).toBeNull();
    expect(vertical).not.toBeNull();
    expect(vertical?.gap).toBe(100);
    expect(vertical?.start).toBe(100);
    expect(vertical?.end).toBe(200);
    // Boxes overlap horizontally (0-100 vs 20-70) so cross position centers
    // on that overlap range (20 to 70).
    expect(vertical?.crossPosition).toBe(45);
  });

  it("measures the vertical gap when the hovered object is above", () => {
    const selection = bounds(0, 200, 100, 100);
    const hovered = bounds(20, 0, 50, 50);
    const { vertical } = computeAltHoverMeasurement(selection, hovered);
    expect(vertical).not.toBeNull();
    expect(vertical?.gap).toBe(150);
    expect(vertical?.start).toBe(50);
    expect(vertical?.end).toBe(200);
  });

  it("measures both axes for a diagonally-offset object (no overlap on either axis)", () => {
    const selection = bounds(0, 0, 100, 100);
    const hovered = bounds(200, 300, 50, 50);
    const { horizontal, vertical } = computeAltHoverMeasurement(
      selection,
      hovered,
    );
    expect(horizontal).not.toBeNull();
    expect(horizontal?.gap).toBe(100);
    expect(vertical).not.toBeNull();
    expect(vertical?.gap).toBe(200);
    // No overlap on either axis: cross position falls back to the average of
    // the two boxes' centers on that axis.
    expect(horizontal?.crossPosition).toBe((50 + 325) / 2);
    expect(vertical?.crossPosition).toBe((50 + 225) / 2);
  });

  it("returns null for an axis where the boxes overlap (nothing to measure)", () => {
    const selection = bounds(0, 0, 100, 100);
    const hovered = bounds(50, 50, 100, 100);
    const { horizontal, vertical } = computeAltHoverMeasurement(
      selection,
      hovered,
    );
    expect(horizontal).toBeNull();
    expect(vertical).toBeNull();
  });

  it("is symmetric in gap size regardless of which box is the selection", () => {
    const a = bounds(0, 0, 100, 100);
    const b = bounds(300, 0, 100, 100);
    const forward = computeAltHoverMeasurement(a, b);
    const backward = computeAltHoverMeasurement(b, a);
    expect(forward.horizontal?.gap).toBe(backward.horizontal?.gap);
  });
});

// ---------------------------------------------------------------------------
// getOutsideFrameDraftFallback
//
// Backs getTargetFrameForDraft's fallback branch: where a drawn primitive
// lands once its center is confirmed outside every screen frame. A board
// handler should always win regardless of screen count — the previous bug
// absorbed the draft into the lone screen whenever there was exactly one,
// shoving shapes drawn on empty canvas space into that screen instead of
// placing them on the board.
// ---------------------------------------------------------------------------
describe("getOutsideFrameDraftFallback", () => {
  it("routes to the board (returns undefined) with a single screen when a board handler exists", () => {
    const entries = [{ id: "sA" }];
    const result = getOutsideFrameDraftFallback(entries, {
      hasBoardDrawHandler: true,
    });
    expect(result).toBeUndefined();
  });

  it("routes to the board (returns undefined) with multiple screens when a board handler exists", () => {
    const entries = [{ id: "sA" }, { id: "sB" }, { id: "sC" }];
    const result = getOutsideFrameDraftFallback(entries, {
      hasBoardDrawHandler: true,
    });
    expect(result).toBeUndefined();
  });

  it("absorbs into the only screen as a last resort when there is no board handler", () => {
    const entries = [{ id: "sA" }];
    const result = getOutsideFrameDraftFallback(entries, {
      hasBoardDrawHandler: false,
    });
    expect(result).toBe(entries[0]);
  });

  it("absorbs into the first screen as a last resort with multiple screens and no board handler", () => {
    const entries = [{ id: "sA" }, { id: "sB" }];
    const result = getOutsideFrameDraftFallback(entries, {
      hasBoardDrawHandler: false,
    });
    expect(result).toBe(entries[0]);
  });

  it("returns undefined when there are no screens at all, board handler or not", () => {
    expect(
      getOutsideFrameDraftFallback([], { hasBoardDrawHandler: true }),
    ).toBeUndefined();
    expect(
      getOutsideFrameDraftFallback([], { hasBoardDrawHandler: false }),
    ).toBeUndefined();
  });
});
