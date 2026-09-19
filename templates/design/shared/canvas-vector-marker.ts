export type CanvasVectorMarker =
  | "none"
  | "round"
  | "square"
  | "line"
  | "triangle"
  | "reversed-triangle"
  | "circle"
  | "diamond";

export type CanvasVectorMarkerEndpoint = "start" | "end";

export interface CanvasVectorMarkerSpec {
  d: string;
  refX: number;
}

export function canvasVectorMarkerSpec(
  marker: Exclude<CanvasVectorMarker, "none">,
): CanvasVectorMarkerSpec {
  switch (marker) {
    case "round":
      return {
        d: "M 5 0 A 5 5 0 1 0 5 10 A 5 5 0 1 0 5 0 Z",
        refX: 5,
      };
    case "square":
      return { d: "M 0 0 H 10 V 10 H 0 Z", refX: 10 };
    case "line":
      return { d: "M 0 0 L 10 5 L 0 10", refX: 10 };
    case "reversed-triangle":
      return { d: "M 10 0 L 0 5 L 10 10 Z", refX: 10 };
    case "circle":
      return {
        d: "M 5 0 A 5 5 0 1 1 5 10 A 5 5 0 1 1 5 0",
        refX: 5,
      };
    case "diamond":
      return { d: "M 5 0 L 10 5 L 5 10 L 0 5 Z", refX: 10 };
    case "triangle":
    default:
      return { d: "M 0 0 L 10 5 L 0 10 Z", refX: 10 };
  }
}

export function canvasVectorMarkerId(
  nodeId: string,
  endpoint: CanvasVectorMarkerEndpoint,
  marker: CanvasVectorMarker,
): string | null {
  if (marker === "none") return null;
  if (endpoint === "end" && marker === "triangle") return `${nodeId}-arrow`;
  return `${nodeId}-arrow-${endpoint}-${marker}`;
}

export function canvasVectorMarkerUrl(
  nodeId: string,
  endpoint: CanvasVectorMarkerEndpoint,
  marker: CanvasVectorMarker,
): string {
  const id = canvasVectorMarkerId(nodeId, endpoint, marker);
  return id ? `url(#${id})` : "none";
}

export function canvasVectorMarkerFromCssValue(
  value: string | undefined,
  endpoint: CanvasVectorMarkerEndpoint,
): CanvasVectorMarker {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "none") return "none";
  const match = trimmed.match(/^url\(["']?#([^)"']+)["']?\)$/);
  if (!match) return "none";
  const id = match[1]!;
  if (endpoint === "end" && /-arrow$/.test(id)) return "triangle";
  const marker = id.match(/-arrow-(?:start|end)-(.+)$/)?.[1];
  return marker &&
    [
      "round",
      "square",
      "line",
      "triangle",
      "reversed-triangle",
      "circle",
      "diamond",
    ].includes(marker)
    ? (marker as CanvasVectorMarker)
    : "none";
}
