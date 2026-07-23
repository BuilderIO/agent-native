import { hashString } from "./board-surface-html";
import {
  boardPointToScreenLocalPoint,
  screenLocalRectToBoardGeometry,
} from "./coordinate-transforms";
import {
  geometryContainsGeometry,
  geometryContainsPoint,
} from "./frame-geometry";
import type {
  CrossScreenDropAxis,
  CrossScreenDropPlacement,
  FrameGeometry,
  FrameGeometryById,
  Point,
  ScreenFile,
} from "./types";

export interface PrimitiveDropTarget {
  nodeId: string;
  screenId: string;
  boardRect: FrameGeometry;
  /**
   * Set when the drop resolves to a flow-insert slot between two auto-layout
   * (flex/grid) children instead of a plain "append inside" drop — mirrors
   * the cross-screen hit-test's placement/axis contract (see
   * getCrossScreenDropGuideForHitTest) so the overview canvas draws the same
   * Figma-style insertion LINE, and the same anchor + placement can be
   * threaded straight through onPrimitiveReparent. Undefined means "inside"
   * (append as the last/only child of `nodeId`), matching pre-existing
   * behavior.
   */
  placement?: CrossScreenDropPlacement;
  axis?: CrossScreenDropAxis;
  /**
   * The sibling node to anchor a before/after flow-insert against. Only set
   * when `placement` is "before" or "after" — `nodeId` still identifies the
   * containing auto-layout primitive so callers can resolve the drop's
   * screen/highlight, while `anchorNodeId` is what the actual moveNode/
   * moveNodeBetweenDocuments call should target as its anchor.
   */
  anchorNodeId?: string;
}

export interface ParsedScreenPrimitive {
  nodeId: string;
  screenId: string;
  /** data-agent-native-node-id of the nearest ancestor primitive, if any. */
  parentNodeId?: string;
  localLeft: number;
  localTop: number;
  localWidth: number;
  localHeight: number;
  isContainer: boolean;
  /**
   * Set when this primitive is itself an auto-layout (flex/grid) container,
   * to the flow axis new children are inserted along ("x" for a row flex/
   * multi-column grid, "y" for column flex/single-column grid). Undefined
   * for plain absolute/canvas-frame containers, which only ever accept an
   * "inside" (append) drop.
   */
  autoLayoutAxis?: CrossScreenDropAxis;
}

/**
 * Mirrors hit-test.bridge.ts's parentFlowAxis: resolves the flow axis new
 * children are inserted along for a flex/grid container, or undefined when
 * the element isn't an auto-layout container at all. Kept in sync with that
 * bridge implementation (which runs against live computed styles inside the
 * iframe) — this version only has the authored inline style available, which
 * is sufficient since auto-layout is always inspector-authored inline CSS.
 */
function computeAutoLayoutAxis(style: {
  display: string;
  flexDirection: string;
  flexWrap: string;
  gridTemplateColumns: string;
}): CrossScreenDropAxis | undefined {
  if (style.display === "flex" || style.display === "inline-flex") {
    const direction = style.flexDirection || "row";
    const wraps =
      style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
    const isRow = direction.startsWith("row");
    return isRow && !wraps ? "x" : "y";
  }
  if (style.display === "grid" || style.display === "inline-grid") {
    const columns = (style.gridTemplateColumns || "")
      .split(" ")
      .filter(Boolean).length;
    return columns > 1 ? "x" : "y";
  }
  return undefined;
}

/**
 * Resolves a between-children flow-insert slot inside `container` from a
 * screen-local drop point — the nearest child (by flow-axis center) becomes
 * the anchor with before/after placement, exactly mirroring hit-test.bridge.
 * ts's nearestChildInsertionTarget so overview-canvas drag-drop and in-iframe
 * cross-screen drag-drop produce the same Figma-style insertion behavior.
 * Returns null when the container isn't auto-layout or has no eligible
 * children (callers fall back to "inside" append).
 */
export function findAutoLayoutInsertionAnchor(
  container: ParsedScreenPrimitive,
  screenPrimitives: ParsedScreenPrimitive[],
  localPoint: Point,
  excludeNodeId: string | null,
): { anchorNodeId: string; placement: "before" | "after" } | null {
  const axis = container.autoLayoutAxis;
  if (!axis) return null;
  let best: ParsedScreenPrimitive | null = null;
  let bestDistance = Infinity;
  let placement: "before" | "after" = "after";
  for (const sibling of screenPrimitives) {
    if (sibling.parentNodeId !== container.nodeId) continue;
    if (excludeNodeId && sibling.nodeId === excludeNodeId) continue;
    const center =
      axis === "x"
        ? sibling.localLeft + sibling.localWidth / 2
        : sibling.localTop + sibling.localHeight / 2;
    const pointer = axis === "x" ? localPoint.x : localPoint.y;
    const distance = Math.abs(pointer - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sibling;
      placement = pointer < center ? "before" : "after";
    }
  }
  if (!best) return null;
  return { anchorNodeId: best.nodeId, placement };
}

export function getPrimitiveLowZoomHitRect(
  primitive: ParsedScreenPrimitive,
  zoom: number,
  minimumScreenPixels = 6,
): FrameGeometry {
  const scale = Math.max(0.0001, zoom / 100);
  const minimumWorldSize = minimumScreenPixels / scale;
  const width = Math.max(primitive.localWidth, minimumWorldSize);
  const height = Math.max(primitive.localHeight, minimumWorldSize);
  return {
    x: primitive.localLeft - (width - primitive.localWidth) / 2,
    y: primitive.localTop - (height - primitive.localHeight) / 2,
    width,
    height,
  };
}

export function isPrimitiveContainer(args: {
  tagName: string;
  primitiveKind: string;
  display: string;
  borderRadius: string;
}): boolean {
  const isDiv = args.tagName.toLowerCase() === "div";
  const primitiveKind = args.primitiveKind.toLowerCase();
  const isEllipse =
    args.borderRadius === "50%" || args.borderRadius === "50% 50% 50% 50%";
  const isTextAutoSize = args.display === "inline-block";
  const isAutoLayout =
    args.display === "flex" ||
    args.display === "inline-flex" ||
    args.display === "grid" ||
    args.display === "inline-grid";
  // Canvas frames are structural containers even before Auto layout is
  // enabled. Treating only rectangles as freeform containers made a freshly
  // drawn frame reject child drops until the user changed its display mode.
  const isCanvasContainer =
    isDiv &&
    (primitiveKind === "rectangle" ||
      primitiveKind === "rect" ||
      primitiveKind === "frame");
  return (
    isDiv &&
    !isEllipse &&
    !isTextAutoSize &&
    (isAutoLayout || isCanvasContainer)
  );
}

export const primitiveParseCache = new Map<string, ParsedScreenPrimitive[]>();
const PRIMITIVE_PARSE_CACHE_MAX = 64;
const PRIMITIVE_IDENTITY_CACHE_MAX = 64;
const primitiveParseIdentityCache = new Map<
  string,
  { content: string; result: ParsedScreenPrimitive[] }
>();

function rememberPrimitiveIdentity(
  screenId: string,
  content: string,
  result: ParsedScreenPrimitive[],
) {
  primitiveParseIdentityCache.delete(screenId);
  if (primitiveParseIdentityCache.size >= PRIMITIVE_IDENTITY_CACHE_MAX) {
    const oldestId = primitiveParseIdentityCache.keys().next().value;
    if (oldestId !== undefined) primitiveParseIdentityCache.delete(oldestId);
  }
  primitiveParseIdentityCache.set(screenId, { content, result });
}

export function __clearPrimitiveParseCachesForTests() {
  primitiveParseCache.clear();
  primitiveParseIdentityCache.clear();
}

export function __getPrimitiveParseCacheSizesForTests() {
  return {
    parsed: primitiveParseCache.size,
    identity: primitiveParseIdentityCache.size,
  };
}

type InlineNumericProperty =
  | "width"
  | "height"
  | "left"
  | "top"
  | "paddingLeft"
  | "paddingTop"
  | "marginLeft"
  | "marginRight"
  | "marginTop"
  | "marginBottom"
  | "gap";

function inlineNumber(element: Element, property: InlineNumericProperty) {
  const value = (element as HTMLElement).style[property];
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function elementInlineSize(element: Element, axis: "x" | "y") {
  return inlineNumber(element, axis === "x" ? "width" : "height");
}

function cssPixelNumber(value: string | null | undefined) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)px$/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimatedTextLineWidth(
  text: string,
  fontSize: number,
  letterSpacing: number,
) {
  let width = 0;
  for (const character of Array.from(text)) {
    if (/\s/.test(character)) width += fontSize * 0.33;
    else if (/[MW@#%&]/.test(character)) width += fontSize * 0.82;
    else if (/[ilI1|.,'`:;]/.test(character)) width += fontSize * 0.3;
    else if (character.codePointAt(0)! > 0xff) width += fontSize;
    else width += fontSize * 0.56;
  }
  return Math.max(
    1,
    width + Math.max(0, Array.from(text).length - 1) * letterSpacing,
  );
}

/**
 * Deterministic, string/inline-style-only bounds for drawn auto-sized text.
 * This intentionally avoids layout APIs so the same fallback works in SSR,
 * tests, and before the live iframe answers. It is conservative enough for
 * hit testing while honoring the authored typography and wrap contract.
 */
export function authoredTextIntrinsicSize(element: Element) {
  const style = (element as HTMLElement).style;
  const fontSize = Math.max(1, cssPixelNumber(style.fontSize) || 16);
  const numericLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeight = Math.max(
    1,
    cssPixelNumber(style.lineHeight) ||
      (Number.isFinite(numericLineHeight) && numericLineHeight > 0
        ? numericLineHeight * fontSize
        : fontSize * 1.2),
  );
  const letterSpacing = cssPixelNumber(style.letterSpacing);
  const whiteSpace = style.whiteSpace || "normal";
  const preservesLines = /^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(
    whiteSpace,
  );
  const rawText = element.textContent || "";
  const lines = preservesLines
    ? rawText.split(/\r?\n/)
    : [rawText.replace(/\s+/g, " ").trim()];
  const lineWidths = lines.map((line) =>
    estimatedTextLineWidth(line, fontSize, letterSpacing),
  );
  const authoredWidth = cssPixelNumber(style.width);
  const maxWidth = cssPixelNumber(style.maxWidth);
  const wrapWidth = authoredWidth || maxWidth;
  const mayWrap =
    wrapWidth > 0 && whiteSpace !== "nowrap" && whiteSpace !== "pre";
  const visualLineCount = lineWidths.reduce(
    (count, width) =>
      count + (mayWrap ? Math.max(1, Math.ceil(width / wrapWidth)) : 1),
    0,
  );
  const naturalWidth = Math.max(1, ...lineWidths);
  return {
    width: Math.max(
      1,
      authoredWidth ||
        (maxWidth ? Math.min(naturalWidth, maxWidth) : naturalWidth),
    ),
    height: Math.max(
      1,
      cssPixelNumber(style.height) || Math.max(1, visualLineCount) * lineHeight,
    ),
  };
}

/**
 * Approximates an authored node's screen-local position from inline layout.
 * This parser is the no-iframe fallback used while a live bridge is absent;
 * absolute descendants must accumulate positioned ancestors, and common
 * single-line flex/block flows need their preceding siblings accounted for.
 *
 * Exported so DesignEditor.tsx's getAbsolutePositioningForNodeInHtml can
 * reuse the same ancestor-walking logic instead of reading a node's own
 * inline left/top in isolation (which is only correct for direct children of
 * the screen root — see that function's call sites for the nested-container
 * reparent fix this enables).
 */
export function authoredElementPosition(element: Element): Point {
  let x = 0;
  let y = 0;
  let cursor: Element | null = element;

  while (cursor && cursor.parentElement) {
    const htmlCursor = cursor as HTMLElement;
    const style = htmlCursor.style;
    const parent: Element = cursor.parentElement;
    if (style.position === "fixed") {
      x += inlineNumber(cursor, "left");
      y += inlineNumber(cursor, "top");
      break;
    }
    if (style.position === "absolute") {
      x += inlineNumber(cursor, "left");
      y += inlineNumber(cursor, "top");
    } else {
      const parentStyle = (parent as HTMLElement).style;
      x += inlineNumber(parent, "paddingLeft");
      y += inlineNumber(parent, "paddingTop");
      const siblings: Element[] = Array.from(parent.children);
      const index = siblings.indexOf(cursor);
      if (index > 0) {
        const previous = siblings.slice(0, index);
        const gap = inlineNumber(parent, "gap");
        const display = parentStyle.display;
        const isFlex = display === "flex" || display === "inline-flex";
        const isRow =
          isFlex && !(parentStyle.flexDirection || "row").startsWith("column");
        for (const sibling of previous as Element[]) {
          if (isRow) {
            x +=
              elementInlineSize(sibling, "x") +
              inlineNumber(sibling, "marginLeft") +
              inlineNumber(sibling, "marginRight") +
              gap;
          } else {
            y +=
              elementInlineSize(sibling, "y") +
              inlineNumber(sibling, "marginTop") +
              inlineNumber(sibling, "marginBottom") +
              (isFlex ? gap : 0);
          }
        }
      }
    }
    cursor = parent;
    if (cursor.tagName.toLowerCase() === "body") break;
  }

  return { x, y };
}

export function parsePrimitivesFromScreen(
  screen: ScreenFile,
): ParsedScreenPrimitive[] {
  const identityEntry = primitiveParseIdentityCache.get(screen.id);
  if (identityEntry && identityEntry.content === screen.content) {
    return identityEntry.result;
  }

  const cacheKey = `${screen.id}:${screen.content.length}:${hashString(screen.content)}`;
  const cached = primitiveParseCache.get(cacheKey);
  if (cached) {
    rememberPrimitiveIdentity(screen.id, screen.content, cached);
    return cached;
  }

  const result: ParsedScreenPrimitive[] = [];
  if (typeof DOMParser === "undefined" || !screen.content) {
    return result;
  }

  try {
    const doc = new DOMParser().parseFromString(screen.content, "text/html");
    const nodes = doc.querySelectorAll("[data-agent-native-node-id]");
    nodes.forEach((element) => {
      const nodeId = element.getAttribute("data-agent-native-node-id");
      if (!nodeId) return;

      const htmlElement = element as HTMLElement;
      const style = htmlElement.style;
      const tag = element.tagName.toLowerCase();
      const primitiveKind = (
        element.getAttribute("data-an-primitive") || ""
      ).toLowerCase();
      const position = authoredElementPosition(element);
      const intrinsicTextSize =
        primitiveKind === "text" ? authoredTextIntrinsicSize(element) : null;
      const width = parseFloat(style.width) || intrinsicTextSize?.width || 0;
      const height = parseFloat(style.height) || intrinsicTextSize?.height || 0;
      if (width <= 0 || height <= 0) return;

      const isContainer = isPrimitiveContainer({
        tagName: tag,
        primitiveKind,
        display: style.display,
        borderRadius: style.borderRadius,
      });
      const autoLayoutAxis = computeAutoLayoutAxis({
        display: style.display,
        flexDirection: style.flexDirection,
        flexWrap: style.flexWrap,
        gridTemplateColumns: style.gridTemplateColumns,
      });

      // Nearest ancestor primitive id, used to resolve direct children of a
      // container for auto-layout before/after anchor resolution — see
      // findAutoLayoutInsertionAnchor.
      let parentNodeId: string | undefined;
      let ancestor: Element | null = element.parentElement;
      while (ancestor && ancestor.tagName.toLowerCase() !== "body") {
        const ancestorId = ancestor.getAttribute("data-agent-native-node-id");
        if (ancestorId) {
          parentNodeId = ancestorId;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      result.push({
        nodeId,
        screenId: screen.id,
        parentNodeId,
        localLeft: position.x,
        localTop: position.y,
        localWidth: width,
        localHeight: height,
        isContainer,
        autoLayoutAxis,
      });
    });
  } catch {
    // Malformed imported HTML simply has no discoverable canvas primitives.
  }

  if (primitiveParseCache.size >= PRIMITIVE_PARSE_CACHE_MAX) {
    const firstKey = primitiveParseCache.keys().next().value;
    if (firstKey !== undefined) primitiveParseCache.delete(firstKey);
  }
  primitiveParseCache.set(cacheKey, result);
  rememberPrimitiveIdentity(screen.id, screen.content, result);
  return result;
}

export function primitiveLocalToBoardRect(
  localLeft: number,
  localTop: number,
  localWidth: number,
  localHeight: number,
  frameGeometry: FrameGeometry,
  metadata: { width: number; height: number },
): FrameGeometry {
  return screenLocalRectToBoardGeometry(
    {
      left: localLeft,
      top: localTop,
      width: localWidth,
      height: localHeight,
    },
    frameGeometry,
    metadata,
  );
}

export function getPrimitiveDropTargetForPoint(
  point: Point,
  draggedNodeId: string | null,
  screens: ScreenFile[],
  frameGeometryById: FrameGeometryById,
  getMetadata: (screen: ScreenFile) => { width: number; height: number },
  options: {
    identityCoordinateScreenIds?: ReadonlySet<string>;
    backgroundScreenIds?: ReadonlySet<string>;
    foregroundScreenId?: string;
  } = {},
): PrimitiveDropTarget | null {
  const toBoardRect = (
    primitive: ParsedScreenPrimitive,
    frameGeometry: FrameGeometry,
    metadata: { width: number; height: number },
  ): FrameGeometry => {
    if (options.identityCoordinateScreenIds?.has(primitive.screenId)) {
      return {
        x: primitive.localLeft,
        y: primitive.localTop,
        width: Math.max(1, primitive.localWidth),
        height: Math.max(1, primitive.localHeight),
      };
    }
    return primitiveLocalToBoardRect(
      primitive.localLeft,
      primitive.localTop,
      primitive.localWidth,
      primitive.localHeight,
      frameGeometry,
      metadata,
    );
  };

  let draggedBoardRect: FrameGeometry | null = null;
  let draggedScreenId: string | null = null;
  if (draggedNodeId) {
    outer: for (const screen of screens) {
      const frameGeometry = frameGeometryById[screen.id];
      if (!frameGeometry) continue;
      const metadata = getMetadata(screen);
      const primitives = parsePrimitivesFromScreen(screen);
      for (const primitive of primitives) {
        if (primitive.nodeId === draggedNodeId) {
          draggedBoardRect = toBoardRect(primitive, frameGeometry, metadata);
          draggedScreenId = screen.id;
          break outer;
        }
      }
    }
  }

  const topScreen = screens
    .map((screen, index) => ({
      screen,
      index,
      geometry: frameGeometryById[screen.id],
    }))
    .filter(
      (
        entry,
      ): entry is {
        screen: ScreenFile;
        index: number;
        geometry: FrameGeometry;
      } => !!entry.geometry && geometryContainsPoint(entry.geometry, point),
    )
    .sort((a, b) => {
      const foregroundDelta =
        Number(b.screen.id === options.foregroundScreenId) -
        Number(a.screen.id === options.foregroundScreenId);
      if (foregroundDelta) return foregroundDelta;
      const backgroundDelta =
        Number(options.backgroundScreenIds?.has(a.screen.id)) -
        Number(options.backgroundScreenIds?.has(b.screen.id));
      if (backgroundDelta) return backgroundDelta;
      return (b.geometry.z ?? 0) - (a.geometry.z ?? 0) || b.index - a.index;
    })[0];

  if (!topScreen) return null;

  const metadata = getMetadata(topScreen.screen);
  const primitives = parsePrimitivesFromScreen(topScreen.screen);
  let best: PrimitiveDropTarget | null = null;
  for (const primitive of primitives) {
    if (!primitive.isContainer) continue;
    if (draggedNodeId && primitive.nodeId === draggedNodeId) continue;
    const boardRect = toBoardRect(primitive, topScreen.geometry, metadata);
    if (
      draggedBoardRect &&
      draggedScreenId === topScreen.screen.id &&
      geometryContainsGeometry(draggedBoardRect, boardRect)
    ) {
      continue;
    }
    if (geometryContainsPoint(boardRect, point)) {
      best = {
        nodeId: primitive.nodeId,
        screenId: topScreen.screen.id,
        boardRect,
      };
    }
  }

  // Auto-layout drop participation: when the winning container is itself a
  // flex/grid container, resolve the nearest before/after sibling slot
  // instead of always appending "inside" — matches the cross-screen
  // hit-test's nearestChildInsertionTarget so overview-canvas primitive
  // drags into an existing auto-layout screen get the same Figma insertion
  // index/indicator behavior.
  if (best) {
    const containerPrimitive = primitives.find(
      (primitive) => primitive.nodeId === best!.nodeId,
    );
    if (containerPrimitive?.autoLayoutAxis) {
      const localPoint = options.identityCoordinateScreenIds?.has(
        topScreen.screen.id,
      )
        ? point
        : boardPointToScreenLocalPoint(point, topScreen.geometry, metadata);
      const anchor = findAutoLayoutInsertionAnchor(
        containerPrimitive,
        primitives,
        localPoint,
        draggedNodeId,
      );
      if (anchor) {
        const anchorPrimitive = primitives.find(
          (primitive) => primitive.nodeId === anchor.anchorNodeId,
        );
        if (anchorPrimitive) {
          best = {
            nodeId: containerPrimitive.nodeId,
            screenId: topScreen.screen.id,
            boardRect: toBoardRect(
              anchorPrimitive,
              topScreen.geometry,
              metadata,
            ),
            anchorNodeId: anchor.anchorNodeId,
            placement: anchor.placement,
            axis: containerPrimitive.autoLayoutAxis,
          };
        }
      }
    }
  }

  return best;
}

export function resolveNodeScreenId(
  nodeId: string,
  screens: ScreenFile[],
): string | null {
  for (const screen of screens) {
    const primitives = parsePrimitivesFromScreen(screen);
    if (primitives.some((primitive) => primitive.nodeId === nodeId)) {
      return screen.id;
    }
  }
  return null;
}
