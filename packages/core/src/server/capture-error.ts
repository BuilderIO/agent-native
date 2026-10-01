import { isTransientDatabaseError } from "../db/client.js";
import { withFailureContext } from "../observability/failure-context.js";
import type { FailureContext } from "../shared/failure-report.js";
import { classifyError } from "./error-noise-filter.js";
import { getRequestContext } from "./request-context.js";

export interface CaptureErrorContext {
  route?: string;
  method?: string;
  userAgent?: string;
  /**
   * Whether the failure was caught by the app. Omitted, an explicit
   * `captureError()` call counts as handled; the Nitro error hook sets `false`.
   */
  handled?: boolean;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  aiTraceId?: string;
  /**
   * Identifiers the call site knows and the boundary cannot derive (an
   * automation's own thread, a run it started). Merged into
   * `extra.failureContext`; ambient run/thread ids are filled in for the rest.
   */
  failure?: Partial<FailureContext>;
}

export type CaptureErrorProvider = (
  error: unknown,
  context: CaptureErrorContext,
) => string | undefined | void;

const providers = new Map<string, CaptureErrorProvider>();

export function registerErrorCaptureProvider(
  name: string,
  provider: CaptureErrorProvider,
): () => void {
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) {
      providers.delete(name);
    }
  };
}

// One root cause can fail every request for hours (a Neon credential failure
// produced 123k events in 11h). Each failure is classified and aggregated per
// (class, route) so the tracker gets the first event immediately and one summary
// carrying the suppressed count per window. Only classes with a positively
// identified, request-independent cause are aggregated; anything else is
// captured every time.
export type ErrorFloodClass =
  | "transient-database"
  | "database-credential"
  | "configuration";

const FLOOD_WINDOW_MS: Record<ErrorFloodClass, number> = {
  "transient-database": 60_000,
  "database-credential": 60_000,
  // A missing secret does not heal on its own; one report per hour per process.
  configuration: 3_600_000,
};
// Hard bound on aggregation state, leaving room for one overflow key per class.
const MAX_FLOOD_KEYS = 200;
const MAX_ROUTE_FLOOD_KEYS =
  MAX_FLOOD_KEYS - Object.keys(FLOOD_WINDOW_MS).length;
const MAX_CAUSE_DEPTH = 4;
const MAX_BREAKDOWN_ENTRIES = 10;
const SUMMARY_BREAKDOWN_ENTRIES = 5;

const DATABASE_CREDENTIAL_RE =
  /password authentication failed|authentication failed for user|no pg_hba\.conf entry|role "[^"]+" does not exist|ensureSchemaObject: could not probe|ensureIndexExistsConcurrently: could not probe|CredentialStoreUnavailable/i;
const CONFIGURATION_ERROR_NAMES = new Set([
  "MissingAuthSecretError",
  "AppConfigurationError",
]);

interface FloodState {
  windowStartedAt: number;
  lastTouchedAt: number;
  suppressed: number;
  // What was folded away, so a summary can still tell two causes apart.
  breakdown: Map<string, number>;
  last?: { error: unknown; context: CaptureErrorContext };
  timer?: ReturnType<typeof setTimeout>;
}

const floodStates = new Map<string, FloodState>();
const stats = {
  emitted: 0,
  floodSuppressed: 0,
  floodSummaries: 0,
  noiseSuppressed: {} as Record<string, number>,
};

export interface CaptureErrorStats {
  emitted: number;
  floodSuppressed: number;
  floodSummaries: number;
  noiseSuppressed: Record<string, number>;
  activeFloodKeys: number;
}

export function getCaptureErrorStats(): CaptureErrorStats {
  return {
    emitted: stats.emitted,
    floodSuppressed: stats.floodSuppressed,
    floodSummaries: stats.floodSummaries,
    noiseSuppressed: { ...stats.noiseSuppressed },
    activeFloodKeys: floodStates.size,
  };
}

export function resetCaptureErrorStateForTests(): void {
  for (const state of floodStates.values()) clearTimeout(state.timer);
  floodStates.clear();
  stats.emitted = 0;
  stats.floodSuppressed = 0;
  stats.floodSummaries = 0;
  stats.noiseSuppressed = {};
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function classifyFloodClass(
  error: unknown,
  context: CaptureErrorContext,
): ErrorFloodClass | undefined {
  if (
    context.tags?.failureClass === "transient-database" ||
    isTransientDatabaseError(error)
  ) {
    return "transient-database";
  }
  for (const link of causeChain(error)) {
    const { name, message, code } = link as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (typeof name === "string" && CONFIGURATION_ERROR_NAMES.has(name)) {
      return "configuration";
    }
    if (
      DATABASE_CREDENTIAL_RE.test(
        `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`,
      ) ||
      code === "28P01"
    ) {
      return "database-credential";
    }
  }
  return undefined;
}

// Ids in a path would give every request its own aggregate.
function floodRouteKey(context: CaptureErrorContext): string {
  const route = context.route ?? context.tags?.source ?? "-";
  return route
    .replace(/[?#].*$/, "")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    )
    .replace(/\/\d{3,}(?=\/|$)/g, "/:id")
    .slice(0, 200);
}

function emit(
  error: unknown,
  context: CaptureErrorContext,
): string | undefined {
  stats.emitted += 1;
  let eventId: string | undefined;
  for (const provider of providers.values()) {
    try {
      const result = provider(error, context);
      if (eventId === undefined && typeof result === "string") {
        eventId = result;
      }
    } catch {
      // Observability must never mask the original failure.
    }
  }
  return eventId;
}

function errorLabel(error: unknown): string {
  const { name, message } = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
  };
  const text = typeof message === "string" ? message : String(error);
  return `${typeof name === "string" ? name : "Error"}: ${text}`.slice(0, 120);
}

function recordSuppressed(state: FloodState, error: unknown): void {
  state.suppressed += 1;
  const label = errorLabel(error);
  if (
    state.breakdown.has(label) ||
    state.breakdown.size < MAX_BREAKDOWN_ENTRIES
  ) {
    state.breakdown.set(label, (state.breakdown.get(label) ?? 0) + 1);
  } else {
    state.breakdown.set("other", (state.breakdown.get("other") ?? 0) + 1);
  }
}

function takeSummary(
  state: FloodState,
  windowMs: number,
): FloodSummary | undefined {
  const { suppressed, windowStartedAt } = state;
  const breakdown = [...state.breakdown]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUMMARY_BREAKDOWN_ENTRIES)
    .map(([error, count]) => ({ error, count }));
  state.suppressed = 0;
  state.breakdown.clear();
  state.last = undefined;
  clearTimeout(state.timer);
  state.timer = undefined;
  return suppressed === 0
    ? undefined
    : { suppressed, windowMs, windowStartedAt, breakdown };
}

interface FloodSummary {
  suppressed: number;
  windowMs: number;
  windowStartedAt: number;
  breakdown: Array<{ error: string; count: number }>;
}

function classifiedContext(
  cls: ErrorFloodClass,
  context: CaptureErrorContext,
  summary?: FloodSummary,
): CaptureErrorContext {
  return {
    ...context,
    tags: {
      ...context.tags,
      failureClass: context.tags?.failureClass ?? cls,
      ...(summary ? { aggregated: "true" } : {}),
    },
    ...(summary
      ? {
          extra: {
            ...context.extra,
            suppressedCount: summary.suppressed,
            suppressedBreakdown: summary.breakdown,
            aggregationWindowMs: summary.windowMs,
            aggregationWindowStartedAt: new Date(
              summary.windowStartedAt,
            ).toISOString(),
          },
        }
      : {}),
  };
}

function flushFloodWindow(
  cls: ErrorFloodClass,
  state: FloodState,
  now: number,
): void {
  const last = state.last;
  const summary = takeSummary(state, FLOOD_WINDOW_MS[cls]);
  state.windowStartedAt = now;
  state.lastTouchedAt = now;
  if (!summary || !last) return;
  stats.floodSummaries += 1;
  emit(last.error, classifiedContext(cls, last.context, summary));
}

function evictIdleFloodStates(now: number): void {
  for (const [key, state] of floodStates) {
    const cls = key.slice(0, key.indexOf("|")) as ErrorFloodClass;
    const idleFor = now - state.lastTouchedAt;
    if (state.suppressed === 0 && idleFor > 2 * FLOOD_WINDOW_MS[cls]) {
      clearTimeout(state.timer);
      floodStates.delete(key);
    }
  }
}

// Returns the context to emit, or undefined when this occurrence was folded into
// the window's suppressed count.
function admitFloodEvent(
  cls: ErrorFloodClass,
  error: unknown,
  context: CaptureErrorContext,
): CaptureErrorContext | undefined {
  const now = Date.now();
  let key = `${cls}|${floodRouteKey(context)}`;
  if (!floodStates.has(key) && floodStates.size >= MAX_ROUTE_FLOOD_KEYS) {
    evictIdleFloodStates(now);
    // Still full: a many-route incident shares one aggregate per class.
    if (floodStates.size >= MAX_ROUTE_FLOOD_KEYS) key = `${cls}|*`;
  }
  const windowMs = FLOOD_WINDOW_MS[cls];
  const state = floodStates.get(key);
  if (!state) {
    floodStates.set(key, {
      windowStartedAt: now,
      lastTouchedAt: now,
      suppressed: 0,
      breakdown: new Map(),
    });
    return classifiedContext(cls, context);
  }
  state.lastTouchedAt = now;
  if (now - state.windowStartedAt >= windowMs) {
    const summary = takeSummary(state, windowMs);
    state.windowStartedAt = now;
    if (!summary) return classifiedContext(cls, context);
    stats.floodSummaries += 1;
    return classifiedContext(cls, context, summary);
  }
  recordSuppressed(state, error);
  state.last = { error, context };
  stats.floodSuppressed += 1;
  if (state.timer === undefined && typeof setTimeout === "function") {
    state.timer = setTimeout(
      () => flushFloodWindow(cls, state, Date.now()),
      Math.max(0, state.windowStartedAt + windowMs - now),
    );
    (state.timer as { unref?: () => void }).unref?.();
  }
  return undefined;
}

function deriveErrorCode(error: unknown): string | undefined {
  const code = (error as { errorCode?: unknown } | null | undefined)?.errorCode;
  return typeof code === "string" && code.length > 0 && code.length <= 100
    ? code
    : undefined;
}

// Every emitted report names its app, build, run and thread (`failureContext`).
// A packet that cannot be built says so instead of vanishing, so a report with
// no thread link is distinguishable from one that never had a thread.
function withPacket(
  context: CaptureErrorContext,
  hints: { errorCode?: string; failureClass?: string },
): CaptureErrorContext {
  try {
    return withFailureContext(context, hints);
  } catch (packetError) {
    const rest = { ...context };
    delete rest.failure;
    return {
      ...rest,
      extra: {
        ...rest.extra,
        failureContextError:
          packetError instanceof Error
            ? packetError.message.slice(0, 200)
            : "unreadable",
      },
    };
  }
}

export function captureError(
  error: unknown,
  context: CaptureErrorContext = {},
): string | undefined {
  if (getRequestContext()?.isSyntheticTraffic) return undefined;

  let outgoing = context;
  try {
    const verdict = classifyError(error, { tags: context.tags });
    if (verdict.drop) {
      stats.noiseSuppressed[verdict.reason] =
        (stats.noiseSuppressed[verdict.reason] ?? 0) + 1;
      return undefined;
    }
    const errorCode = deriveErrorCode(error);
    if (errorCode && context.tags?.errorCode === undefined) {
      outgoing = { ...context, tags: { ...context.tags, errorCode } };
    }
    const cls = classifyFloodClass(error, outgoing);
    outgoing = withPacket(outgoing, { errorCode, failureClass: cls });
    if (cls) {
      const admitted = admitFloodEvent(cls, error, outgoing);
      if (!admitted) return undefined;
      outgoing = admitted;
    }
    // coercion-ok: an error we could not classify is captured as-is, never dropped.
  } catch {
    outgoing = context;
  }
  return emit(error, outgoing);
}

export const captureServerError = captureError;
