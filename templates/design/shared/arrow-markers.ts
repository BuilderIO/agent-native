/**
 * Endpoint marker primitives shared by the Design canvas, board serializer,
 * and inspector. Keep the values data-only so the same marker vocabulary can
 * be used by both React SVG and string-backed HTML sources.
 */

export const ARROW_MARKER_TYPES = [
  "none",
  "round",
  "square",
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle",
  "circle-arrow",
  "diamond-arrow",
] as const;

export type ArrowMarkerType = (typeof ARROW_MARKER_TYPES)[number];

export const DEFAULT_LINE_MARKER: ArrowMarkerType = "none";
export const DEFAULT_ARROW_START_MARKER: ArrowMarkerType = "none";
export const DEFAULT_ARROW_END_MARKER: ArrowMarkerType = "line-arrow";

export interface ArrowMarkerShape {
  path?: string;
  circle?: { cx: number; cy: number; r: number };
  rect?: { x: number; y: number; width: number; height: number };
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export function isArrowMarkerType(value: unknown): value is ArrowMarkerType {
  return (
    typeof value === "string" &&
    (ARROW_MARKER_TYPES as readonly string[]).includes(value)
  );
}

export function markerTypeOrDefault(
  value: unknown,
  fallback: ArrowMarkerType,
): ArrowMarkerType {
  return isArrowMarkerType(value) ? value : fallback;
}

/**
 * Inspector styles can come from either the bridge's normalized marker type
 * or the optimistic inline `url(#...)` value written by a style commit.
 * Normalize both forms before feeding a controlled endpoint Select.
 */
export function markerTypeFromStyleValue(
  nodeId: string,
  value: unknown,
  fallback: ArrowMarkerType,
): ArrowMarkerType {
  if (isArrowMarkerType(value)) return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  for (const type of ARROW_MARKER_TYPES) {
    if (type === "none") continue;
    if (normalized === arrowMarkerUrl(nodeId, type)) return type;
  }
  const markerId = normalized.match(/^url\(["']?#([^"')]+)["']?\)$/)?.[1];
  if (!markerId) return fallback;
  for (const type of ARROW_MARKER_TYPES) {
    if (type !== "none" && markerId === arrowMarkerId(nodeId, type)) {
      return type;
    }
  }
  return fallback;
}

/**
 * The historical `nodeId-arrow` id is retained for the default arrow marker
 * so existing imports and source-level consumers remain compatible. Other
 * endpoint choices get their own stable id and are therefore safe to swap in
 * without rewriting the shaft geometry.
 */
export function arrowMarkerId(
  nodeId: string,
  type: Exclude<ArrowMarkerType, "none">,
): string {
  return type === "line-arrow" ? `${nodeId}-arrow` : `${nodeId}-marker-${type}`;
}

export function arrowMarkerUrl(
  nodeId: string,
  type: ArrowMarkerType,
): string | undefined {
  return type === "none" ? undefined : `url(#${arrowMarkerId(nodeId, type)})`;
}

export function arrowMarkerShape(
  type: Exclude<ArrowMarkerType, "none">,
  stroke: string,
): ArrowMarkerShape {
  switch (type) {
    case "round":
      return { circle: { cx: 5, cy: 5, r: 4 }, fill: stroke };
    case "square":
      return { rect: { x: 1, y: 1, width: 8, height: 8 }, fill: stroke };
    case "line-arrow":
      return {
        path: "M 0 0 L 10 5 L 0 10",
        fill: "none",
        stroke,
        strokeWidth: 1.5,
      };
    case "reversed-triangle":
      return { path: "M 10 0 L 0 5 L 10 10 z", fill: stroke };
    case "circle-arrow":
      return {
        path: "M 0 0 L 10 5 L 0 10",
        fill: "none",
        stroke,
        strokeWidth: 1.5,
      };
    case "diamond-arrow":
      return { path: "M 0 5 L 5 0 L 10 5 L 5 10 z", fill: stroke };
    case "triangle-arrow":
      return { path: "M 0 0 L 10 5 L 0 10 z", fill: stroke };
  }
}

export function arrowMarkerTypesForPrimitive(
  kind: string,
  start?: unknown,
  end?: unknown,
): { start: ArrowMarkerType; end: ArrowMarkerType } {
  return {
    start: markerTypeOrDefault(start, DEFAULT_ARROW_START_MARKER),
    end: markerTypeOrDefault(
      end,
      kind === "arrow" ? DEFAULT_ARROW_END_MARKER : DEFAULT_LINE_MARKER,
    ),
  };
}

export function arrowMarkerDefinitionsHtml(
  nodeId: string,
  stroke: string,
): string {
  const definitions = ARROW_MARKER_TYPES.filter(
    (type): type is Exclude<ArrowMarkerType, "none"> => type !== "none",
  )
    .map((type) => arrowMarkerDefinitionHtml(nodeId, type, stroke))
    .join("");
  return `<defs>${definitions}</defs>`;
}

export function arrowMarkerDefinitionHtml(
  nodeId: string,
  type: Exclude<ArrowMarkerType, "none">,
  stroke: string,
): string {
  const shape = arrowMarkerShape(type, stroke);
  const shapeHtml = shape.path
    ? `<path d="${escapeAttr(shape.path)}" fill="${escapeAttr(shape.fill)}"${shape.stroke ? ` stroke="${escapeAttr(shape.stroke)}"` : ""}${shape.strokeWidth ? ` stroke-width="${shape.strokeWidth}"` : ""}/>`
    : shape.circle
      ? `<circle cx="${shape.circle.cx}" cy="${shape.circle.cy}" r="${shape.circle.r}" fill="${escapeAttr(shape.fill)}"/>`
      : `<rect x="${shape.rect?.x ?? 0}" y="${shape.rect?.y ?? 0}" width="${shape.rect?.width ?? 0}" height="${shape.rect?.height ?? 0}" fill="${escapeAttr(shape.fill)}"/>`;
  return `<marker id="${escapeAttr(arrowMarkerId(nodeId, type))}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">${shapeHtml}</marker>`;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
