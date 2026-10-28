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

export function looksLikeMachinePayload(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes(ESCAPED_QUOTE)
  );
}

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

export function isModelUnavailableDetail(detail: string): boolean {
  const text = detail.toLowerCase();
  return MODEL_UNAVAILABLE_MARKERS.some((marker) => text.includes(marker));
}

export function describeProviderPayloadShape(
  value: unknown,
  maxLength = 300,
): string {
  const shape = describeShape(value, 0);
  return shape.length > maxLength ? `${shape.slice(0, maxLength)}...` : shape;
}

function describeShape(value: unknown, depth: number): string {
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
