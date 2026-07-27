import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import type { CaptureErrorContext } from "../server/capture-error.js";
import { track } from "./registry.js";

export type TrackingExceptionLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";

export interface TrackingExceptionContext extends CaptureErrorContext {
  /** Whether the caller handled the error. Server error hooks default false. */
  handled?: boolean;
  level?: TrackingExceptionLevel;
  release?: string;
  environment?: string;
  runtime?: "node" | "cli";
  source?: "server" | "cli";
}

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 8000;
const MAX_TAGS = 30;
const MAX_EXTRA_KEYS = 30;
const MAX_EXTRA_VALUE_LENGTH = 1000;
const SECRET_RE = /\b(?:bearer|basic)\s+[^\s]+/gi;
const SECRET_KEY_RE =
  /(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)/i;

function redact(value: string): string {
  return value
    .replace(SECRET_RE, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`)
    .replace(
      /([A-Za-z0-9_$.-]*(?:authorization|cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)[A-Za-z0-9_$.-]*\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1<redacted>",
    );
}

function boundedText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const safe = redact(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

function safeValue(value: unknown, depth = 2): unknown {
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

function exceptionParts(error: unknown): {
  type: string;
  message: string;
  stack?: string;
} {
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

function safeTags(
  tags: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (Object.keys(out).length >= MAX_TAGS || value == null) break;
    const safeKey = boundedText(key, 100);
    out[safeKey] = SECRET_KEY_RE.test(safeKey)
      ? "<redacted>"
      : boundedText(value, 200);
  }
  return out;
}

/** Emit a bounded, redacted Node/CLI exception through first-party tracking. */
export function captureException(
  error: unknown,
  context: TrackingExceptionContext = {},
): void {
  try {
    const parts = exceptionParts(error);
    const tags = safeTags({
      ...context.tags,
      ...(context.route ? { route: context.route } : {}),
      ...(context.method ? { method: context.method } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    });
    const extra = safeValue({
      ...context.extra,
      ...(context.contexts ? { contexts: context.contexts } : {}),
    });
    track("$exception", {
      ...trackingIdentityProperties(),
      exceptionType: parts.type,
      exceptionMessage: parts.message,
      ...(parts.stack ? { exceptionStack: parts.stack } : {}),
      handled: context.handled ?? true,
      level: context.level ?? "error",
      occurredAt: new Date().toISOString(),
      runtime: context.runtime ?? "node",
      source: context.source ?? "server",
      ...(context.route ? { url: boundedText(context.route, 500) } : {}),
      ...(context.release
        ? { release: boundedText(context.release, 200) }
        : {}),
      ...(context.environment
        ? { environment: boundedText(context.environment, 100) }
        : {}),
      ...(Object.keys(tags).length ? { exceptionTags: tags } : {}),
      ...(extra && typeof extra === "object" ? { exceptionExtra: extra } : {}),
    });
  } catch {
    // Error reporting must never mask the original failure.
  }
}
