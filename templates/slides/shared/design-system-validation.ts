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

export type DesignSystemIndexingStatus = "ready" | "indexing" | "unavailable";

const READY_BUILDER_STATUSES = new Set(["ready", "complete", "completed"]);
const UNAVAILABLE_BUILDER_STATUSES = new Set([
  "error",
  "failed",
  "cancelled",
  "canceled",
]);

/**
 * A Builder-indexed proxy design system (see `builder-design-system-proxy.ts`)
 * has no usable tokens/components until Builder confirms indexing finished —
 * selecting it before then is exactly what produced the "still being
 * indexed" agent stall this guards against. A locally authored design system
 * has no `builderStatus` at all and is always immediately usable. An
 * unrecognized or missing status on a Builder-sourced row is treated as still
 * indexing rather than ready, so a stale or malformed row never becomes
 * silently selectable.
 */
export function getDesignSystemIndexingStatus(
  data: unknown,
): DesignSystemIndexingStatus {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!record || record.source !== "builder") return "ready";

  const rawStatus = record.builderStatus;
  const status =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  if (READY_BUILDER_STATUSES.has(status)) return "ready";
  if (UNAVAILABLE_BUILDER_STATUSES.has(status)) return "unavailable";
  return "indexing";
}

/**
 * Same as `getDesignSystemIndexingStatus`, for callers that only have the raw
 * `data` JSON string (e.g. `list-design-systems`' row). Empty/missing data has
 * never been written by create/update-design-system, so it reads as a legacy
 * row predating that column rather than a corrupted one. A non-empty string
 * that fails to parse is corrupted — its `source`/`builderStatus` can't be
 * read, so it fails closed to `unavailable` instead of the ready default.
 */
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
