/**
 * Bounding and redaction helpers shared by every exception emitter.
 *
 * Kept free of `process.env` and Node built-ins so the browser bundle can use
 * the same rules — an exception shaped one way on the server and another way
 * in the client is how a leak ships in only one of them.
 */

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 8000;
export const MAX_TAGS = 30;
export const MAX_EXTRA_KEYS = 30;
export const MAX_EXTRA_VALUE_LENGTH = 1000;

const SECRET_RE = /\b(?:bearer|basic)\s+[^\s]+/gi;

export const SECRET_KEY_RE =
  /(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)/i;

export function redact(value: string): string {
  return value
    .replace(SECRET_RE, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`)
    .replace(
      /([A-Za-z0-9_$.-]*(?:authorization|cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)[A-Za-z0-9_$.-]*\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1<redacted>",
    );
}

export function boundedText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const safe = redact(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

export function safeValue(value: unknown, depth = 2): unknown {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string")
    return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
  if (depth <= 0) return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => safeValue(item, depth - 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
      const safeKey = boundedText(key, 100);
      out[safeKey] = SECRET_KEY_RE.test(safeKey)
        ? "<redacted>"
        : safeValue(child, depth - 1);
    }
    return out;
  }
  return boundedText(value, MAX_EXTRA_VALUE_LENGTH);
}

export function safeTags(
  tags: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (Object.keys(out).length >= MAX_TAGS) break;
    // Skip, don't stop: callers build tag objects with optional entries
    // (`{ ...tags, route, method, userAgent }`), so breaking on the first
    // undefined dropped every tag after it depending on key order.
    if (value == null) continue;
    const safeKey = boundedText(key, 100);
    out[safeKey] = SECRET_KEY_RE.test(safeKey)
      ? "<redacted>"
      : boundedText(value, 200);
  }
  return out;
}

export interface ExceptionParts {
  type: string;
  message: string;
  stack?: string;
}

/** Split an unknown thrown value into bounded, redacted type/message/stack. */
export function exceptionParts(error: unknown): ExceptionParts {
  if (error instanceof Error) {
    return {
      type: boundedText(error.name || "Error", 200),
      message: boundedText(
        error.message || error.name || "Error",
        MAX_MESSAGE_LENGTH,
      ),
      ...(error.stack
        ? { stack: boundedText(error.stack, MAX_STACK_LENGTH) }
        : {}),
    };
  }
  return {
    type: "Error",
    message: boundedText(error, MAX_MESSAGE_LENGTH),
  };
}
