import { getRotatedFrameAABB } from "./canvas-math.js";
import {
  getResponsiveBreakpointHeightPx,
  getResponsiveGroupHeight,
  getResponsiveGroupRotatedBounds,
  getResponsiveGroupWidth,
  getScreenPreviewViewport,
  MAX_SANE_FRAME_DIMENSION_PX,
  visibleBreakpointWidths,
} from "./responsive-frame-layout.js";

export interface CanvasFrameGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  z?: number;
}

export type CanvasFrameGeometryById = Record<string, CanvasFrameGeometry>;

export const OVERVIEW_FRAME_WIDTH = 320;
export const OVERVIEW_FRAME_GAP = 56;
export const OVERVIEW_FRAME_LABEL_HEIGHT = 28;

export function getOverviewFrameHeight(
  width: number,
  metadata?: { width?: number; height?: number },
) {
  const sourceWidth =
    metadata?.width && metadata.width > 0 ? metadata.width : 1280;
  const sourceHeight =
    metadata?.height && metadata.height > 0 ? metadata.height : 2560;
  return Math.max(80, Math.round((width * sourceHeight) / sourceWidth));
}

export function getInitialCanvasFrameGeometry(
  index: number,
  metadata?: { width?: number; height?: number },
): Required<Pick<CanvasFrameGeometry, "x" | "y" | "width" | "height">> {
  const column = index % 3;
  const row = Math.floor(index / 3);
  const height = getOverviewFrameHeight(OVERVIEW_FRAME_WIDTH, metadata);
  return {
    x: column * (OVERVIEW_FRAME_WIDTH + OVERVIEW_FRAME_GAP),
    y: row * (height + OVERVIEW_FRAME_LABEL_HEIGHT + OVERVIEW_FRAME_GAP),
    width: OVERVIEW_FRAME_WIDTH,
    height,
  };
}

export interface CanvasResponsiveLayout {
  screenFileIds?: readonly string[];
  screenMetadataByFileId?: unknown;
  breakpointWidths?: readonly number[];
}

export interface CanvasFramePlacement extends CanvasFrameGeometry {
  fileId?: string;
  filename?: string;
}

const CANVAS_FRAME_GEOMETRY_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "z",
] as const;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseCanvasFrameGeometry(
  value: unknown,
): CanvasFrameGeometry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const frame: CanvasFrameGeometry = {};
  for (const key of CANVAS_FRAME_GEOMETRY_KEYS) {
    const next = finiteNumber(raw[key]);
    if (next !== undefined) frame[key] = next;
  }
  return frame;
}

export function parseCanvasFrameGeometryById(
  value: unknown,
): CanvasFrameGeometryById {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([id, rawFrame]) => {
        const frame = parseCanvasFrameGeometry(rawFrame);
        return frame ? ([id, frame] as const) : null;
      })
      .filter((entry): entry is readonly [string, CanvasFrameGeometry] =>
        Boolean(entry),
      ),
  );
}

interface CanvasFrameBounds {
  top: number;
  right: number;
  bottom: number;
}

function canvasFrameBounds(
  id: string,
  frame: CanvasFrameGeometry,
  responsiveLayout?: CanvasResponsiveLayout,
  responsiveScreenIds = new Set(responsiveLayout?.screenFileIds ?? []),
): CanvasFrameBounds {
  const x = frame.x ?? 0;
  const y = frame.y ?? 0;
  const rotation = frame.rotation ?? 0;
  const metadataByFileId = responsiveLayout?.screenMetadataByFileId;
  const metadataMap =
    metadataByFileId &&
    typeof metadataByFileId === "object" &&
    !Array.isArray(metadataByFileId)
      ? (metadataByFileId as Record<string, unknown>)
      : {};
  const rawMetadata = metadataMap[id];
  const metadata =
    rawMetadata &&
    typeof rawMetadata === "object" &&
    !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : {};
  const metadataWidth = finiteNumber(metadata.width);
  const metadataHeight = finiteNumber(metadata.height);
  const isOverviewScreen =
    responsiveScreenIds.has(id) ||
    metadataWidth !== undefined ||
    metadataHeight !== undefined;
  const width = frame.width ?? (isOverviewScreen ? (metadataWidth ?? 1280) : 0);
  const height =
    frame.height ?? (isOverviewScreen ? (metadataHeight ?? 2560) : 0);
  const responsiveScreen = responsiveScreenIds.has(id);
  const primaryWidth = Math.max(1, width || (isOverviewScreen ? 1280 : 320));
  const sourceWidth = Math.max(1, metadataWidth ?? 1280);
  const sourceHeight = Math.max(1, metadataHeight ?? 2560);
  const primaryHeight = Math.max(1, height);
  const visibleWidths = responsiveScreen
    ? visibleBreakpointWidths(
        responsiveLayout?.breakpointWidths,
        metadataWidth ?? width,
      )
    : [];
  const scale = getScreenPreviewViewport(
    { width: sourceWidth, height: sourceHeight },
    { width: primaryWidth, height: primaryHeight },
  ).scale;
  const paintedWidth = responsiveScreen
    ? getResponsiveGroupWidth({ primaryWidth, scale, visibleWidths })
    : width;
  const paintedHeight = responsiveScreen
    ? getResponsiveGroupHeight({
        primaryHeight,
        scale,
        sourceWidth,
        sourceHeight,
        visibleWidths,
        resolveBreakpointHeightPx: (widthPx) =>
          getResponsiveBreakpointHeightPx(metadata, widthPx),
      })
    : height;

  if (!rotation) {
    return {
      top: y,
      right: x + paintedWidth,
      bottom: y + paintedHeight,
    };
  }
  if (responsiveScreen) {
    const bounds = getResponsiveGroupRotatedBounds({
      x,
      y,
      primaryWidth,
      primaryHeight,
      groupWidth: paintedWidth,
      groupHeight: paintedHeight,
      rotation,
    });
    return {
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
    };
  }
  const bounds = getRotatedFrameAABB({ x, y, width, height, rotation });
  return {
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

export function nextCanvasFramePosition(
  framesById: CanvasFrameGeometryById,
  gap = 160,
  options: { responsiveLayout?: CanvasResponsiveLayout } = {},
): { x: number; y: number } {
  const responsiveLayout = options.responsiveLayout;
  const metadataByFileId = responsiveLayout?.screenMetadataByFileId;
  const screenMetadata =
    metadataByFileId &&
    typeof metadataByFileId === "object" &&
    !Array.isArray(metadataByFileId)
      ? (metadataByFileId as Record<string, unknown>)
      : {};
  const frames = new Map(Object.entries(framesById));
  for (const [index, id] of (responsiveLayout?.screenFileIds ?? []).entries()) {
    const metadata = screenMetadata[id];
    frames.set(id, {
      ...getInitialCanvasFrameGeometry(
        index,
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as { width?: number; height?: number })
          : undefined,
      ),
      ...frames.get(id),
    });
  }
  if (frames.size === 0) return { x: 0, y: 0 };
  const responsiveScreenIds = new Set(
    options.responsiveLayout?.screenFileIds ?? [],
  );
  const bounds = Array.from(frames).map(([id, frame]) =>
    canvasFrameBounds(id, frame, options.responsiveLayout, responsiveScreenIds),
  );
  const maxRight = Math.max(...bounds.map((frame) => frame.right));
  const minTop = Math.min(...bounds.map((frame) => frame.top));
  return { x: maxRight + gap, y: minTop };
}

const NUMERIC_DESIGN_DATA_ENTRY_KEYS: Record<string, ReadonlySet<string>> = {
  canvasFrames: new Set(CANVAS_FRAME_GEOMETRY_KEYS),
  screenMetadata: new Set(["width", "height"]),
  localhostScreens: new Set(["width", "height"]),
};

function describeRejectedValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? `the number ${value}`
      : `the non-finite number ${value}`;
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

function numericValueError(
  map: string,
  key: string,
  value: unknown,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return null;
  return (
    `Design ${map} "${key}" must be a finite JSON number, received ${describeRejectedValue(value)}. ` +
    `Write dimensions and positions as numbers (800), not strings ("800" or "800px"); ` +
    `use a delete operation to clear one.`
  );
}

function numericEntryError(
  map: string,
  entry: unknown,
  numericKeys: ReadonlySet<string>,
): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return `Design ${map} entry must be an object with numeric width and height fields, received ${describeRejectedValue(entry)}. Use a delete operation to clear an entry.`;
  }
  if (
    map === "canvasFrames" &&
    !Object.keys(entry).some((key) => numericKeys.has(key))
  ) {
    return "Design canvasFrames entry must include at least one geometry field. Use a delete operation to clear an entry.";
  }
  if (map === "screenMetadata") {
    const heights = (entry as Record<string, unknown>).breakpointHeights;
    if (heights !== undefined) {
      if (!heights || typeof heights !== "object" || Array.isArray(heights)) {
        return "screenMetadata.breakpointHeights must be an object keyed by breakpoint width.";
      }
      for (const [width, height] of Object.entries(
        heights as Record<string, unknown>,
      )) {
        const error = breakpointHeightError(width, height);
        if (error) return error;
      }
    }
  }
  for (const [key, value] of Object.entries(entry)) {
    if (!numericKeys.has(key)) continue;
    const error = numericValueError(map, key, value);
    if (error) return error;
  }
  return null;
}

function breakpointHeightError(width: string, value: unknown): string | null {
  const widthPx = Number(width);
  if (
    !Number.isSafeInteger(widthPx) ||
    widthPx <= 0 ||
    String(widthPx) !== width
  ) {
    return `Responsive breakpoint width "${width}" must be a positive integer.`;
  }
  const error = numericValueError(
    "screenMetadata.breakpointHeights",
    width,
    value,
  );
  if (error) return error;
  const height = value as number;
  if (height <= 0) {
    return `Responsive breakpoint height at width ${width} must be positive.`;
  }
  return height <= MAX_SANE_FRAME_DIMENSION_PX
    ? null
    : `Responsive breakpoint height at width ${width} must be at most ${MAX_SANE_FRAME_DIMENSION_PX} px.`;
}

export function numericDesignDataWriteError(
  path: readonly string[],
  value: unknown,
): string | null {
  const map = path[0];
  const numericKeys = map ? NUMERIC_DESIGN_DATA_ENTRY_KEYS[map] : undefined;
  if (!map || !numericKeys) return null;

  if (map === "screenMetadata" && path[2] === "breakpointHeights") {
    if (path.length === 3) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "screenMetadata.breakpointHeights must be an object keyed by breakpoint width.";
      }
      for (const [width, height] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const error = breakpointHeightError(width, height);
        if (error) return error;
      }
      return null;
    }
    if (path.length === 4) {
      return breakpointHeightError(path[3]!, value);
    }
    return "screenMetadata.breakpointHeights entries have no nested values.";
  }

  if (path.length === 1) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `Design ${map} must be an object keyed by file ID, received ${describeRejectedValue(value)}. Use a delete operation to clear the map.`;
    }
    for (const entry of Object.values(value)) {
      const error = numericEntryError(map, entry, numericKeys);
      if (error) return error;
    }
    return null;
  }

  if (path.length === 2) return numericEntryError(map, value, numericKeys);

  const key = path[2]!;
  if (!numericKeys.has(key)) return null;
  if (path.length > 3) {
    return `Design ${map} "${key}" is a single number and has no nested values.`;
  }
  return numericValueError(map, key, value);
}

export function nextFreeCanvasRowY(
  existing: unknown,
  gap: number,
  options: {
    ignoreFileIds?: readonly string[];
    responsiveLayout?: CanvasResponsiveLayout;
  } = {},
): number {
  const ignored = new Set(options.ignoreFileIds ?? []);
  const frames = Object.entries(parseCanvasFrameGeometryById(existing)).filter(
    ([id]) => !ignored.has(id),
  );
  const responsiveScreenIds = new Set(
    options.responsiveLayout?.screenFileIds ?? [],
  );
  let bottom = 0;
  let sawFrame = false;
  for (const [id, frame] of frames) {
    const y = frame.y ?? 0;
    const height = frame.height ?? 0;
    if (!Number.isFinite(y) || !Number.isFinite(height)) continue;
    sawFrame = true;
    bottom = Math.max(
      bottom,
      canvasFrameBounds(
        id,
        frame,
        options.responsiveLayout,
        responsiveScreenIds,
      ).bottom,
    );
  }
  return sawFrame ? bottom + gap : 0;
}

export function mergeCanvasFramePlacements({
  existing,
  placements,
  resolveFileId,
}: {
  existing: unknown;
  placements: CanvasFramePlacement[];
  resolveFileId: (placement: CanvasFramePlacement) => string | undefined;
}): {
  canvasFrames: CanvasFrameGeometryById;
  placedFrames: Array<{
    fileId: string;
    filename?: string;
    frame: CanvasFrameGeometry;
  }>;
} {
  const canvasFrames = parseCanvasFrameGeometryById(existing);
  const placedFrames: Array<{
    fileId: string;
    filename?: string;
    frame: CanvasFrameGeometry;
  }> = [];

  for (const placement of placements) {
    if (!placement.fileId && !placement.filename) {
      throw new Error("canvasFrames entries require fileId or filename");
    }
    const fileId = resolveFileId(placement);
    if (!fileId) {
      throw new Error(
        `canvasFrames entry did not match a design file: ${placement.filename ?? placement.fileId}`,
      );
    }
    const frame = parseCanvasFrameGeometry(placement) ?? {};
    canvasFrames[fileId] = {
      ...canvasFrames[fileId],
      ...frame,
    };
    placedFrames.push({ fileId, filename: placement.filename, frame });
  }

  return { canvasFrames, placedFrames };
}
