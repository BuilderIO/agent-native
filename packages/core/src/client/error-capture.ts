/**
 * First-party, Sentry-style browser error capture for the Agent Native
 * analytics SDK.
 *
 * Two responsibilities:
 *  1. Automatic capture of uncaught exceptions (`window.onerror`) and
 *     unhandled promise rejections (`unhandledrejection`).
 *  2. A documented manual API — `captureException(error, context?)` and
 *     `captureMessage(message, level?)` — mirroring Sentry's ergonomics.
 *
 * Captured exceptions are handed to a `send` callback (wired by
 * `configureTracking` to the first-party analytics `/track` ingest as a
 * dedicated `$exception` event) and are tagged with the current analytics
 * session id + session replay id so each error links back to the recording it
 * happened in. Everything here is defensive: capture must never throw back into
 * the host app, so every path is wrapped and failures are swallowed.
 *
 * Stack parsing and fingerprinting are intentionally done authoritatively on
 * the server (see the analytics template's `server/lib/error-capture.ts`); the
 * client sends a compact, bounded payload (type/message/raw stack/context) and
 * the server normalizes + groups it. That keeps one tested source of truth for
 * grouping instead of duplicating parser logic across the wire.
 */
import { scrubUrl } from "./url-scrub.js";

export type ExceptionLevel = "fatal" | "error" | "warning" | "info" | "debug";

/** Extra Sentry-style context accepted by `captureException`. */
export interface CaptureExceptionContext {
  /** Low-cardinality searchable tags. Values are coerced to strings. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Structured, higher-cardinality detail shown on the event. */
  extra?: Record<string, unknown>;
  /** Severity; defaults to "error". */
  level?: ExceptionLevel;
}

export interface ExceptionBreadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level?: ExceptionLevel;
}

/**
 * Compact exception payload emitted to transport. Field names are the wire
 * contract the analytics server ingest reads — keep them stable.
 */
export interface CapturedExceptionEvent {
  /** Error class/name, e.g. "TypeError". "Message" for `captureMessage`. */
  type: string;
  message: string;
  /** Raw (bounded, redacted) stack string; server parses it into frames. */
  stack?: string;
  /** False for uncaught/global errors, true for manually handled ones. */
  handled: boolean;
  level: ExceptionLevel;
  /** ISO timestamp of the occurrence. */
  occurredAt: string;
  url?: string;
  release?: string;
  environment?: string;
  sessionId?: string;
  /** Client session replay id (localStorage) for replay linkage. */
  sessionReplayId?: string;
  anonymousId?: string;
  breadcrumbs: ExceptionBreadcrumb[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface InstallErrorCaptureOptions {
  /** Transport for a captured exception. Must not throw. */
  send: (event: CapturedExceptionEvent) => void;
  /** Resolve current analytics/session-replay identifiers at capture time. */
  getSessionContext?: () => {
    sessionId?: string;
    anonymousId?: string;
    replayId?: string;
  };
  /**
   * Optional hook to also surface a manual capture on the session replay
   * timeline. Only invoked for manual `captureException`/`captureMessage`;
   * auto-captured global errors are already recorded by the replay recorder.
   */
  emitReplayEvent?: (event: CapturedExceptionEvent) => void;
  release?: string;
  environment?: string;
  /** Auto-capture `window.onerror`. Defaults to true. */
  captureGlobalErrors?: boolean;
  /** Auto-capture `unhandledrejection`. Defaults to true. */
  captureUnhandledRejections?: boolean;
  /** Breadcrumb ring buffer size. Defaults to 20. */
  maxBreadcrumbs?: number;
  /** Dedupe window (ms) for identical signatures. Defaults to 3000. */
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

// Reuse the same credential-looking redaction the replay capture uses so a
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

/** Normalize any thrown value into a stable `{ type, message, stack }`. */
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

/** Cheap client-side signature used only for local dedupe. */
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
    /^(?:TypeError:\s*)?Failed to fetch$/i.test(message)
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
  // Opportunistic cleanup so the map can't grow without bound.
  if (runtime.recentSignatures.size > 200) {
    for (const [key, ts] of runtime.recentSignatures) {
      if (now - ts > windowMs) runtime.recentSignatures.delete(key);
    }
  }
  const last = runtime.recentSignatures.get(signature);
  runtime.recentSignatures.set(signature, now);
  return last !== undefined && now - last < windowMs;
}

/** Append a privacy-safe breadcrumb to the bounded ring buffer. */
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
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
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
    // Seed the trail with the initial location.
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
  // Record the exception itself as a breadcrumb so a following error carries
  // the prior failure in its trail.
  addErrorBreadcrumb({
    category: "exception",
    message: `${event.type}: ${event.message}`,
    level: event.level,
  });
}

/**
 * Capture a handled exception. Mirrors Sentry's `captureException(err, ctx)`.
 * Safe to call before `configureTracking` has run — it simply no-ops if no
 * transport is installed yet.
 */
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

/**
 * Capture a message string as an exception-like event. Mirrors Sentry's
 * `captureMessage(message, level?)`.
 */
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

/**
 * Install auto-capture + wire the transport. Idempotent: re-invoking updates
 * the config (and (re)installs global handlers) without duplicating listeners.
 * Returns a disposer that removes the global handlers.
 */
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

  // Tear down any previously-installed handlers before reinstalling so a second
  // configureTracking call doesn't double-report.
  runtime.removeHandlers?.();
  runtime.removeHandlers = null;

  const removers: Array<() => void> = [];

  if (runtime.config.captureGlobalErrors) {
    const onError = (event: ErrorEvent) => {
      try {
        const normalized = normalizeGlobalErrorEvent(event);
        if (shouldIgnoreAutoCapturedError(normalized)) return;
        // Global errors are already logged by the session replay recorder, so
        // don't re-emit them onto the replay timeline (avoid double-counting).
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
