export const VECTOR_ENDPOINT_STYLES = [
  "none",
  "round",
  "square",
  "line",
  "triangle",
  "reversed-triangle",
  "circle",
  "diamond",
] as const;

export type VectorEndpointStyle = (typeof VECTOR_ENDPOINT_STYLES)[number];
export type VectorEndpointSide = "start" | "end";
export type VectorEndpointPrimitiveKind = "path" | "line" | "arrow";

export const VECTOR_START_ENDPOINT_PROPERTY = "--an-vector-start-point";
export const VECTOR_END_ENDPOINT_PROPERTY = "--an-vector-end-point";

export const VECTOR_ENDPOINT_PROPERTIES = [
  VECTOR_START_ENDPOINT_PROPERTY,
  VECTOR_END_ENDPOINT_PROPERTY,
] as const;

export function isVectorEndpointPrimitiveKind(
  value: unknown,
): value is VectorEndpointPrimitiveKind {
  return value === "path" || value === "line" || value === "arrow";
}

export function isVectorEndpointProperty(
  value: string,
): value is (typeof VECTOR_ENDPOINT_PROPERTIES)[number] {
  return (VECTOR_ENDPOINT_PROPERTIES as readonly string[]).includes(value);
}

export const DEFAULT_VECTOR_START_ENDPOINT: VectorEndpointStyle = "none";
export const DEFAULT_VECTOR_END_ENDPOINT: VectorEndpointStyle = "none";
export const DEFAULT_ARROW_START_ENDPOINT: VectorEndpointStyle = "none";
export const DEFAULT_ARROW_END_ENDPOINT: VectorEndpointStyle = "triangle";

export interface VectorEndpointPair {
  startPoint: VectorEndpointStyle;
  endPoint: VectorEndpointStyle;
}

export interface VectorEndpointShape {
  tag: "circle" | "path" | "rect";
  attributes: Record<string, string>;
}

export function isVectorEndpointStyle(
  value: unknown,
): value is VectorEndpointStyle {
  return (
    typeof value === "string" &&
    (VECTOR_ENDPOINT_STYLES as readonly string[]).includes(value)
  );
}

export function normalizeVectorEndpointStyle(
  value: unknown,
  fallback: VectorEndpointStyle,
): VectorEndpointStyle {
  return isVectorEndpointStyle(value) ? value : fallback;
}

export function vectorEndpointPairForPrimitive(
  kind: string | undefined,
  startPoint?: unknown,
  endPoint?: unknown,
): VectorEndpointPair {
  const isArrow = kind === "arrow";
  return {
    startPoint: normalizeVectorEndpointStyle(
      startPoint,
      isArrow ? DEFAULT_ARROW_START_ENDPOINT : DEFAULT_VECTOR_START_ENDPOINT,
    ),
    endPoint: normalizeVectorEndpointStyle(
      endPoint,
      isArrow ? DEFAULT_ARROW_END_ENDPOINT : DEFAULT_VECTOR_END_ENDPOINT,
    ),
  };
}

export function vectorEndpointPropertyForSide(
  side: VectorEndpointSide,
): (typeof VECTOR_ENDPOINT_PROPERTIES)[number] {
  return side === "start"
    ? VECTOR_START_ENDPOINT_PROPERTY
    : VECTOR_END_ENDPOINT_PROPERTY;
}

export function vectorEndpointMarkerOrientation(
  side: VectorEndpointSide,
): "auto-start-reverse" | "auto" {
  return side === "start" ? "auto-start-reverse" : "auto";
}

export function vectorEndpointMarkerId(
  nodeId: string,
  side: VectorEndpointSide,
): string {
  const safeNodeId = nodeId.replace(/[^A-Za-z0-9_-]/g, "-") || "vector";
  const safePrefix = /^[A-Za-z_]/.test(safeNodeId)
    ? safeNodeId
    : `vector-${safeNodeId}`;
  const markerNodeId =
    safePrefix === safeNodeId && safeNodeId === nodeId
      ? safeNodeId
      : `${safePrefix}.${
          nodeId
            .split("")
            .map((character) =>
              character.charCodeAt(0).toString(16).padStart(4, "0"),
            )
            .join("") || "0"
        }`;
  return `${markerNodeId}-vector-marker-${side}`;
}

export function vectorEndpointMarkerRefX(
  endpoint: VectorEndpointStyle,
): "0" | "8" {
  return endpoint === "reversed-triangle" ? "0" : "8";
}

export function vectorEndpointShape(
  endpoint: VectorEndpointStyle,
): VectorEndpointShape | null {
  switch (endpoint) {
    case "round":
      return {
        tag: "circle",
        attributes: { cx: "5", cy: "5", r: "4", fill: "context-stroke" },
      };
    case "square":
      return {
        tag: "rect",
        attributes: {
          x: "1",
          y: "1",
          width: "8",
          height: "8",
          fill: "context-stroke",
        },
      };
    case "line":
      return {
        tag: "path",
        attributes: {
          d: "M 0 0 L 10 5 L 0 10",
          fill: "none",
          stroke: "context-stroke",
          "stroke-width": "1",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
      };
    case "triangle":
      return {
        tag: "path",
        attributes: {
          d: "M 0 0 L 10 5 L 0 10 z",
          fill: "context-stroke",
        },
      };
    case "reversed-triangle":
      return {
        tag: "path",
        attributes: {
          d: "M 10 0 L 0 5 L 10 10 z",
          fill: "context-stroke",
        },
      };
    case "circle":
      return {
        tag: "circle",
        attributes: {
          cx: "5",
          cy: "5",
          r: "4",
          fill: "none",
          stroke: "context-stroke",
          "stroke-width": "1",
        },
      };
    case "diamond":
      return {
        tag: "path",
        attributes: {
          d: "M 5 0 L 10 5 L 5 10 L 0 5 z",
          fill: "none",
          stroke: "context-stroke",
          "stroke-width": "1",
          "stroke-linejoin": "round",
        },
      };
    case "none":
      return null;
  }
}

function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markerMarkup(
  nodeId: string,
  side: VectorEndpointSide,
  endpoint: VectorEndpointStyle,
): string {
  const shape = vectorEndpointShape(endpoint);
  if (!shape) return "";
  const attributes = Object.entries(shape.attributes)
    .map(([name, value]) => `${name}="${escapeMarkup(value)}"`)
    .join(" ");
  const refX = vectorEndpointMarkerRefX(endpoint);
  return `<marker data-an-vector-endpoint-marker="${side}" id="${escapeMarkup(vectorEndpointMarkerId(nodeId, side))}" markerWidth="10" markerHeight="10" refX="${refX}" refY="5" orient="${vectorEndpointMarkerOrientation(side)}" markerUnits="strokeWidth"><${shape.tag} ${attributes}/></marker>`;
}

export function vectorEndpointDefsMarkup(
  nodeId: string,
  endpoints: VectorEndpointPair,
): string {
  const markers = [
    markerMarkup(nodeId, "start", endpoints.startPoint),
    markerMarkup(nodeId, "end", endpoints.endPoint),
  ]
    .filter(Boolean)
    .join("");
  return markers
    ? `<defs data-an-vector-endpoints="true">${markers}</defs>`
    : "";
}

export function vectorEndpointAttributesMarkup(
  nodeId: string,
  endpoints: VectorEndpointPair,
): string {
  const attributes: string[] = [];
  if (endpoints.startPoint !== "none") {
    attributes.push(
      `marker-start="url(#${escapeMarkup(vectorEndpointMarkerId(nodeId, "start"))})"`,
    );
  }
  if (endpoints.endPoint !== "none") {
    attributes.push(
      `marker-end="url(#${escapeMarkup(vectorEndpointMarkerId(nodeId, "end"))})"`,
    );
  }
  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}
