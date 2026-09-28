const REQUIRED_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "textMuted",
];

const REQUIRED_TYPOGRAPHY_KEYS = [
  "headingFont",
  "bodyFont",
  "headingWeight",
  "bodyWeight",
];

export function missingDesignSystemDataFields(value: unknown): string[] {
  const missing: string[] = [];
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const colors =
    record.colors && typeof record.colors === "object"
      ? (record.colors as Record<string, unknown>)
      : null;
  if (!colors) {
    missing.push("colors");
  } else {
    for (const key of REQUIRED_COLOR_KEYS) {
      if (typeof colors[key] !== "string" || !colors[key]) {
        missing.push(`colors.${key}`);
      }
    }
  }

  const typography =
    record.typography && typeof record.typography === "object"
      ? (record.typography as Record<string, unknown>)
      : null;
  if (!typography) {
    missing.push("typography");
  } else {
    for (const key of REQUIRED_TYPOGRAPHY_KEYS) {
      if (typeof typography[key] !== "string" || !typography[key]) {
        missing.push(`typography.${key}`);
      }
    }
  }

  return missing;
}

export type DesignSystemIndexingStatus = "ready" | "indexing" | "unavailable";

export function getDesignSystemIndexingStatus(
  data: unknown,
): DesignSystemIndexingStatus {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!record || record.source !== "builder") return "ready";

  const hasColors = record.colors && typeof record.colors === "object";
  const hasTypography =
    record.typography && typeof record.typography === "object";
  const docCount = typeof record.docCount === "number" ? record.docCount : 0;
  const hasTokens =
    record.tokenValues &&
    typeof record.tokenValues === "object" &&
    Object.keys(record.tokenValues as Record<string, unknown>).length > 0;

  if (hasColors || hasTypography || docCount > 0 || hasTokens) return "ready";
  if (record.warning) return "unavailable";
  return "indexing";
}

export function parseDesignSystemIndexingStatus(
  data: string | null | undefined,
): DesignSystemIndexingStatus {
  if (!data) return "ready";
  try {
    return getDesignSystemIndexingStatus(JSON.parse(data));
  } catch {
    return "unavailable";
  }
}
