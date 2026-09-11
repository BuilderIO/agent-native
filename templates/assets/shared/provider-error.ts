// `status` is deliberately absent. Providers put a machine enum there
// ("NOT_FOUND", "PERMISSION_DENIED"), never prose, so reading it would hand
// callers an implementation constant instead of the generic fallback this
// module promises.
const DETAIL_KEYS = ["message", "error", "detail", "details"] as const;

const MODEL_UNAVAILABLE_MARKERS = [
  "publisher model",
  "was not found or you do not have access",
  "was not found or your project does not have access",
  "unknown image model",
  "unknown video model",
  "model not found",
] as const;

const MAX_UNWRAP_DEPTH = 8;

const MAX_SHAPE_DEPTH = 10;

const ESCAPED_QUOTE = '\\"';

/**
 * True when the text is a serialized payload rather than prose a person can
 * act on. Every hop between Assets and the upstream model re-encodes the hop
 * below it as a JSON *string*, so a leaf value can still be an escaped object
 * that `JSON.parse` rejects once it has been truncated.
 */
export function looksLikeMachinePayload(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes(ESCAPED_QUOTE)
  );
}

/**
 * Pull the innermost human-readable sentence out of a provider failure.
 *
 * Returns `""` when the payload carries no prose. Callers must treat that as
 * "no detail to show" and fall back to their own wording: returning the raw
 * body instead is what dumped an escaped Vertex 404 into the candidate tray.
 */
export function readableProviderErrorDetail(
  value: unknown,
  maxLength = 300,
): string {
  const detail = walk(value, 0).trim();
  if (!detail || looksLikeMachinePayload(detail)) return "";
  return detail.length > maxLength
    ? `${detail.slice(0, maxLength).trimEnd()}...`
    : detail;
}

/**
 * True when the provider rejected the requested model itself, so retrying the
 * same request cannot succeed and the user needs a different model.
 */
export function isModelUnavailableDetail(detail: string): boolean {
  const text = detail.toLowerCase();
  return MODEL_UNAVAILABLE_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Name the envelope of a provider failure without emitting any of its values.
 *
 * An unreadable body means the service changed its shape, and the key path is
 * enough to see where the unwrap stopped. The values are not logged because a
 * provider error can echo prompt-derived content, reference URLs, or signed
 * links back to us.
 */
export function describeProviderPayloadShape(
  value: unknown,
  maxLength = 300,
): string {
  const shape = describeShape(value, 0);
  return shape.length > maxLength ? `${shape.slice(0, maxLength)}...` : shape;
}

function describeShape(value: unknown, depth: number): string {
  // Braced so a truncated branch still reads as "there was more here" rather
  // than as a plain scalar key.
  if (depth > MAX_SHAPE_DEPTH) return "{...}";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!looksLikeMachinePayload(trimmed)) return "string";
    const parsed = tryParseJson(trimmed);
    return parsed === undefined ? "unparsed" : describeShape(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.length ? `[${describeShape(value[0], depth + 1)}]` : "[]";
  }
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (!keys.length) return "{}";
  const record = value as Record<string, unknown>;
  const parts = keys.map((key) => {
    const inner = describeShape(record[key], depth + 1);
    return inner.startsWith("{") || inner.startsWith("[")
      ? `${key}${inner}`
      : key;
  });
  return `{${parts.join(",")}}`;
}

function walk(value: unknown, depth: number): string {
  if (depth > MAX_UNWRAP_DEPTH) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (!looksLikeMachinePayload(trimmed)) return trimmed;
    const parsed = tryParseJson(trimmed);
    return parsed === undefined ? "" : walk(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = walk(entry, depth + 1);
      if (nested) return nested;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const nested = walk(record[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // coercion-ok: `undefined` is the typed "not JSON" value the caller checks
    // for before deciding there is no readable detail.
    return undefined;
  }
}
