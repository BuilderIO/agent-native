import { hashString } from "./board-surface-html";
import { screenLocalRectToBoardGeometry } from "./coordinate-transforms";
import {
  geometryContainsGeometry,
  geometryContainsPoint,
} from "./frame-geometry";
import type {
  FrameGeometry,
  FrameGeometryById,
  Point,
  ScreenFile,
} from "./types";

export interface PrimitiveDropTarget {
  nodeId: string;
  screenId: string;
  boardRect: FrameGeometry;
}

export interface ParsedScreenPrimitive {
  nodeId: string;
  screenId: string;
  localLeft: number;
  localTop: number;
  localWidth: number;
  localHeight: number;
  isContainer: boolean;
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
      if (style.position !== "absolute") return;

      const left = parseFloat(style.left) || 0;
      const top = parseFloat(style.top) || 0;
      const width = parseFloat(style.width) || 0;
      const height = parseFloat(style.height) || 0;
      if (width <= 0 || height <= 0) return;

      const isDiv = tag === "div";
      const isEllipse =
        style.borderRadius === "50%" ||
        style.borderRadius === "50% 50% 50% 50%";
      const isTextAutoSize = style.display === "inline-block";
      const isAutoLayout =
        style.display === "flex" ||
        style.display === "inline-flex" ||
        style.display === "grid" ||
        style.display === "inline-grid";
      const isCanvasRectangle =
        isDiv && (primitiveKind === "rectangle" || primitiveKind === "rect");
      const isContainer =
        isDiv &&
        !isEllipse &&
        !isTextAutoSize &&
        (isAutoLayout || isCanvasRectangle);

      result.push({
        nodeId,
        screenId: screen.id,
        localLeft: left,
        localTop: top,
        localWidth: width,
        localHeight: height,
        isContainer,
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
