export type ViewportMode = "foreground" | "background";

export function normalizeViewportMode(
  value: unknown,
): ViewportMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "foreground" || normalized === "background") {
    return normalized;
  }
  return undefined;
}
