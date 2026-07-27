import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These tests exercise the REAL alignment/smart-guide snap math that
 * `editor-chrome.bridge.ts` uses while dragging an element inside a screen's
 * sandboxed iframe (see the "Alignment / smart-guide snapping" section of
 * that file, just above `startMove`).
 *
 * Rather than copy the math (which would drift), we pull `rectBounds` and
 * `computeMoveSnapOffset` directly out of the compiled generated bridge
 * string, following the same "extract pure logic from the compiled bridge"
 * convention as motion-preview-bridge.test.ts. Unlike that file, we don't run
 * the entire bridge body through `new Function` — the editor-chrome bridge's
 * top-level body creates DOM overlays and wires up document-level listeners,
 * which would need a much heavier DOM stub than these two pure, side-effect-
 * free functions require. Instead we isolate just the two function
 * declarations (via brace-matched source extraction) and evaluate only that
 * snippet, so the test still runs against the actual shipped/compiled source
 * rather than a hand-copied re-implementation.
 *
 * Source: app/components/design/bridge/editor-chrome.bridge.ts
 * Compiled: .generated/bridge/editor-chrome.generated.ts
 */

interface SnapGuide {
  position: number;
  start: number;
  end: number;
}

interface SnapResult {
  dx: number;
  dy: number;
  guideV: SnapGuide | null;
  guideH: SnapGuide | null;
}

interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface MovingRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function extractFunction(src: string, name: string): string {
  const startMarker = `function ${name}(`;
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`${name} not found in compiled editor-chrome bridge`);
  }
  const braceStart = src.indexOf("{", startIdx);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return src.slice(startIdx, i);
}

function loadEditorChromeBridgeScript(): string {
  const generatedPath = fileURLToPath(
    new URL(
      "../../../.generated/bridge/editor-chrome.generated.ts",
      import.meta.url,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { editorChromeBridgeScript } = require(generatedPath) as {
    editorChromeBridgeScript: string;
  };
  return editorChromeBridgeScript;
}

function loadSnapMath(): {
  rectBounds: (rect: MovingRect | DOMRect) => RectBounds;
  computeMoveSnapOffset: (
    movingRect: MovingRect,
    candidates: RectBounds[],
    threshold: number,
  ) => SnapResult;
} {
  const editorChromeBridgeScript = loadEditorChromeBridgeScript();

  const rectBoundsSrc = extractFunction(editorChromeBridgeScript, "rectBounds");
  const computeMoveSnapOffsetSrc = extractFunction(
    editorChromeBridgeScript,
    "computeMoveSnapOffset",
  );

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    `${rectBoundsSrc}\n${computeMoveSnapOffsetSrc}\nreturn { rectBounds, computeMoveSnapOffset };`,
  );
  return factory();
}

const { rectBounds, computeMoveSnapOffset } = loadSnapMath();

function loadSelectionTargetForHit(documentRoot: {
  body: Element;
  documentElement: Element;
}): (hit: Element | null) => Element | null {
  const editorChromeBridgeScript = loadEditorChromeBridgeScript();
  const rootCheck = extractFunction(
    editorChromeBridgeScript,
    "isDocumentRootElement",
  );
  const selectionTarget = extractFunction(
    editorChromeBridgeScript,
    "selectionTargetForHit",
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "document",
    `${rootCheck}\n${selectionTarget}\nreturn selectionTargetForHit;`,
  );
  return factory(documentRoot);
}

describe("editor-chrome bridge — rectBounds", () => {
  it("derives right/bottom/center from left/top/width/height for a plain drag rect", () => {
    expect(rectBounds({ left: 10, top: 20, width: 100, height: 50 })).toEqual({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
      centerX: 60,
      centerY: 45,
    });
  });

  it("works identically for a DOMRect-shaped object (right/bottom present but ignored in favor of left+width)", () => {
    const domRectLike = {
      left: 0,
      top: 0,
      width: 40,
      height: 40,
      right: 999, // intentionally inconsistent — must not be read directly
      bottom: 999,
    };
    expect(rectBounds(domRectLike)).toEqual({
      left: 0,
      top: 0,
      right: 40,
      bottom: 40,
      centerX: 20,
      centerY: 20,
    });
  });
});

describe("editor-chrome bridge — selectionTargetForHit", () => {
  it("selects an id-less nested list item directly instead of its tagged parent", () => {
    const body = {} as Element;
    const documentElement = {} as Element;
    const selectionTargetForHit = loadSelectionTargetForHit({
      body,
      documentElement,
    });
    const taggedParent = {
      getAttribute: () => "list",
    } as unknown as Element;
    const child = {
      parentElement: taggedParent,
      textContent: "Active",
    } as unknown as Element;

    expect(selectionTargetForHit(child)).toBe(child);
  });
});

describe("editor-chrome bridge — computeMoveSnapOffset", () => {
  it("returns a zero offset and no guides when nothing is within threshold", () => {
    const moving = { left: 500, top: 500, width: 100, height: 100 };
    const candidates = [rectBounds({ left: 0, top: 0, width: 50, height: 50 })];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result).toEqual({ dx: 0, dy: 0, guideV: null, guideH: null });
  });

  it("snaps the moving rect's left edge to a candidate's left edge within threshold", () => {
    // Candidate sits with its left edge at x=100. Moving rect's left edge is
    // at 104 (4px away, within the 6px threshold) — snapping should report a
    // +(-4) offset that would bring left from 104 to 100.
    const moving = { left: 104, top: 300, width: 80, height: 40 };
    const candidates = [
      rectBounds({ left: 100, top: 0, width: 60, height: 60 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(-4);
    expect(result.guideV).not.toBeNull();
    expect(result.guideV?.position).toBe(100);
  });

  it("snaps to the closest of several within-threshold candidates on each axis", () => {
    // Two candidates: one whose right edge is 3px from moving's left edge,
    // another whose right edge is 5px away — the 3px one should win.
    const moving = { left: 203, top: 100, width: 50, height: 50 };
    const candidates = [
      rectBounds({ left: 100, top: 0, width: 100, height: 20 }), // right = 200, distance 3
      rectBounds({ left: 90, top: 0, width: 108, height: 20 }), // right = 198, distance 5
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(-3);
  });

  it("ignores candidates farther than the threshold", () => {
    const moving = { left: 120, top: 100, width: 50, height: 50 };
    const candidates = [
      rectBounds({ left: 100, top: 0, width: 10, height: 10 }), // right = 110, distance 10 > 6
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(0);
    expect(result.guideV).toBeNull();
  });

  it("snaps center-to-center as well as edge-to-edge", () => {
    // Candidate center at x=300 (left 250, width 100). Moving rect center is
    // at 297 (left 272, width 50) — 3px away, within threshold.
    const moving = { left: 272, top: 400, width: 50, height: 50 };
    const candidates = [
      rectBounds({ left: 250, top: 0, width: 100, height: 20 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(3);
    expect(result.guideV?.position).toBe(300);
  });

  it("computes independent x and y snap offsets in the same call", () => {
    // Candidate A's right edge (x=100) is 4px from moving's left edge (104);
    // its own left/center are far away so it can only match on the x-axis.
    // Candidate B's bottom edge (y=200) is 6px from moving's top edge (206);
    // its own left/center are far away so it can only match on the y-axis.
    const moving = { left: 104, top: 206, width: 40, height: 40 };
    const candidates = [
      rectBounds({ left: 50, top: 900, width: 50, height: 10 }),
      rectBounds({ left: 900, top: 150, width: 10, height: 50 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(-6);
    expect(result.guideV).not.toBeNull();
    expect(result.guideH).not.toBeNull();
  });

  it("guide line extents span the union of the moving and candidate bounds on the cross axis", () => {
    // Candidate's left edge sits at x=100, 4px from moving's left edge
    // (104). Its own right edge (600) and center (350) are far from every
    // moving x-value (104/124/144), so the left-edge match unambiguously
    // wins.
    const moving = { left: 104, top: 50, width: 40, height: 200 };
    const candidates = [
      rectBounds({ left: 100, top: 300, width: 500, height: 10 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    // Vertical guide (x snap) spans min(movingTop, candidateTop) to
    // max(movingBottom, candidateBottom): min(50, 300)=50, max(250, 310)=310.
    expect(result.guideV).toEqual({ position: 100, start: 50, end: 310 });
  });
});
