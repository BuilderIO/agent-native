import type { VectorEndpointStyle } from "./vector-endpoints.js";

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
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    z?: number;
  };
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
  text?: string;
  pathData?: string;
  points?: Array<{ x: number; y: number }>;
  autoSize?: boolean;
  name?: string;
  createdAt: string;
}

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

export function parseBoardObjects(
  value: unknown,
): Record<string, BoardObjectEntry> {
  let raw: unknown = value;

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
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
  autoSize?: boolean;
}

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
  if (draft.startPoint !== undefined) entry.startPoint = draft.startPoint;
  if (draft.endPoint !== undefined) entry.endPoint = draft.endPoint;
  if (draft.text !== undefined) entry.text = draft.text;
  if (draft.pathData !== undefined) entry.pathData = draft.pathData;
  if (draft.points !== undefined) entry.points = draft.points;
  if (draft.autoSize !== undefined) entry.autoSize = draft.autoSize;
  return entry;
}

export interface BoardObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
}

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
