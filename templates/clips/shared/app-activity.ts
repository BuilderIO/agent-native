import {
  BROWSER_DIAGNOSTIC_LOOKBACK_MS,
  diagnosticKeepOrder,
  isSecretDiagnosticKey,
  redactBrowserDiagnosticString,
} from "./browser-diagnostics";

// A copy of RecorderReport from @agent-native/core/client/recorder. The
// extension reads it from the page global, so Clips never imports core's.
const RECORDER_EVENT_TYPES = [
  "action",
  "state",
  "nav",
  "error",
  "toast",
  "log",
] as const;
export type RecorderEventType = (typeof RECORDER_EVENT_TYPES)[number];

export interface RecorderEvent {
  t: number;
  at: number;
  type: RecorderEventType;
  name?: string;
  ok?: boolean;
  status?: number;
  errorCode?: string;
  ms?: number;
  requestId?: string;
  data?: Record<string, unknown>;
}

export interface RecorderPendingWork {
  type: string;
  name: string;
  ageMs: number;
}

export interface RecorderReport {
  app: string;
  build: string;
  url: string;
  at: string;
  reason: "user" | "error" | "test" | "manual";
  windowSeconds: number;
  events: RecorderEvent[];
  watched: Record<string, unknown>;
  pending: RecorderPendingWork[];
  dropped: number;
}

export const MAX_APP_ACTIVITY_EVENTS = 2_000;
export const MAX_APP_ACTIVITY_BYTES = 1_000_000;
export const MAX_APP_ACTIVITY_PENDING = 50;
export const MAX_APP_ACTIVITY_COVERAGE_WINDOWS = 4;
const MAX_SUMMARY_FAILURES = 20;
const MAX_STRING_LENGTH = 200;
const MAX_DATA_CHARS = 2_000;
const MAX_WATCHED_CHARS = 8_000;
const MAX_VALUE_DEPTH = 6;
const OMITTED = "[omitted]";

// An app event on the recording's diagnostics clock: elapsedMs is negative
// for lookback and excludes paused time, like console and network entries.
export interface AppActivityEvent {
  timestampMs: number;
  elapsedMs: number;
  type: RecorderEventType;
  name?: string;
  ok?: boolean;
  status?: number;
  errorCode?: string;
  durationMs?: number;
  requestId?: string;
  data?: Record<string, unknown>;
}

// A span the app's recorder was read for. No events outside every window
// means nothing was read there, not that nothing happened.
export interface AppActivityWindow {
  fromElapsedMs: number;
  toElapsedMs: number;
}

export interface AppActivity {
  app: string;
  build: string;
  coverage: AppActivityWindow[];
  // Events the recorder or Clips left out: evicted, malformed, or over a cap.
  dropped: number;
  events: AppActivityEvent[];
  watched: Record<string, unknown>;
  pending: RecorderPendingWork[];
}

export type AppActivityFailure = Omit<AppActivityEvent, "data">;

export interface AppActivitySummary {
  app: string;
  build: string;
  eventCount: number;
  failureCount: number;
  dropped: number;
  coverage: AppActivityWindow[];
  failures: AppActivityFailure[];
}

const utf8 = new TextEncoder();

function byteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedString(value: string): string {
  const redacted = redactBrowserDiagnosticString(value, {
    redactQueryValues: true,
  });
  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}...`
    : redacted;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? boundedString(value) : undefined;
}

// Input is parsed JSON, so only JSON value types reach here.
function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return boundedString(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_VALUE_DEPTH) return OMITTED;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[boundedString(key)] = isSecretDiagnosticKey(key)
      ? "<redacted>"
      : sanitizeValue(item, depth + 1);
  }
  return sanitized;
}

function boundedObject(
  value: Record<string, unknown>,
  maxChars: number,
): Record<string, unknown> {
  const sanitized = sanitizeValue(value, 0) as Record<string, unknown>;
  return JSON.stringify(sanitized).length > maxChars
    ? { [OMITTED]: `over ${maxChars} characters` }
    : sanitized;
}

export function isAppActivityFailure(
  event: Pick<AppActivityEvent, "type" | "ok" | "status" | "errorCode">,
): boolean {
  if (event.type === "error") return true;
  if (event.errorCode === "cancelled") return false;
  return (
    event.ok === false ||
    (typeof event.status === "number" && event.status >= 400)
  );
}

function normalizeEvent(value: unknown): AppActivityEvent | null {
  if (!isRecord(value)) return null;
  const { timestampMs, elapsedMs, type, status, durationMs } = value;
  if (
    !isFiniteNumber(timestampMs) ||
    timestampMs < 0 ||
    !isFiniteNumber(elapsedMs) ||
    elapsedMs < -BROWSER_DIAGNOSTIC_LOOKBACK_MS ||
    !RECORDER_EVENT_TYPES.includes(type as RecorderEventType)
  ) {
    return null;
  }
  const name = optionalString(value.name);
  const errorCode = optionalString(value.errorCode);
  const requestId = optionalString(value.requestId);
  return {
    timestampMs: Math.round(timestampMs),
    elapsedMs: Math.round(elapsedMs),
    type: type as RecorderEventType,
    ...(name ? { name } : {}),
    ...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
    ...(Number.isInteger(status) && (status as number) >= 0
      ? { status: status as number }
      : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(isFiniteNumber(durationMs) && durationMs >= 0
      ? { durationMs: Math.round(durationMs) }
      : {}),
    ...(requestId ? { requestId } : {}),
    ...(isRecord(value.data)
      ? { data: boundedObject(value.data, MAX_DATA_CHARS) }
      : {}),
  };
}

function normalizePendingWork(value: unknown): RecorderPendingWork | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.name !== "string" ||
    !isFiniteNumber(value.ageMs) ||
    value.ageMs < 0
  ) {
    return null;
  }
  return {
    type: boundedString(value.type),
    name: boundedString(value.name),
    ageMs: Math.round(value.ageMs),
  };
}

function capEvents(
  events: AppActivityEvent[],
  maxBytes: number,
): AppActivityEvent[] {
  const kept = new Set<number>();
  let bytes = 0;
  for (const index of diagnosticKeepOrder(events, isAppActivityFailure)) {
    if (kept.size === MAX_APP_ACTIVITY_EVENTS) break;
    bytes += byteLength(JSON.stringify(events[index])) + 1;
    if (bytes > maxBytes) break;
    kept.add(index);
  }
  return events.filter((_, index) => kept.has(index));
}

// Validates, redacts, and caps page-supplied activity. Run by the extension
// and again by the server, so it must be safe to apply twice.
export function sanitizeAppActivity(input: {
  app: string;
  build: string;
  coverage: readonly AppActivityWindow[];
  dropped: number;
  events: readonly unknown[];
  watched: Record<string, unknown>;
  pending: readonly unknown[];
}): AppActivity {
  const valid = input.events
    .map(normalizeEvent)
    .filter((event): event is AppActivityEvent => event !== null)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  const rest = {
    app: boundedString(input.app),
    build: boundedString(input.build),
    coverage: input.coverage.slice(0, MAX_APP_ACTIVITY_COVERAGE_WINDOWS),
    watched: boundedObject(input.watched, MAX_WATCHED_CHARS),
    pending: input.pending
      .map(normalizePendingWork)
      .filter((work): work is RecorderPendingWork => work !== null)
      .slice(0, MAX_APP_ACTIVITY_PENDING),
  };
  const restBytes = byteLength(
    JSON.stringify({ ...rest, dropped: Number.MAX_SAFE_INTEGER, events: [] }),
  );
  const events = capEvents(valid, MAX_APP_ACTIVITY_BYTES - restBytes);
  return {
    ...rest,
    dropped: input.dropped + input.events.length - events.length,
    events,
  };
}

export function summarizeAppActivity(
  activity: AppActivity,
): AppActivitySummary {
  const failures = activity.events.filter(isAppActivityFailure);
  return {
    app: activity.app,
    build: activity.build,
    eventCount: activity.events.length,
    failureCount: failures.length,
    dropped: activity.dropped,
    coverage: activity.coverage,
    // The earliest failures, since a cause comes before its symptoms.
    failures: failures
      .slice(0, MAX_SUMMARY_FAILURES)
      .map(({ data: _data, ...failure }) => failure),
  };
}

// Written only by save-recording-app-activity from a validated summary.
export function parseAppActivitySummary(
  json: string | null | undefined,
): AppActivitySummary | null {
  return json ? (JSON.parse(json) as AppActivitySummary) : null;
}

export function filterAppActivityEvents(
  events: readonly AppActivityEvent[],
  window: { fromMs?: number; toMs?: number; start?: number; maxEvents: number },
): {
  events: AppActivityEvent[];
  matchedCount: number;
  truncated: boolean;
  nextStart?: number;
} {
  const matched = events.filter(
    (event) =>
      (window.fromMs === undefined || event.elapsedMs >= window.fromMs) &&
      (window.toMs === undefined || event.elapsedMs <= window.toMs),
  );
  const start = window.start ?? 0;
  const page = matched.slice(start, start + window.maxEvents);
  const nextStart = start + page.length;
  const truncated = nextStart < matched.length;
  return {
    events: page,
    matchedCount: matched.length,
    truncated,
    ...(truncated ? { nextStart } : {}),
  };
}
