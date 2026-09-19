export const VECTOR_ENDPOINT_OPTIONS = [
  "none",
  "round",
  "square",
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle",
  "circle-arrow",
  "diamond-arrow",
] as const;

export type VectorEndpoint = (typeof VECTOR_ENDPOINT_OPTIONS)[number];

export function isVectorEndpoint(value: unknown): value is VectorEndpoint {
  return (
    typeof value === "string" &&
    (VECTOR_ENDPOINT_OPTIONS as readonly string[]).includes(value)
  );
}

export function normalizeVectorEndpoint(
  value: unknown,
  fallback: VectorEndpoint = "none",
): VectorEndpoint {
  return isVectorEndpoint(value) ? value : fallback;
}

export function defaultVectorEndpoint(
  kind: string | undefined,
  side: "start" | "end",
): VectorEndpoint {
  return kind === "arrow" && side === "end" ? "line-arrow" : "none";
}

export function vectorEndpointMarkerId(
  nodeId: string,
  endpoint: Exclude<VectorEndpoint, "none">,
): string {
  return endpoint === "line-arrow"
    ? `${nodeId}-arrow`
    : `${nodeId}-endpoint-${endpoint}`;
}

export function vectorEndpointMarkerUrl(
  nodeId: string,
  endpoint: VectorEndpoint,
): string {
  return endpoint === "none"
    ? "none"
    : `url(#${vectorEndpointMarkerId(nodeId, endpoint)})`;
}

export function vectorEndpointFromMarkerValue(
  value: string | undefined,
  nodeId: string | undefined,
  fallback: VectorEndpoint = "none",
): VectorEndpoint {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "none") return "none";
  const reference = trimmed.match(
    /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/i,
  )?.[1];
  if (!reference) return fallback;

  if (nodeId && reference === vectorEndpointMarkerId(nodeId, "line-arrow")) {
    return "line-arrow";
  }
  for (const endpoint of VECTOR_ENDPOINT_OPTIONS) {
    if (endpoint === "none") continue;
    if (nodeId && reference === vectorEndpointMarkerId(nodeId, endpoint)) {
      return endpoint;
    }
    if (reference.endsWith(`-endpoint-${endpoint}`)) return endpoint;
  }
  return reference.endsWith("-arrow") ? "line-arrow" : fallback;
}

export interface VectorEndpointMarkerShape {
  d: string;
  fill: "none" | "stroke";
  stroke: boolean;
}

export function vectorEndpointMarkerShape(
  endpoint: Exclude<VectorEndpoint, "none">,
): VectorEndpointMarkerShape {
  switch (endpoint) {
    case "round":
      return {
        d: "M 5 0 A 5 5 0 1 0 5 10 A 5 5 0 1 0 5 0 z",
        fill: "stroke",
        stroke: false,
      };
    case "square":
      return { d: "M 0 0 H 10 V 10 H 0 z", fill: "stroke", stroke: false };
    case "line-arrow":
      return { d: "M 0 0 L 10 5 L 0 10", fill: "none", stroke: true };
    case "reversed-triangle":
      return {
        d: "M 10 0 L 0 5 L 10 10 z",
        fill: "stroke",
        stroke: false,
      };
    case "circle-arrow":
      return {
        d: "M 5 0 A 5 5 0 1 0 5 10 A 5 5 0 1 0 5 0 z",
        fill: "none",
        stroke: true,
      };
    case "diamond-arrow":
      return {
        d: "M 5 0 L 10 5 L 5 10 L 0 5 z",
        fill: "stroke",
        stroke: false,
      };
    case "triangle-arrow":
      return { d: "M 0 0 L 10 5 L 0 10 z", fill: "stroke", stroke: false };
  }
}
