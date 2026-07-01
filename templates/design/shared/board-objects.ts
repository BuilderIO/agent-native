/**
 * Board object types shared between the frontend, actions, and agent skills.
 *
 * Board objects are persisted canvas primitives stored inside designs.data under
 * the "boardObjects" key. Unlike code-layer nodes (which live inside screen HTML
 * files), board objects float on the infinite canvas surface and are not bound
 * to any screen iframe.
 *
 * The kind set mirrors DraftPrimitiveKind in MultiScreenCanvas.tsx exactly so
 * the same shape-rendering logic (DraftPrimitiveContent / canvasPrimitiveReactStyle)
 * can be reused for the visual output in BoardObjectLayer.
 */

export type CanvasPrimitiveKindLike =
  | "frame"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "star"
  | "line"
  | "arrow"
  | "text"
  | "path";

export interface BoardObjectEntry {
  id: string;
  kind: CanvasPrimitiveKindLike;
  /**
   * Bounding-box geometry in canvas units (same coordinate space as
   * FrameGeometry — offset from the canvas origin before SURFACE_PADDING is
   * applied).  z is the stacking order; rotation is in degrees (clockwise).
   */
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    z?: number;
  };
  /** CSS fill colour (background). Defaults to soft neutral gray when absent. */
  fill?: string;
  /** CSS stroke colour (border). Defaults to darker neutral gray when absent. */
  stroke?: string;
  /** Stroke width in pixels. */
  strokeWidth?: number;
  /** Text content — only meaningful when kind === "text". */
  text?: string;
  /**
   * SVG path data string — only meaningful when kind is "path", "line", or "arrow".
   * Falls back to a pointsToPath conversion when absent and `points` is set.
   */
  pathData?: string;
  /**
   * Raw point list for polyline/polygon kinds without explicit pathData.
   * Each entry is a canvas-space {x, y} point.
   */
  points?: Array<{ x: number; y: number }>;
  /**
   * When true the text box grows horizontally to fit its content
   * (single-line auto-size mode).
   */
  autoSize?: boolean;
  /** Human-readable label shown in the layers panel. */
  name?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Valid kind set for runtime validation
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set<string>([
  "frame",
  "rectangle",
  "ellipse",
  "polygon",
  "star",
  "line",
  "arrow",
  "text",
  "path",
]);

// ---------------------------------------------------------------------------
// parseBoardObjects
// ---------------------------------------------------------------------------

/**
 * Parse the boardObjects map from an unknown value (e.g. from designs.data JSON).
 *
 * Accepts:
 *   - A Record<string, BoardObjectEntry> already deserialized from JSON.
 *   - A JSON string that encodes such a record.
 *   - null / undefined / any other value → returns an empty record.
 *
 * Individual entries that are missing the required `id`, `kind`, or `geometry`
 * fields are silently dropped so a partially-corrupt payload never prevents
 * the canvas from rendering.
 */
export function parseBoardObjects(
  value: unknown,
): Record<string, BoardObjectEntry> {
  let raw: unknown = value;

  // Attempt to parse JSON strings.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, BoardObjectEntry> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidEntry(entry)) continue;
    result[key] = entry as BoardObjectEntry;
  }
  return result;
}

// ---------------------------------------------------------------------------
// draftToBoardObjectEntry
// ---------------------------------------------------------------------------

/**
 * Minimal structural type matching DraftPrimitive in MultiScreenCanvas.tsx.
 * Defined here so shared/board-objects.ts stays free of React/frontend imports.
 */
export interface DraftPrimitiveLike {
  id: string;
  kind: CanvasPrimitiveKindLike;
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    z?: number;
  };
  points?: Array<{ x: number; y: number }>;
  pathData?: string;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  autoSize?: boolean;
}

/**
 * Convert a DraftPrimitive (in-progress canvas shape) to a BoardObjectEntry
 * ready for persistence.
 *
 * Called by MultiScreenCanvas when a drawn primitive is outside all frames
 * (single-screen designs always absorb into the frame instead).
 */
export function draftToBoardObjectEntry(
  draft: DraftPrimitiveLike,
): BoardObjectEntry {
  const entry: BoardObjectEntry = {
    id: draft.id,
    kind: draft.kind,
    geometry: { ...draft.geometry },
    createdAt: new Date().toISOString(),
  };
  if (draft.fill !== undefined) entry.fill = draft.fill;
  if (draft.stroke !== undefined) entry.stroke = draft.stroke;
  if (draft.strokeWidth !== undefined) entry.strokeWidth = draft.strokeWidth;
  if (draft.text !== undefined) entry.text = draft.text;
  if (draft.pathData !== undefined) entry.pathData = draft.pathData;
  if (draft.points !== undefined) entry.points = draft.points;
  if (draft.autoSize !== undefined) entry.autoSize = draft.autoSize;
  return entry;
}

// ---------------------------------------------------------------------------
// Board-object resize helpers
// ---------------------------------------------------------------------------

/** Geometry shape for resize calculations (same as BoardObjectEntry.geometry). */
export interface BoardObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
}

/**
 * Apply a resize delta to a board object's geometry given the resize handle
 * (one of "nw", "ne", "se", "sw") and the mouse delta (dx, dy) in canvas units.
 *
 * - "nw": move top-left corner → adjusts x, y, width, height.
 * - "ne": move top-right corner → adjusts y, width, height.
 * - "se": move bottom-right corner → adjusts width, height.
 * - "sw": move bottom-left corner → adjusts x, width, height.
 *
 * Width and height are clamped to a minimum of 4 pixels.
 */
export function applyBoardObjectResize(
  origin: BoardObjectGeometry,
  handle: string,
  dx: number,
  dy: number,
): BoardObjectGeometry {
  const MIN_SIZE = 4;
  let { x, y, width, height } = origin;

  switch (handle) {
    case "nw":
      x = origin.x + dx;
      y = origin.y + dy;
      width = Math.max(MIN_SIZE, origin.width - dx);
      height = Math.max(MIN_SIZE, origin.height - dy);
      // Keep anchor at bottom-right
      if (origin.width - dx < MIN_SIZE) x = origin.x + origin.width - MIN_SIZE;
      if (origin.height - dy < MIN_SIZE)
        y = origin.y + origin.height - MIN_SIZE;
      break;
    case "ne":
      y = origin.y + dy;
      width = Math.max(MIN_SIZE, origin.width + dx);
      height = Math.max(MIN_SIZE, origin.height - dy);
      if (origin.height - dy < MIN_SIZE)
        y = origin.y + origin.height - MIN_SIZE;
      break;
    case "se":
      width = Math.max(MIN_SIZE, origin.width + dx);
      height = Math.max(MIN_SIZE, origin.height + dy);
      break;
    case "sw":
      x = origin.x + dx;
      width = Math.max(MIN_SIZE, origin.width - dx);
      height = Math.max(MIN_SIZE, origin.height + dy);
      if (origin.width - dx < MIN_SIZE) x = origin.x + origin.width - MIN_SIZE;
      break;
    default:
      break;
  }

  return { ...origin, x, y, width, height };
}

/**
 * Map a resize handle string to the CSS cursor value shown while dragging.
 */
export function getBoardObjectResizeCursor(handle: string): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "se-resize";
  }
}

function isValidEntry(entry: unknown): entry is BoardObjectEntry {
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const e = entry as Record<string, unknown>;
  if (typeof e["id"] !== "string" || !e["id"]) return false;
  if (typeof e["kind"] !== "string" || !VALID_KINDS.has(e["kind"])) {
    return false;
  }
  if (typeof e["createdAt"] !== "string") return false;
  const geo = e["geometry"];
  if (geo == null || typeof geo !== "object" || Array.isArray(geo)) {
    return false;
  }
  const g = geo as Record<string, unknown>;
  return (
    typeof g["x"] === "number" &&
    typeof g["y"] === "number" &&
    typeof g["width"] === "number" &&
    typeof g["height"] === "number"
  );
}
