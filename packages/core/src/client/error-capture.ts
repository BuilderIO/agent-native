import { isDynamicImportFailureMessage } from "./route-chunk-recovery.js";
import { scrubUrl } from "./url-scrub.js";

export type ExceptionLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface CaptureExceptionContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  level?: ExceptionLevel;
}

export interface ExceptionBreadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level?: ExceptionLevel;
}

export interface CapturedExceptionEvent {
  type: string;
  message: string;
  stack?: string;
  handled: boolean;
  level: ExceptionLevel;
  occurredAt: string;
  url?: string;
  release?: string;
  environment?: string;
  sessionId?: string;
  sessionReplayId?: string;
  anonymousId?: string;
  breadcrumbs: ExceptionBreadcrumb[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface InstallErrorCaptureOptions {
  send: (event: CapturedExceptionEvent) => void;
  getSessionContext?: () => {
    sessionId?: string;
    anonymousId?: string;
    replayId?: string;
  };
  emitReplayEvent?: (event: CapturedExceptionEvent) => void;
  release?: string;
  environment?: string;
  captureGlobalErrors?: boolean;
  captureUnhandledRejections?: boolean;
  maxBreadcrumbs?: number;
  dedupeWindowMs?: number;
}

interface ErrorCaptureRuntime {
  installed: boolean;
  config: Required<
    Pick<
      InstallErrorCaptureOptions,
      | "captureGlobalErrors"
      | "captureUnhandledRejections"
      | "maxBreadcrumbs"
      | "dedupeWindowMs"
    >
  > &
    Omit<
      InstallErrorCaptureOptions,
      | "captureGlobalErrors"
      | "captureUnhandledRejections"
      | "maxBreadcrumbs"
      | "dedupeWindowMs"
    >;
  breadcrumbs: ExceptionBreadcrumb[];
  recentSignatures: Map<string, number>;
  removeHandlers: (() => void) | null;
  navigationInstalled: boolean;
}

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 8000;
const MAX_TAGS = 30;
const MAX_EXTRA_KEYS = 50;
const MAX_EXTRA_DEPTH = 4;
const MAX_EXTRA_OBJECT_KEYS = 20;
const MAX_EXTRA_ARRAY_ITEMS = 20;
const MAX_EXTRA_STRING_LENGTH = 2000;

const ERROR_CAPTURE_STATE_KEY = Symbol.for("agent-native.client.errorCapture");

// stack/message that echoes a token never leaves the browser in the clear.
const SECRET_KEY_FRAGMENT =
  "(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|session|credential)";
const BEARER_RE = /\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const UNQUOTED_SECRET_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)([^"',\\s;}\\]]+)`,
  "gi",
);
const SECRET_KEY_RE = new RegExp(SECRET_KEY_FRAGMENT, "i");

function redactSecrets(value: string): string {
  return value
    .replace(BEARER_RE, "$1 <redacted>")
    .replace(UNQUOTED_SECRET_RE, "$1$2$1$3<redacted>");
}

function getRuntime(): ErrorCaptureRuntime {
  const g = globalThis as typeof globalThis & {
    [ERROR_CAPTURE_STATE_KEY]?: ErrorCaptureRuntime;
  };
  if (!g[ERROR_CAPTURE_STATE_KEY]) {
    g[ERROR_CAPTURE_STATE_KEY] = {
      installed: false,
      config: {
        send: () => {},
        captureGlobalErrors: true,
        captureUnhandledRejections: true,
        maxBreadcrumbs: 20,
        dedupeWindowMs: 3000,
      },
      breadcrumbs: [],
      recentSignatures: new Map(),
      removeHandlers: null,
      navigationInstalled: false,
    };
  }
  return g[ERROR_CAPTURE_STATE_KEY]!;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function currentUrl(): string | undefined {
  try {
    return scrubUrl(window.location.href);
  } catch {
    return undefined;
  }
}

export function normalizeCapturedError(error: unknown): {
  type: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message || String(error),
      stack: typeof error.stack === "string" ? error.stack : undefined,
    };
  }
  if (typeof error === "string") {
    return { type: "Error", message: error };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : undefined;
    const message =
      typeof record.message === "string" ? record.message : undefined;
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    if (name || message || stack) {
      return {
        type: name || "Error",
        message: message || safeStringify(error),
        stack,
      };
    }
    return { type: "Error", message: safeStringify(error) };
  }
  return { type: "Error", message: String(error) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function coerceTags(
  tags: CaptureExceptionContext["tags"],
): Record<string, string> | undefined {
  if (!tags) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(tags)) {
    if (count >= MAX_TAGS) break;
    if (value === undefined || value === null) continue;
    out[key] = truncate(redactSecrets(String(value)), 200);
    count += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

function coerceExtra(
  extra: CaptureExceptionContext["extra"],
): Record<string, unknown> | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(extra)) {
    if (count >= MAX_EXTRA_KEYS) break;
    const safeKey = truncate(redactSecrets(key), 100);
    out[safeKey] = SECRET_KEY_RE.test(safeKey)
      ? "<redacted>"
      : coerceExtraValue(value, MAX_EXTRA_DEPTH);
    count += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

function coerceExtraValue(value: unknown, depth: number): unknown {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return truncate(redactSecrets(value), MAX_EXTRA_STRING_LENGTH);
  }
  if (typeof value === "bigint") {
    return truncate(redactSecrets(value.toString()), MAX_EXTRA_STRING_LENGTH);
  }
  if (depth <= 0) {
    return truncate(
      redactSecrets(safeStringify(value)),
      MAX_EXTRA_STRING_LENGTH,
    );
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_EXTRA_ARRAY_ITEMS)
      .map((item) => coerceExtraValue(item, depth - 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [rawKey, child] of Object.entries(value)) {
      if (count >= MAX_EXTRA_OBJECT_KEYS) break;
      const key = truncate(redactSecrets(rawKey), 100);
      out[key] = SECRET_KEY_RE.test(key)
        ? "<redacted>"
        : coerceExtraValue(child, depth - 1);
      count += 1;
    }
    return out;
  }
  return truncate(redactSecrets(String(value)), MAX_EXTRA_STRING_LENGTH);
}

function firstStackLine(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((line) => line.trim());
  return (
    lines.find((line) => line.startsWith("at ") || /:\d+:\d+/.test(line)) ??
    lines[1] ??
    ""
  );
}

function signatureOf(type: string, message: string, stack?: string): string {
  return `${type}|${message}|${firstStackLine(stack)}`;
}

function normalizeGlobalErrorEvent(event: ErrorEvent): {
  type: string;
  message: string;
  stack?: string;
} {
  const error = event?.error;
  const normalized = error
    ? normalizeCapturedError(error)
    : {
        type: "Error",
        message: String(event?.message ?? "Uncaught error"),
      };

  if (!normalized.stack && event?.filename) {
    const line = event.lineno ?? 0;
    const col = event.colno ?? 0;
    normalized.stack = `at ${event.filename}:${line}:${col}`;
  }

  return normalized;
}

function shouldIgnoreAutoCapturedError(normalized: {
  type: string;
  message: string;
  stack?: string;
}): boolean {
  const message = (normalized.message || "").trim();
  const stack = normalized.stack || "";

  if (
    /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.?)$/i.test(
      message,
    )
  ) {
    return true;
  }

  if (!stack && isDynamicImportFailureMessage(message)) {
    return true;
  }

  if (
    normalized.type === "InvalidStateError" &&
    /^Transition was aborted because of invalid state$/i.test(message)
  ) {
    return true;
  }

  if (
    /^This script should only be loaded in a browser extension\.?$/i.test(
      message,
    )
  ) {
    return true;
  }

  const hasExtensionFrame =
    /\b(?:chrome|moz|safari|webkit)-extension:\/\//i.test(stack) ||
    /\binjectScriptAdjust\.js\b/i.test(stack);
  if (
    hasExtensionFrame &&
    /^(?:TypeError:\s*)?Failed to fetch(?:\s*\([^)]*\))?$/i.test(message)
  ) {
    return true;
  }

  return false;
}

function shouldDedupe(
  runtime: ErrorCaptureRuntime,
  signature: string,
): boolean {
  const now = Date.now();
  const windowMs = runtime.config.dedupeWindowMs;
  if (runtime.recentSignatures.size > 200) {
    for (const [key, ts] of runtime.recentSignatures) {
      if (now - ts > windowMs) runtime.recentSignatures.delete(key);
    }
  }
  const last = runtime.recentSignatures.get(signature);
  runtime.recentSignatures.set(signature, now);
  return last !== undefined && now - last < windowMs;
}

export function addErrorBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: ExceptionLevel;
}): void {
  try {
    const runtime = getRuntime();
    runtime.breadcrumbs.push({
      timestamp: nowIso(),
      category: truncate(breadcrumb.category, 60),
      message: truncate(redactSecrets(breadcrumb.message), 300),
      ...(breadcrumb.level ? { level: breadcrumb.level } : {}),
    });
    const max = runtime.config.maxBreadcrumbs;
    if (runtime.breadcrumbs.length > max) {
      runtime.breadcrumbs.splice(0, runtime.breadcrumbs.length - max);
    }
  } catch {
    // breadcrumbs are best-effort
  }
}

function snapshotBreadcrumbs(
  runtime: ErrorCaptureRuntime,
): ExceptionBreadcrumb[] {
  return runtime.breadcrumbs.slice(-runtime.config.maxBreadcrumbs);
}

function installNavigationBreadcrumbs(runtime: ErrorCaptureRuntime): void {
  if (runtime.navigationInstalled || typeof window === "undefined") return;
  runtime.navigationInstalled = true;
  const record = (navType: string) => {
    try {
      addErrorBreadcrumb({
        category: "navigation",
        message: `${navType} ${scrubUrl(window.location.href) ?? window.location.pathname}`,
      });
    } catch {
      // ignore
    }
  };
  try {
    const originalPush = window.history.pushState.bind(window.history);
    const originalReplace = window.history.replaceState.bind(window.history);
    window.history.pushState = function pushState(...args) {
      const result = originalPush.apply(this, args);
      record("navigate");
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplace.apply(this, args);
      record("replace");
      return result;
    };
    window.addEventListener("popstate", () => record("popstate"));
    record("load");
  } catch {
    // navigation breadcrumbs are best-effort
  }
}

function buildEvent(
  runtime: ErrorCaptureRuntime,
  normalized: { type: string; message: string; stack?: string },
  options: {
    handled: boolean;
    level: ExceptionLevel;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  },
): CapturedExceptionEvent {
  const context = runtime.config.getSessionContext?.() ?? {};
  const stack = normalized.stack
    ? truncate(redactSecrets(normalized.stack), MAX_STACK_LENGTH)
    : undefined;
  return {
    type: truncate(normalized.type || "Error", 200),
    message: truncate(
      redactSecrets(normalized.message || ""),
      MAX_MESSAGE_LENGTH,
    ),
    ...(stack ? { stack } : {}),
    handled: options.handled,
    level: options.level,
    occurredAt: nowIso(),
    ...(currentUrl() ? { url: currentUrl() } : {}),
    ...(runtime.config.release ? { release: runtime.config.release } : {}),
    ...(runtime.config.environment
      ? { environment: runtime.config.environment }
      : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.replayId ? { sessionReplayId: context.replayId } : {}),
    ...(context.anonymousId ? { anonymousId: context.anonymousId } : {}),
    breadcrumbs: snapshotBreadcrumbs(runtime),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.extra ? { extra: options.extra } : {}),
  };
}

function dispatch(
  runtime: ErrorCaptureRuntime,
  event: CapturedExceptionEvent,
  emitToReplay: boolean,
): void {
  const signature = signatureOf(event.type, event.message, event.stack);
  if (shouldDedupe(runtime, signature)) return;
  try {
    runtime.config.send(event);
  } catch {
    // transport must never throw into the host app
  }
  if (emitToReplay) {
    try {
      runtime.config.emitReplayEvent?.(event);
    } catch {
      // replay timeline emission is best-effort
    }
  }
  addErrorBreadcrumb({
    category: "exception",
    message: `${event.type}: ${event.message}`,
    level: event.level,
  });
}

export function captureException(
  error: unknown,
  context: CaptureExceptionContext = {},
): void {
  try {
    const runtime = getRuntime();
    const normalized = normalizeCapturedError(error);
    const event = buildEvent(runtime, normalized, {
      handled: true,
      level: context.level ?? "error",
      tags: coerceTags(context.tags),
      extra: coerceExtra(context.extra),
    });
    dispatch(runtime, event, true);
  } catch {
    // never throw from capture
  }
}

export function captureMessage(
  message: string,
  level: ExceptionLevel = "info",
): void {
  try {
    const runtime = getRuntime();
    const event = buildEvent(
      runtime,
      { type: "Message", message: String(message ?? "") },
      { handled: true, level },
    );
    dispatch(runtime, event, true);
  } catch {
    // never throw from capture
  }
}

export function installErrorCapture(
  options: InstallErrorCaptureOptions,
): () => void {
  const runtime = getRuntime();
  runtime.config = {
    ...runtime.config,
    ...options,
    captureGlobalErrors: options.captureGlobalErrors ?? true,
    captureUnhandledRejections: options.captureUnhandledRejections ?? true,
    maxBreadcrumbs: options.maxBreadcrumbs ?? runtime.config.maxBreadcrumbs,
    dedupeWindowMs: options.dedupeWindowMs ?? runtime.config.dedupeWindowMs,
  };

  if (typeof window === "undefined") return () => {};

  installNavigationBreadcrumbs(runtime);

  runtime.removeHandlers?.();
  runtime.removeHandlers = null;

  const removers: Array<() => void> = [];

  if (runtime.config.captureGlobalErrors) {
    const onError = (event: ErrorEvent) => {
      try {
        if (event.defaultPrevented) return;
        const normalized = normalizeGlobalErrorEvent(event);
        if (shouldIgnoreAutoCapturedError(normalized)) return;
        dispatch(
          runtime,
          buildEvent(runtime, normalized, {
            handled: false,
            level: "error",
          }),
          false,
        );
      } catch {
        // never throw from the listener
      }
    };
    window.addEventListener("error", onError as EventListener);
    removers.push(() =>
      window.removeEventListener("error", onError as EventListener),
    );
  }

  if (runtime.config.captureUnhandledRejections) {
    const onRejection = (event: PromiseRejectionEvent) => {
      try {
        if (event.defaultPrevented) return;
        const reason = event?.reason;
        const normalized = normalizeCapturedError(reason);
        if (!normalized.type || normalized.type === "Error") {
          normalized.type = "UnhandledRejection";
        }
        if (shouldIgnoreAutoCapturedError(normalized)) return;
        dispatch(
          runtime,
          buildEvent(runtime, normalized, {
            handled: false,
            level: "error",
          }),
          false,
        );
      } catch {
        // never throw from the listener
      }
    };
    window.addEventListener("unhandledrejection", onRejection as EventListener);
    removers.push(() =>
      window.removeEventListener(
        "unhandledrejection",
        onRejection as EventListener,
      ),
    );
  }

  runtime.installed = true;
  runtime.removeHandlers = () => {
    for (const remove of removers) {
      try {
        remove();
      } catch {
        // best-effort teardown
      }
    }
    runtime.removeHandlers = null;
    runtime.installed = false;
  };
  return runtime.removeHandlers;
}

export function isErrorCaptureInstalled(): boolean {
  return getRuntime().installed;
}
