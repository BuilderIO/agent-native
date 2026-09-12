import { getRotatedFrameCorners } from "./canvas-math.js";
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

/** Design-data maps whose per-entry dimension keys must be persisted as JSON
 *  numbers. Every reader treats a non-number as absent, so accepting `"800"`
 *  would silently drop the write instead of resizing anything. */
const NUMERIC_DESIGN_DATA_ENTRY_KEYS: Record<string, ReadonlySet<string>> = {
  canvasFrames: new Set(CANVAS_FRAME_GEOMETRY_KEYS),
  screenMetadata: new Set(["width", "height"]),
  localhostScreens: new Set(["width", "height"]),
};

function describeRejectedValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  if (typeof value === "number") return `the non-finite number ${value}`;
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
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
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

/**
 * Message describing why a path-addressed design-data write carries a
 * non-numeric dimension, or null when the write is acceptable.
 *
 * Callers must reject on a message rather than coercing: the readers below
 * drop non-numbers, so a coerced write and an ignored one are indistinguishable
 * to whoever asked for the resize.
 */
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
      return null;
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

/** Y a new group must start at to clear existing frames, or 0 when the board is
 *  empty. Placing at y=0 unconditionally stacks each new group on the last. */
export function nextFreeCanvasRowY(
  existing: unknown,
  gap: number,
  options: {
    ignoreFileIds?: readonly string[];
    responsiveLayout?: {
      screenMetadataByFileId?: unknown;
      breakpointWidths?: readonly number[];
    };
  } = {},
): number {
  const ignored = new Set(options.ignoreFileIds ?? []);
  const frames = Object.entries(parseCanvasFrameGeometryById(existing)).filter(
    ([id]) => !ignored.has(id),
  );
  const responsiveLayout = options.responsiveLayout;
  const metadataByFileId = responsiveLayout?.screenMetadataByFileId;
  const metadataMap =
    metadataByFileId &&
    typeof metadataByFileId === "object" &&
    !Array.isArray(metadataByFileId)
      ? (metadataByFileId as Record<string, unknown>)
      : {};
  let bottom = 0;
  let sawFrame = false;
  for (const [id, frame] of frames) {
    const y = frame.y ?? 0;
    const height = frame.height ?? 0;
    if (!Number.isFinite(y) || !Number.isFinite(height)) continue;
    sawFrame = true;
    const x = frame.x ?? 0;
    const width = frame.width ?? 0;
    const rotation = frame.rotation ?? 0;
    const rawMetadata = metadataMap[id];
    const metadata =
      rawMetadata &&
      typeof rawMetadata === "object" &&
      !Array.isArray(rawMetadata)
        ? (rawMetadata as Record<string, unknown>)
        : {};
    const metadataWidth = finiteNumber(metadata.width);
    const metadataHeight = finiteNumber(metadata.height);
    const primaryWidth = Math.max(1, width || 320);
    const sourceWidth = Math.max(1, metadataWidth ?? 1280);
    const sourceHeight = Math.max(1, metadataHeight ?? 2560);
    const primaryHeight = Math.max(
      1,
      height ||
        Math.max(80, Math.round((primaryWidth * sourceHeight) / sourceWidth)),
    );
    const visibleWidths = visibleBreakpointWidths(
      responsiveLayout?.breakpointWidths,
      metadataWidth ?? width,
    );
    const resolveBreakpointHeightPx = (widthPx: number) =>
      getResponsiveBreakpointHeightPx(metadata, widthPx);
    const scale = getScreenPreviewViewport(
      { width: sourceWidth, height: sourceHeight },
      { width: primaryWidth, height: primaryHeight },
    ).scale;
    const paintedWidth = responsiveLayout
      ? getResponsiveGroupWidth({
          primaryWidth,
          scale,
          visibleWidths,
        })
      : width;
    const paintedHeight = responsiveLayout
      ? getResponsiveGroupHeight({
          primaryHeight,
          scale,
          sourceWidth,
          sourceHeight,
          visibleWidths,
          resolveBreakpointHeightPx,
        })
      : height;
    // A rotated frame's visual box extends below y + height; place under its
    // rotated corners so the new row cannot overlap it. Responsive previews
    // rotate with the primary around its center, so use their full group
    // footprint around that same pivot.
    let frameBottom: number;
    if (!rotation) {
      frameBottom = y + paintedHeight;
    } else if (responsiveLayout) {
      const bounds = getResponsiveGroupRotatedBounds({
        x,
        y,
        primaryWidth,
        primaryHeight,
        groupWidth: paintedWidth,
        groupHeight: paintedHeight,
        rotation,
      });
      frameBottom = bounds.y + bounds.height;
    } else if (Number.isFinite(x) && Number.isFinite(width)) {
      frameBottom = Math.max(
        ...getRotatedFrameCorners({ x, y, width, height, rotation }).map(
          (corner) => corner.y,
        ),
      );
    } else {
      frameBottom = y + paintedHeight;
    }
    bottom = Math.max(bottom, frameBottom);
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
