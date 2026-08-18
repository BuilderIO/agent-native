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
  for (const [key, value] of Object.entries(entry)) {
    if (!numericKeys.has(key)) continue;
    const error = numericValueError(map, key, value);
    if (error) return error;
  }
  return null;
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
  options: { ignoreFileIds?: readonly string[] } = {},
): number {
  const ignored = new Set(options.ignoreFileIds ?? []);
  const frames = Object.entries(parseCanvasFrameGeometryById(existing)).filter(
    ([id]) => !ignored.has(id),
  );
  let bottom = 0;
  let sawFrame = false;
  for (const [, frame] of frames) {
    const y = frame.y ?? 0;
    const height = frame.height ?? 0;
    if (!Number.isFinite(y) || !Number.isFinite(height)) continue;
    sawFrame = true;
    bottom = Math.max(bottom, y + height);
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
