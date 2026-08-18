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

/**
 * The Design Systems page and slide renderers read data.colors.* and
 * data.typography.* unconditionally (no optional chaining). A syntactically
 * valid but incomplete `data` payload — e.g. from an interrupted generation —
 * would otherwise persist and crash on the very next read. Shared between the
 * create/update actions (write-time validation) and the Design Systems page
 * (read-time validation of rows written before this check existed).
 */
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
