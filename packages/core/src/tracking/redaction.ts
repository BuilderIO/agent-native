export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 8000;
export const MAX_TAGS = 30;
export const MAX_EXTRA_KEYS = 30;
export const MAX_EXTRA_VALUE_LENGTH = 1000;

const SECRET_RE = /\b(?:bearer|basic)\s+[^\s]+/gi;
const SQL_PARAMS_RE =
  /\b(?:failed query|query failed):[\s\S]*?(\r?\n[ \t]*params:\s*)[\s\S]*$/i;

export const SECRET_KEY_RE =
  /(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)/i;

export function redact(value: string): string {
  return value
    .replace(SECRET_RE, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`)
    .replace(
      /([A-Za-z0-9_$.-]*(?:authorization|cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)[A-Za-z0-9_$.-]*\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1<redacted>",
    )
    .replace(SQL_PARAMS_RE, "$1<redacted>");
}

export function boundedText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const safe = redact(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

export function redactErrorStack(error: unknown): string | undefined {
  const stack =
    error instanceof Error
      ? error.stack
      : error && typeof error === "object" && "stack" in error
        ? error.stack
        : undefined;
  if (typeof stack !== "string") return undefined;

  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const prefix = `${error.name || "Error"}${error.message ? `: ${error.message}` : ""}`;
    const suffix = stack.slice(prefix.length);
    if (stack.startsWith(prefix) && (!suffix || /^\r?\n/.test(suffix))) {
      const safe = `${redact(prefix)}${redact(suffix)}`;
      return safe.length > MAX_STACK_LENGTH
        ? safe.slice(0, MAX_STACK_LENGTH)
        : safe;
    }
  }

  // ponytail: Unknown stack formats lose frames; keep whole-tail redaction until the source exposes a message boundary.
  return boundedText(stack, MAX_STACK_LENGTH);
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

export function exceptionParts(error: unknown): ExceptionParts {
  if (error instanceof Error) {
    const stack = redactErrorStack(error);
    return {
      type: boundedText(error.name || "Error", 200),
      message: boundedText(
        error.message || error.name || "Error",
        MAX_MESSAGE_LENGTH,
      ),
      ...(stack ? { stack } : {}),
    };
  }
  const stack = redactErrorStack(error);
  return {
    type: "Error",
    message: boundedText(error, MAX_MESSAGE_LENGTH),
    ...(stack ? { stack } : {}),
  };
}
