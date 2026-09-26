import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";


interface SnapGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

interface SpacingBand {
  gapStart: number;
  gapEnd: number;
  crossStart: number;
  crossEnd: number;
}

interface SpacingGuide {
  orientation: "vertical" | "horizontal";
  gap: number;
  bands: [SpacingBand, SpacingBand];
}

interface ProximityMeasurement {
  orientation: "vertical" | "horizontal";
  gap: number;
  band: SpacingBand;
}

interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
  spacingGuides: SpacingGuide[];
  measurements: ProximityMeasurement[];
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
    isGroup?: boolean,
  ) => SnapResult;
} {
  const editorChromeBridgeScript = loadEditorChromeBridgeScript();

  const sources = [
    "rectBounds",
    "axisSnapValues",
    "axisStart",
    "axisEnd",
    "crossStart",
    "crossEnd",
    "crossAxisOverlaps",
    "translateRectBounds",
    "findAxisSnapOffset",
    "buildAxisGuides",
    "collectAxisGapCandidates",
    "closestGapCandidate",
    "collectRhythmGaps",
    "findSpacingSnapOffset",
    "gapCandidateBand",
    "matchingRhythmBands",
    "buildSpacingGuides",
    "computeProximityMeasurements",
    "computeMoveSnapOffset",
  ].map((name) => extractFunction(editorChromeBridgeScript, name));

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    `var SNAP_ALIGN_EPSILON = 1e-6;\nvar SPACING_MATCH_EPSILON = 0.5;\nvar PROXIMITY_RANGE_PX = 160;\nvar SNAP_THRESHOLD_PX = 6;\n${sources.join("\n")}\nreturn { rectBounds, computeMoveSnapOffset };`,
  );
  return factory();
}

const { rectBounds, computeMoveSnapOffset } = loadSnapMath();
const mergeFlipIntoTransform = loadPureBridgeFn<
  (transform: string, flipX: boolean, flipY: boolean) => string
>("mergeFlipIntoTransform");
const mergeRelativeScale = loadPureBridgeFn<
  (scale: string, flipX: boolean, flipY: boolean) => string
>("mergeRelativeScale", ["readScalePair"]);

function loadPureBridgeFn<T>(name: string, dependencies: string[] = []): T {
  const editorChromeBridgeScript = loadEditorChromeBridgeScript();
  const sources = [...dependencies, name].map((fnName) =>
    extractFunction(editorChromeBridgeScript, fnName),
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${sources.join("\n")}\nreturn ${name};`);
  return factory() as T;
}

interface DragTargetArgs {
  selectedEl: unknown;
  selectedAlive: boolean;
  selectedRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  hitEl: unknown;
  hitRaw?: unknown;
  point: { x: number; y: number } | null;
  preferSelected: boolean;
}
const dragTargetForPointerDown = loadPureBridgeFn<
  (args: DragTargetArgs) => unknown
>("dragTargetForPointerDown", ["containerScopeAncestor"]);
const nextStackCandidate =
  loadPureBridgeFn<(keys: string[], current: string | null) => string | null>(
    "nextStackCandidate",
  );
const resolveCornerRadiusXY = loadPureBridgeFn<
  (value: string, width: number, height: number) => { x: number; y: number }
>("resolveCornerRadiusXY", ["readPx", "resolveCornerRadiusComponent"]);
const isDirectCornerRadiusValue = loadPureBridgeFn<(value: string) => boolean>(
  "isDirectCornerRadiusValue",
);
const composeRadiusLinearTransform = loadPureBridgeFn<
  (
    transform: { a: number; b: number; c: number; d: number },
    scaleX: number,
    scaleY: number,
    radians: number,
  ) => { a: number; b: number; c: number; d: number }
>("composeRadiusLinearTransform");
const radiusDragMaximums =
  loadPureBridgeFn<
    (
      corner: string,
      radii: Record<string, { x: number; y: number }>,
      width: number,
      height: number,
    ) => { x: number; y: number }
  >("radiusDragMaximums");

describe("editor-chrome bridge — resize transform preservation", () => {
  it("preserves authored transforms until a relative mirror is required", () => {
    const authored = "translate(15px, 20px) scale(-2, 3)";
    expect(mergeFlipIntoTransform(authored, false, false)).toBe(authored);
    expect(mergeFlipIntoTransform(authored, true, false)).toBe(
      `${authored} matrix(-1, 0, 0, 1, 0, 0)`,
    );
    expect(
      mergeFlipIntoTransform("matrix(2, 0, 0, 3, 15, 20)", false, true),
    ).toBe("matrix(2, 0, 0, 3, 15, 20) matrix(1, 0, 0, -1, 0, 0)");
  });

  it("mirrors independent scale without double-applying authored values", () => {
    expect(mergeRelativeScale("2 3", true, false)).toBe("-2 3");
    expect(mergeRelativeScale("-2 3", true, false)).toBe("2 3");
    expect(mergeRelativeScale("none", false, true)).toBe("1 -1");
  });
});

describe("editor-chrome bridge — corner radius math", () => {
  it("resolves percentage radii against the border box axes", () => {
    expect(resolveCornerRadiusXY("50%", 200, 100)).toEqual({ x: 100, y: 50 });
  });

  it("uses computed geometry when the authored radius is tokenized", () => {
    const authored = "var(--radius)";
    const computed = "24px";
    const value = isDirectCornerRadiusValue(authored) ? authored : computed;
    expect(isDirectCornerRadiusValue(authored)).toBe(false);
    expect(resolveCornerRadiusXY(value, 200, 100)).toEqual({ x: 24, y: 24 });
  });

  it("composes independent scale after a transformed element", () => {
    expect(
      composeRadiusLinearTransform({ a: 0, b: 1, c: -1, d: 0 }, 2, 3, 0),
    ).toEqual({ a: 0, b: 3, c: -2, d: 0 });
  });

  it("leaves room for the adjacent corners before clamping a drag", () => {
    expect(
      radiusDragMaximums(
        "nw",
        {
          nw: { x: 10, y: 10 },
          ne: { x: 140, y: 20 },
          se: { x: 10, y: 10 },
          sw: { x: 20, y: 70 },
        },
        200,
        100,
      ),
    ).toEqual({ x: 60, y: 30 });
  });
});

describe("editor-chrome bridge — dragTargetForPointerDown", () => {
  const selRect = {
    left: 10,
    top: 10,
    right: 110,
    bottom: 60,
    width: 100,
    height: 50,
  };

  it("keeps the selected element when the hit is its descendant (legacy rule, flag off)", () => {
    const hitRaw = { tag: "child" };
    const selectedEl = { tag: "sel", contains: (x: unknown) => x === hitRaw };
    const hitEl = { tag: "hitTarget" };
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: null,
        hitEl,
        hitRaw,
        point: { x: 0, y: 0 },
        preferSelected: false,
      }),
    ).toBe(selectedEl);
  });

  it("keeps the container when the hit is its own background", () => {
    const hitRaw = { tag: "bg" };
    const selectedEl = { tag: "sel", contains: (x: unknown) => x === hitRaw };
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: null,
        hitEl: selectedEl,
        hitRaw,
        point: { x: 0, y: 0 },
        preferSelected: false,
      }),
    ).toBe(selectedEl);
  });

  it("keeps the selected element when the point is inside its box over an overlapping sibling (flag on)", () => {
    const hitRaw = { tag: "sibling-on-top" };
    const selectedEl = { tag: "sel", contains: () => false };
    const hitEl = hitRaw;
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: selRect,
        hitEl,
        hitRaw,
        point: { x: 50, y: 30 },
        preferSelected: true,
      }),
    ).toBe(selectedEl);
  });

  it("selects the overlapping top sibling when the flag is off (legacy hit wins)", () => {
    const hitRaw = { tag: "sibling-on-top" };
    const selectedEl = { tag: "sel", contains: () => false };
    const hitEl = hitRaw;
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: selRect,
        hitEl,
        hitRaw,
        point: { x: 50, y: 30 },
        preferSelected: false,
      }),
    ).toBe(hitEl);
  });

  it("falls through to the hit when the point is outside the selected box", () => {
    const hitRaw = { tag: "elsewhere" };
    const selectedEl = { tag: "sel", contains: () => false };
    const hitEl = hitRaw;
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: selRect,
        hitEl,
        hitRaw,
        point: { x: 500, y: 500 },
        preferSelected: true,
      }),
    ).toBe(hitEl);
  });

  it("falls through to the hit when the selected element is detached (selectedAlive false)", () => {
    const hitRaw = { tag: "hit" };
    const selectedEl = { tag: "sel", contains: () => true };
    const hitEl = hitRaw;
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: false,
        selectedRect: selRect,
        hitEl,
        hitRaw,
        point: { x: 50, y: 30 },
        preferSelected: true,
      }),
    ).toBe(hitEl);
  });

  it("keeps the selected element even when the top hit is a (locked) layer — locking is the caller's concern", () => {
    const lockedTop = { tag: "locked-top" };
    const selectedEl = { tag: "sel", contains: () => false };
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: selRect,
        hitEl: lockedTop,
        hitRaw: lockedTop,
        point: { x: 50, y: 30 },
        preferSelected: true,
      }),
    ).toBe(selectedEl);
  });

  it("falls through when the selected box is zero-area (hidden element)", () => {
    const hitRaw = { tag: "hit" };
    const selectedEl = { tag: "sel", contains: () => false };
    const hitEl = hitRaw;
    expect(
      dragTargetForPointerDown({
        selectedEl,
        selectedAlive: true,
        selectedRect: {
          left: 10,
          top: 10,
          right: 10,
          bottom: 10,
          width: 0,
          height: 0,
        },
        hitEl,
        hitRaw,
        point: { x: 10, y: 10 },
        preferSelected: true,
      }),
    ).toBe(hitEl);
  });
});

describe("editor-chrome bridge — nextStackCandidate", () => {
  const stack = ["a:0", "b:1", "c:2", "d:3"];

  it("returns the next candidate below the current one", () => {
    expect(nextStackCandidate(stack, "b:1")).toBe("c:2");
  });

  it("wraps from the bottom back to the top", () => {
    expect(nextStackCandidate(stack, "d:3")).toBe("a:0");
  });

  it("moves from the top hit to the one just below it", () => {
    expect(nextStackCandidate(stack, "a:0")).toBe("b:1");
  });

  it("returns null when the current selection is not in the stack", () => {
    expect(nextStackCandidate(stack, "z:9")).toBeNull();
  });

  it("returns null for an empty stack", () => {
    expect(nextStackCandidate([], "a:0")).toBeNull();
  });

  it("wraps to itself for a single-candidate stack", () => {
    expect(nextStackCandidate(["only:0"], "only:0")).toBe("only:0");
  });
});

function loadSelectionTargetForHit(documentRoot: {
  body: Element;
  documentElement: Element;
}): (hit: Element | null, descendIntoGroup?: boolean) => Element | null {
  const editorChromeBridgeScript = loadEditorChromeBridgeScript();
  const rootCheck = extractFunction(
    editorChromeBridgeScript,
    "isDocumentRootElement",
  );
  const selectionTarget = extractFunction(
    editorChromeBridgeScript,
    "selectionTargetForHit",
  );
  const svgAncestor = extractFunction(
    editorChromeBridgeScript,
    "outermostSvgAncestor",
  );
  const pastedSvgShape = extractFunction(
    editorChromeBridgeScript,
    "pastedSvgShapeForHit",
  );
  const textOverlay = extractFunction(
    editorChromeBridgeScript,
    "unwrapTextOverlay",
  );
  const nativeTextPrimitive = extractFunction(
    editorChromeBridgeScript,
    "nativeTextPrimitiveForHit",
  );
  const layerName = extractFunction(
    editorChromeBridgeScript,
    "layerNameForElement",
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "document",
    `${rootCheck}\n${svgAncestor}\n${pastedSvgShape}\n${textOverlay}\n${nativeTextPrimitive}\n${layerName}\n${selectionTarget}\nreturn selectionTargetForHit;`,
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

  it("selects an explicit group on first click and descends on double-click", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const group = {
      parentElement: null,
      getAttribute: (name: string) =>
        name === "data-agent-native-layer-name"
          ? "Group"
          : name === "data-agent-native-group-wrapper"
            ? "true"
            : null,
    } as unknown as Element;
    const child = {
      parentElement: group,
      getAttribute: () => null,
    } as unknown as Element;

    expect(selectionTargetForHit(child)).toBe(group);
    expect(selectionTargetForHit(child, true)).toBe(child);
  });

  it("selects a renamed generated group by its marker", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const group = {
      parentElement: null,
      getAttribute: (name: string) =>
        name === "data-agent-native-layer-name"
          ? "Illustrations"
          : name === "data-agent-native-group-wrapper"
            ? "true"
            : null,
    } as unknown as Element;
    const child = {
      parentElement: group,
      getAttribute: () => null,
    } as unknown as Element;

    expect(selectionTargetForHit(child)).toBe(group);
  });

  it("recognizes a legacy generated group without promoting authored clones", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const legacyGroup = {
      parentElement: null,
      getAttribute: (name: string) =>
        name === "data-agent-native-layer-name"
          ? "Group 2"
          : name === "data-agent-native-node-id"
            ? "an-legacygroup"
            : name === "data-agent-native-preserve-styles"
              ? "true"
              : null,
    } as unknown as Element;
    const child = {
      parentElement: legacyGroup,
      getAttribute: () => null,
    } as unknown as Element;
    const copiedGroup = {
      parentElement: null,
      getAttribute: (name: string) =>
        name === "data-agent-native-layer-name"
          ? "Group"
          : name === "data-agent-native-node-id"
            ? "copy-authored-group"
            : name === "data-agent-native-preserve-styles" ||
                name === "data-agent-native-clone-root"
              ? "true"
              : null,
    } as unknown as Element;
    const copiedChild = {
      parentElement: copiedGroup,
      getAttribute: () => null,
    } as unknown as Element;
    const oldCopiedGroup = {
      parentElement: null,
      getAttribute: (name: string) =>
        name === "data-agent-native-layer-name"
          ? "Group"
          : name === "data-agent-native-node-id"
            ? "copy-old-authored-group"
            : name === "data-agent-native-preserve-styles"
              ? "true"
              : null,
    } as unknown as Element;
    const oldCopiedChild = {
      parentElement: oldCopiedGroup,
      getAttribute: () => null,
    } as unknown as Element;

    expect(selectionTargetForHit(child)).toBe(legacyGroup);
    expect(selectionTargetForHit(copiedChild)).toBe(copiedChild);
    expect(selectionTargetForHit(oldCopiedChild)).toBe(oldCopiedChild);
  });

  it("promotes a hit on svg geometry to the outermost svg, whose box is not 0-height", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const svg = { ownerSVGElement: null } as unknown as Element;
    const path = { ownerSVGElement: svg } as unknown as Element;

    expect(selectionTargetForHit(path)).toBe(svg);
  });

  it("selects the exact drawable in a marked pasted SVG, but keeps authored SVGs atomic", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const root = {
      ownerSVGElement: null,
      getAttribute: (name: string) =>
        name === "data-an-primitive" ? "pasted-svg" : null,
    } as unknown as Element;
    const path = {
      tagName: "path",
      ownerSVGElement: root,
      parentElement: root,
    } as unknown as Element;
    const authoredRoot = {
      ownerSVGElement: null,
      getAttribute: () => null,
    } as unknown as Element;
    const authoredPath = {
      tagName: "path",
      ownerSVGElement: authoredRoot,
      parentElement: authoredRoot,
    } as unknown as Element;

    expect(selectionTargetForHit(path)).toBe(path);
    expect(selectionTargetForHit(authoredPath)).toBe(authoredRoot);
  });

  it("selects the button, not the editor's own text wrapper inside it", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const button = {
      getAttribute: () => "e2e-component-button",
    } as unknown as Element;
    const wrapper = {
      hasAttribute: (name: string) => name === "data-an-text",
      parentElement: button,
    } as unknown as Element;

    expect(selectionTargetForHit(wrapper)).toBe(button);
  });

  it("keeps a wrapper whose parent is the document root selectable", () => {
    const body = {} as Element;
    const selectionTargetForHit = loadSelectionTargetForHit({
      body,
      documentElement: {} as Element,
    });
    const wrapper = {
      hasAttribute: (name: string) => name === "data-an-text",
      parentElement: body,
    } as unknown as Element;

    expect(selectionTargetForHit(wrapper)).toBe(wrapper);
  });

  it("promotes through a nested svg to the outermost one", () => {
    const selectionTargetForHit = loadSelectionTargetForHit({
      body: {} as Element,
      documentElement: {} as Element,
    });
    const outer = { ownerSVGElement: null } as unknown as Element;
    const inner = { ownerSVGElement: outer } as unknown as Element;
    const path = { ownerSVGElement: inner } as unknown as Element;

    expect(selectionTargetForHit(path)).toBe(outer);
  });
});

const verticalGuide = (result: SnapResult) =>
  result.guides.find((guide) => guide.orientation === "vertical") ?? null;
const horizontalGuide = (result: SnapResult) =>
  result.guides.find((guide) => guide.orientation === "horizontal") ?? null;

describe("editor-chrome bridge — computeMoveSnapOffset", () => {
  it("returns a zero offset and no guides when nothing is within threshold", () => {
    const moving = { left: 500, top: 500, width: 100, height: 100 };
    const candidates = [rectBounds({ left: 0, top: 0, width: 50, height: 50 })];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
      spacingGuides: [],
      measurements: [],
    });
  });

  it("snaps the moving rect's left edge to a candidate's left edge within threshold", () => {
    const moving = { left: 104, top: 300, width: 80, height: 40 };
    const candidates = [
      rectBounds({ left: 100, top: 0, width: 60, height: 60 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(-4);
    expect(verticalGuide(result)?.position).toBe(100);
  });

  it("snaps to the closest of several within-threshold candidates on each axis", () => {
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
    expect(verticalGuide(result)).toBeNull();
  });

  it("snaps center-to-center as well as edge-to-edge", () => {
    const moving = { left: 272, top: 400, width: 50, height: 50 };
    const candidates = [
      rectBounds({ left: 250, top: 0, width: 100, height: 20 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(3);
    expect(verticalGuide(result)?.position).toBe(300);
  });

  it("computes independent x and y snap offsets in the same call", () => {
    const moving = { left: 104, top: 206, width: 40, height: 40 };
    const candidates = [
      rectBounds({ left: 50, top: 900, width: 50, height: 10 }),
      rectBounds({ left: 900, top: 150, width: 10, height: 50 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(-6);
    expect(verticalGuide(result)).not.toBeNull();
    expect(horizontalGuide(result)).not.toBeNull();
  });

  it("guide line extents span the union of the moving and candidate bounds on the cross axis", () => {
    const moving = { left: 104, top: 50, width: 40, height: 200 };
    const candidates = [
      rectBounds({ left: 100, top: 300, width: 500, height: 10 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    expect(verticalGuide(result)).toEqual({
      orientation: "vertical",
      position: 100,
      start: 50,
      end: 310,
    });
  });

  it("draws one guide through every sibling sharing the snapped edge", () => {
    const moving = { left: 103, top: 600, width: 100, height: 100 };
    const candidates = [
      rectBounds({ left: 100, top: 0, width: 140, height: 100 }),
      rectBounds({ left: 100, top: 200, width: 180, height: 100 }),
      rectBounds({ left: 100, top: 400, width: 220, height: 100 }),
    ];
    const result = computeMoveSnapOffset(moving, candidates, 6);
    const vertical = result.guides.filter((g) => g.orientation === "vertical");
    expect(vertical).toHaveLength(1);
    expect(vertical[0]).toEqual({
      orientation: "vertical",
      position: 100,
      start: 0,
      end: 700,
    });
  });
});

describe("editor-chrome bridge — spacing snap", () => {
  const row = (...lefts: number[]) =>
    lefts.map((left) => rectBounds({ left, top: 0, width: 100, height: 100 }));

  it("centers the element between its two neighbors", () => {
    const result = computeMoveSnapOffset(
      { left: 205, top: 0, width: 100, height: 100 },
      row(0, 400),
      6,
    );
    expect(result.dx).toBe(-5);
    expect(result.spacingGuides).toHaveLength(1);
    expect(result.spacingGuides[0].gap).toBe(100);
  });

  it("matches a gap that already exists between two other siblings", () => {
    const result = computeMoveSnapOffset(
      { left: 252, top: 0, width: 100, height: 100 },
      row(0, 124),
      6,
    );
    expect(result.dx).toBe(-4);
    expect(result.spacingGuides[0].gap).toBe(24);
  });

  it("never moves an axis an alignment guide already claimed", () => {
    const result = computeMoveSnapOffset(
      { left: 202, top: 0, width: 100, height: 100 },
      row(0, 200, 400),
      6,
    );
    expect(result.dx).toBe(-2);
  });
});

describe("editor-chrome bridge — group drags", () => {
  const row = (...lefts: number[]) =>
    lefts.map((left) => rectBounds({ left, top: 0, width: 100, height: 100 }));

  it("drops spacing and proximity chrome for a group drag, like the overview", () => {
    const moving = { left: 205, top: 0, width: 100, height: 100 };
    const single = computeMoveSnapOffset(moving, row(0, 400), 6, false);
    expect(
      single.spacingGuides.length + single.measurements.length,
    ).toBeGreaterThan(0);

    const group = computeMoveSnapOffset(moving, row(0, 400), 6, true);
    expect(group.spacingGuides).toEqual([]);
    expect(group.measurements).toEqual([]);
  });

  it("still snaps a group to alignment", () => {
    const group = computeMoveSnapOffset(
      { left: 3, top: 0, width: 100, height: 100 },
      row(0),
      6,
      true,
    );
    expect(group.dx).toBe(-3);
    expect(group.guides.length).toBeGreaterThan(0);
  });
});

describe("editor-chrome bridge — spacing band CSS", () => {
  const spacingBandCss = loadPureBridgeFn<
    (
      orientation: string,
      band: {
        gapStart: number;
        gapEnd: number;
        crossStart: number;
        crossEnd: number;
      },
      line: number,
      fill: string,
    ) => string
  >("spacingBandCss");

  it("paints the band with the fill it was given", () => {
    const css = spacingBandCss(
      "vertical",
      { gapStart: 10, gapEnd: 40, crossStart: 0, crossEnd: 20 },
      1,
      "background:orange;",
    );
    expect(css).toContain("background:orange;");
    expect(css).toContain("width:30px");
  });
});
