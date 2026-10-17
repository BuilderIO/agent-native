import {
  classifyErrorNoise,
  type ErrorNoiseReason,
} from "../shared/error-noise.js";
import {
  readStaleChunkRecoveryExhausted,
  STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT,
  type StaleChunkRecoveryExhausted,
} from "./route-chunk-recovery.js";
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
  /** Events one page session may send in total. Default 20. */
  maxEventsPerSession?: number;
  /** Events one error signature may send per session. Default 3. */
  maxEventsPerSignature?: number;
  /** How long to wait before reporting what the budget dropped. Default 15s. */
  budgetSummaryDelayMs?: number;
}

interface ErrorCaptureBudget {
  sent: number;
  bySignature: Map<string, number>;
  dropped: number;
  droppedTotal: number;
  droppedBySignature: Map<string, number>;
  noise: Partial<Record<ErrorNoiseReason, number>>;
  summaryFlushes: number;
  summaryTimer: ReturnType<typeof setTimeout> | null;
}

export interface ErrorCaptureStats {
  sent: number;
  budgetDropped: number;
  noiseSuppressed: Partial<Record<ErrorNoiseReason, number>>;
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
      | "maxEventsPerSession"
      | "maxEventsPerSignature"
      | "budgetSummaryDelayMs"
    >
  > &
    Omit<
      InstallErrorCaptureOptions,
      | "captureGlobalErrors"
      | "captureUnhandledRejections"
      | "maxBreadcrumbs"
      | "dedupeWindowMs"
      | "maxEventsPerSession"
      | "maxEventsPerSignature"
      | "budgetSummaryDelayMs"
    >;
  breadcrumbs: ExceptionBreadcrumb[];
  recentSignatures: Map<string, number>;
  budget?: ErrorCaptureBudget;
  removeHandlers: (() => void) | null;
  navigationInstalled: boolean;
  staleChunkExhaustedReported?: boolean;
}

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 8000;
const MAX_TAGS = 30;
const MAX_EXTRA_KEYS = 50;
const MAX_EXTRA_DEPTH = 4;
const MAX_EXTRA_OBJECT_KEYS = 20;
const MAX_EXTRA_ARRAY_ITEMS = 20;
const MAX_EXTRA_STRING_LENGTH = 2000;
const DEFAULT_MAX_EVENTS_PER_SESSION = 20;
const DEFAULT_MAX_EVENTS_PER_SIGNATURE = 3;
const DEFAULT_BUDGET_SUMMARY_DELAY_MS = 15_000;
const MAX_TRACKED_BUDGET_SIGNATURES = 200;
const MAX_TRACKED_DROPPED_SIGNATURES = 50;
const OTHER_DROPPED_SIGNATURES_KEY = "other";
// A signature seen for the first time passes the session cap up to this
// multiple of it: a long-lived tab must still report a new bug after its first
// 20 errors, while a storm of distinct messages stays bounded.
const NEW_SIGNATURE_SESSION_CAP_FACTOR = 2;
const MAX_BUDGET_SUMMARIES_PER_SESSION = 3;
const BUDGET_EXCEEDED_EVENT_TYPE = "ErrorBudgetExceeded";

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
        maxEventsPerSession: DEFAULT_MAX_EVENTS_PER_SESSION,
        maxEventsPerSignature: DEFAULT_MAX_EVENTS_PER_SIGNATURE,
        budgetSummaryDelayMs: DEFAULT_BUDGET_SUMMARY_DELAY_MS,
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

// Hosts that serve this app's scripts: the page, and wherever this bundle was
// loaded from (a deployment may serve its assets from a CDN host). Frames on any
// other host are foreign; without these the noise rules only trust positively
// identified third parties.
export function firstPartyHosts(): string[] {
  const hosts: string[] = [];
  try {
    if (window.location.hostname) hosts.push(window.location.hostname);
    // coercion-ok: no page host just narrows the rules to known third parties.
  } catch {
    // window.location is unavailable outside a browser.
  }
  try {
    const assetHost = new URL(import.meta.url).hostname;
    if (assetHost) hosts.push(assetHost);
    // coercion-ok: no asset host just narrows the rules to known third parties.
  } catch {
    // import.meta.url is not a URL in every bundler.
  }
  return hosts;
}

function getBudget(runtime: ErrorCaptureRuntime): ErrorCaptureBudget {
  return (runtime.budget ??= {
    sent: 0,
    bySignature: new Map(),
    dropped: 0,
    droppedTotal: 0,
    droppedBySignature: new Map(),
    noise: {},
    summaryFlushes: 0,
    summaryTimer: null,
  });
}

export function getErrorCaptureStats(): ErrorCaptureStats {
  const budget = getBudget(getRuntime());
  return {
    sent: budget.sent,
    budgetDropped: budget.droppedTotal,
    noiseSuppressed: { ...budget.noise },
  };
}

function budgetKeyOf(event: CapturedExceptionEvent): string {
  const message = event.message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\d+/g, "#")
    .slice(0, 120);
  return `${event.type}|${message}`;
}

function flushBudgetSummary(runtime: ErrorCaptureRuntime): void {
  const budget = getBudget(runtime);
  if (budget.summaryTimer !== null) clearTimeout(budget.summaryTimer);
  budget.summaryTimer = null;
  if (budget.dropped === 0) return;
  if (budget.summaryFlushes >= MAX_BUDGET_SUMMARIES_PER_SESSION) {
    budget.dropped = 0;
    budget.droppedBySignature.clear();
    return;
  }
  budget.summaryFlushes += 1;
  const topSignatures = [...budget.droppedBySignature]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([signature, count]) => ({ signature, count }));
  const event = buildEvent(
    runtime,
    {
      type: BUDGET_EXCEEDED_EVENT_TYPE,
      message: "Client error budget exceeded",
    },
    {
      handled: true,
      level: "warning",
      extra: {
        dropped: budget.dropped,
        sent: budget.sent,
        noiseSuppressed: { ...budget.noise },
        topSignatures,
      },
    },
  );
  budget.dropped = 0;
  budget.droppedBySignature.clear();
  try {
    runtime.config.send(event);
  } catch {
    // coercion-ok: transport must never throw into the host app
  }
}

function recordBudgetDrop(
  runtime: ErrorCaptureRuntime,
  budget: ErrorCaptureBudget,
  key: string,
): void {
  budget.droppedTotal += 1;
  // No summary will ever carry these, so do not accumulate them.
  if (budget.summaryFlushes >= MAX_BUDGET_SUMMARIES_PER_SESSION) return;
  budget.dropped += 1;
  const slot =
    budget.droppedBySignature.has(key) ||
    budget.droppedBySignature.size < MAX_TRACKED_DROPPED_SIGNATURES
      ? key
      : OTHER_DROPPED_SIGNATURES_KEY;
  budget.droppedBySignature.set(
    slot,
    (budget.droppedBySignature.get(slot) ?? 0) + 1,
  );
  if (budget.summaryTimer !== null || typeof setTimeout !== "function") return;
  budget.summaryTimer = setTimeout(
    () => flushBudgetSummary(runtime),
    runtime.config.budgetSummaryDelayMs,
  );
  (budget.summaryTimer as { unref?: () => void }).unref?.();
}

// Returns true when this event fits the session and per-signature budgets.
function consumeBudget(
  runtime: ErrorCaptureRuntime,
  event: CapturedExceptionEvent,
): boolean {
  const budget = getBudget(runtime);
  const key = budgetKeyOf(event);
  const forSignature = budget.bySignature.get(key) ?? 0;
  const sessionCap = runtime.config.maxEventsPerSession;
  const sessionFull =
    budget.sent >= sessionCap &&
    !(
      forSignature === 0 &&
      budget.sent < sessionCap * NEW_SIGNATURE_SESSION_CAP_FACTOR
    );
  if (sessionFull || forSignature >= runtime.config.maxEventsPerSignature) {
    recordBudgetDrop(runtime, budget, key);
    return false;
  }
  if (
    !budget.bySignature.has(key) &&
    budget.bySignature.size >= MAX_TRACKED_BUDGET_SIGNATURES
  ) {
    const oldest = budget.bySignature.keys().next().value;
    if (oldest !== undefined) budget.bySignature.delete(oldest);
  }
  budget.bySignature.set(key, forSignature + 1);
  budget.sent += 1;
  return true;
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
  // Messages are deliberate reports with no stack to attribute; every other
  // event, auto-captured or explicit, passes the one shared noise boundary.
  if (event.type !== "Message") {
    const verdict = classifyErrorNoise({
      surface: "browser",
      type: event.type,
      value: event.message,
      stack: event.stack,
      pageUrl: event.url,
      firstPartyHosts: firstPartyHosts(),
      tags: event.tags,
    });
    if (verdict.drop) {
      const noise = getBudget(runtime).noise;
      noise[verdict.reason] = (noise[verdict.reason] ?? 0) + 1;
      return;
    }
  }
  const signature = signatureOf(event.type, event.message, event.stack);
  if (shouldDedupe(runtime, signature)) return;
  if (!consumeBudget(runtime, event)) return;
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

// Once per page session: a chunk that stays missing re-fails on every route.
function reportStaleChunkRecoveryExhausted(
  runtime: ErrorCaptureRuntime,
  exhausted: StaleChunkRecoveryExhausted | undefined,
): void {
  if (!exhausted || runtime.staleChunkExhaustedReported) return;
  runtime.staleChunkExhaustedReported = true;
  const error = new Error(
    "A stale route chunk could not be recovered by reloading the page",
  );
  error.name = "RouteChunkRecoveryExhausted";
  captureException(error, {
    tags: {
      context: "route_chunk_recovery_exhausted",
      reason: exhausted.reason,
    },
  });
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
    // `runtime` may be a global left by an older copy of this module.
    maxEventsPerSession:
      options.maxEventsPerSession ??
      runtime.config.maxEventsPerSession ??
      DEFAULT_MAX_EVENTS_PER_SESSION,
    maxEventsPerSignature:
      options.maxEventsPerSignature ??
      runtime.config.maxEventsPerSignature ??
      DEFAULT_MAX_EVENTS_PER_SIGNATURE,
    budgetSummaryDelayMs:
      options.budgetSummaryDelayMs ??
      runtime.config.budgetSummaryDelayMs ??
      DEFAULT_BUDGET_SUMMARY_DELAY_MS,
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

  // A page that is going away is the last chance to say what was dropped.
  const onPageHide = () => flushBudgetSummary(runtime);
  window.addEventListener("pagehide", onPageHide);
  removers.push(() => window.removeEventListener("pagehide", onPageHide));

  // The raw stale-chunk failure is dropped as noise because route-chunk-recovery
  // reloads on it; this is the report for when that reload could not happen.
  const onStaleChunkExhausted = (event: Event) => {
    reportStaleChunkRecoveryExhausted(
      runtime,
      (event as CustomEvent<StaleChunkRecoveryExhausted>).detail,
    );
  };
  window.addEventListener(
    STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT,
    onStaleChunkExhausted,
  );
  removers.push(() =>
    window.removeEventListener(
      STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT,
      onStaleChunkExhausted,
    ),
  );
  reportStaleChunkRecoveryExhausted(runtime, readStaleChunkRecoveryExhausted());

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
