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
