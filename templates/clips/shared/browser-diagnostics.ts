export const MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS = 400;
export const MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS = 400;
export const MAX_BROWSER_DIAGNOSTIC_INTERACTION_EVENTS = 800;
export const MAX_BROWSER_DIAGNOSTIC_TIMELINE_EVENTS =
  MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS +
  MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS * 2 +
  MAX_BROWSER_DIAGNOSTIC_INTERACTION_EVENTS;
export const MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH = 2_000;
export const MAX_BROWSER_DIAGNOSTIC_TARGET_LENGTH = 200;
export const MAX_BROWSER_DIAGNOSTIC_URL_LENGTH = 1_000;

const SECRET_KEY_FRAGMENT =
  "(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|session|credential)";
const AUTHORIZATION_SCHEME_RE =
  /\b(authorization)\b(\s*[:=]\s*)(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const DOUBLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);
const SINGLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)'(?:[^'\\\\]|\\\\.)*'`,
  "gi",
);
const UNQUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)([^"',\\s;}\\]]+)`,
  "gi",
);

export interface RedactBrowserDiagnosticStringOptions {
  redactQueryValues?: boolean;
}

export function redactBrowserDiagnosticString(
  value: string,
  options: RedactBrowserDiagnosticStringOptions = {},
): string {
  const redacted = value
    .replace(AUTHORIZATION_SCHEME_RE, "$1$2<redacted>")
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi, "$1 <redacted>")
    .replace(DOUBLE_QUOTED_SECRET_VALUE_RE, '$1$2$1$3"<redacted>"')
    .replace(SINGLE_QUOTED_SECRET_VALUE_RE, "$1$2$1$3'<redacted>'")
    .replace(UNQUOTED_SECRET_VALUE_RE, "$1$2$1$3<redacted>");
  return options.redactQueryValues
    ? redacted.replace(/([?&][^=\s&?#]+)=([^&\s#]+)/g, "$1=<redacted>")
    : redacted;
}

export function sanitizeBrowserDiagnosticNavigationUrl(raw: string): string {
  const redacted = redactBrowserDiagnosticString(raw, {
    redactQueryValues: true,
  });
  try {
    const parsed = new URL(redacted, "https://clips.local");
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const params = new URLSearchParams();
    for (const key of parsed.searchParams.keys()) {
      params.set(key, "<redacted>");
    }
    parsed.search = params.toString();
    return `${parsed.pathname}${parsed.search}`.slice(
      0,
      MAX_BROWSER_DIAGNOSTIC_URL_LENGTH,
    );
  } catch {
    return "<redacted>";
  }
}

export type BrowserDiagnosticConsoleLevel =
  | "debug"
  | "log"
  | "info"
  | "warn"
  | "error";

export interface BrowserDiagnosticConsoleLog {
  timestampMs: number;
  elapsedMs: number;
  level: BrowserDiagnosticConsoleLevel;
  message: string;
  stack?: string;
}

export interface BrowserDiagnosticNetworkRequest {
  timestampMs: number;
  elapsedMs: number;
  type: "fetch" | "xhr";
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs: number;
  error?: string;
}

export type BrowserDiagnosticInteractionKind =
  | "navigation"
  | "click"
  | "input"
  | "scroll";

export interface BrowserDiagnosticInteractionEvent {
  timestampMs: number;
  elapsedMs: number;
  kind: BrowserDiagnosticInteractionKind;
  target?: string;
  url?: string;
}

type BrowserDiagnosticTimelineBase = Pick<
  BrowserDiagnosticInteractionEvent,
  "timestampMs" | "elapsedMs"
>;

export type BrowserDiagnosticTimelineEvent =
  | (BrowserDiagnosticTimelineBase & {
      kind: BrowserDiagnosticInteractionKind;
      target?: string;
      url?: string;
    })
  | (BrowserDiagnosticTimelineBase & {
      kind: "console";
      level: BrowserDiagnosticConsoleLevel;
      message: string;
      stack?: string;
    })
  | (BrowserDiagnosticTimelineBase & {
      kind: "network";
      phase: "request" | "response";
      type: BrowserDiagnosticNetworkRequest["type"];
      method: string;
      url: string;
      status?: number;
      statusText?: string;
      ok?: boolean;
      durationMs?: number;
      error?: string;
    });

export interface BrowserDiagnosticsSnapshot {
  pageUrl: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt: string;
  consoleLogs: BrowserDiagnosticConsoleLog[];
  networkRequests: BrowserDiagnosticNetworkRequest[];
  interactionEvents?: BrowserDiagnosticInteractionEvent[];
}

export interface BrowserDiagnosticsSummary {
  consoleCount: number;
  consoleErrorCount: number;
  consoleWarnCount: number;
  networkCount: number;
  networkFailureCount: number;
  capturedAt: string | null;
}

export interface BrowserDiagnosticsData extends BrowserDiagnosticsSnapshot {
  summary: BrowserDiagnosticsSummary;
  timeline?: BrowserDiagnosticTimelineEvent[];
}

function safeArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function normalizeBrowserDiagnosticConsoleLog(
  value: unknown,
): BrowserDiagnosticConsoleLog | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const timestampMs = safeNumber(entry.timestampMs);
  const elapsedMs = safeNumber(entry.elapsedMs);
  const message = safeString(
    entry.message,
    MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
  );
  if (timestampMs === null || elapsedMs === null || message === null) {
    return null;
  }
  const level =
    entry.level === "debug" ||
    entry.level === "info" ||
    entry.level === "warn" ||
    entry.level === "error"
      ? entry.level
      : "log";
  const stack = safeString(entry.stack, MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH);
  return {
    timestampMs,
    elapsedMs,
    level,
    message,
    ...(stack ? { stack } : {}),
  };
}

export function normalizeBrowserDiagnosticNetworkRequest(
  value: unknown,
): BrowserDiagnosticNetworkRequest | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const timestampMs = safeNumber(entry.timestampMs);
  const elapsedMs = safeNumber(entry.elapsedMs);
  const durationMs = safeNumber(entry.durationMs);
  const url = safeString(entry.url, MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  if (
    timestampMs === null ||
    elapsedMs === null ||
    durationMs === null ||
    url === null
  ) {
    return null;
  }
  const type = entry.type === "xhr" ? "xhr" : "fetch";
  const method = safeString(entry.method, 24) ?? "GET";
  const status = safeNumber(entry.status);
  const statusText = safeString(entry.statusText, 120);
  const error = safeString(entry.error, MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH);
  return {
    timestampMs,
    elapsedMs,
    type,
    method,
    url,
    ...(status !== null ? { status } : {}),
    ...(statusText ? { statusText } : {}),
    ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
    durationMs,
    ...(error ? { error } : {}),
  };
}

export function normalizeBrowserDiagnosticInteractionEvent(
  value: unknown,
): BrowserDiagnosticInteractionEvent | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const timestampMs = safeNumber(entry.timestampMs);
  const elapsedMs = safeNumber(entry.elapsedMs);
  const kind =
    entry.kind === "navigation" ||
    entry.kind === "click" ||
    entry.kind === "input" ||
    entry.kind === "scroll"
      ? entry.kind
      : null;
  if (timestampMs === null || elapsedMs === null || !kind) return null;
  const target = safeString(entry.target, MAX_BROWSER_DIAGNOSTIC_TARGET_LENGTH);
  const rawUrl = safeString(entry.url, MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  const url = rawUrl ? sanitizeBrowserDiagnosticNavigationUrl(rawUrl) : null;
  return {
    timestampMs,
    elapsedMs,
    kind,
    ...(target ? { target } : {}),
    ...(url ? { url } : {}),
  };
}

export function buildBrowserDiagnosticTimeline({
  consoleLogs,
  networkRequests,
  interactionEvents = [],
}: Pick<
  BrowserDiagnosticsSnapshot,
  "consoleLogs" | "networkRequests" | "interactionEvents"
>): BrowserDiagnosticTimelineEvent[] {
  const entries: Array<{
    event: BrowserDiagnosticTimelineEvent;
    order: number;
  }> = [];
  let order = 0;
  const add = (event: BrowserDiagnosticTimelineEvent) => {
    entries.push({ event, order: order++ });
  };

  for (const event of interactionEvents) add(event);
  for (const entry of consoleLogs) {
    add({
      timestampMs: entry.timestampMs,
      elapsedMs: entry.elapsedMs,
      kind: "console",
      level: entry.level,
      message: entry.message,
      ...(entry.stack ? { stack: entry.stack } : {}),
    });
  }
  for (const entry of networkRequests) {
    add({
      timestampMs: entry.timestampMs,
      elapsedMs: entry.elapsedMs,
      kind: "network",
      phase: "request",
      type: entry.type,
      method: entry.method,
      url: entry.url,
    });
    add({
      timestampMs: entry.timestampMs + entry.durationMs,
      elapsedMs: entry.elapsedMs + entry.durationMs,
      kind: "network",
      phase: "response",
      type: entry.type,
      method: entry.method,
      url: entry.url,
      ...(typeof entry.status === "number" ? { status: entry.status } : {}),
      ...(entry.statusText ? { statusText: entry.statusText } : {}),
      ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
      durationMs: entry.durationMs,
      ...(entry.error ? { error: entry.error } : {}),
    });
  }

  return entries
    .sort((a, b) => a.event.elapsedMs - b.event.elapsedMs || a.order - b.order)
    .slice(0, MAX_BROWSER_DIAGNOSTIC_TIMELINE_EVENTS)
    .map(({ event }) => event);
}

export function summarizeBrowserDiagnostics(
  snapshot: Pick<
    BrowserDiagnosticsSnapshot,
    "consoleLogs" | "networkRequests" | "endedAt"
  >,
): BrowserDiagnosticsSummary {
  return {
    consoleCount: snapshot.consoleLogs.length,
    consoleErrorCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "error",
    ).length,
    consoleWarnCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "warn",
    ).length,
    networkCount: snapshot.networkRequests.length,
    networkFailureCount: snapshot.networkRequests.filter(
      (entry) =>
        Boolean(entry.error) ||
        (typeof entry.status === "number" && entry.status >= 400),
    ).length,
    capturedAt: snapshot.endedAt || null,
  };
}

export function parseBrowserDiagnosticsRow(
  row:
    | {
        pageUrl?: string | null;
        userAgent?: string | null;
        startedAt?: string | null;
        endedAt?: string | null;
        consoleLogsJson?: string | null;
        networkRequestsJson?: string | null;
        interactionEventsJson?: string | null;
      }
    | null
    | undefined,
): BrowserDiagnosticsData | null {
  if (!row) return null;
  const consoleLogs = safeArray(row.consoleLogsJson)
    .map(normalizeBrowserDiagnosticConsoleLog)
    .filter((entry): entry is BrowserDiagnosticConsoleLog => Boolean(entry))
    .slice(0, MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS);
  const networkRequests = safeArray(row.networkRequestsJson)
    .map(normalizeBrowserDiagnosticNetworkRequest)
    .filter((entry): entry is BrowserDiagnosticNetworkRequest => Boolean(entry))
    .slice(0, MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS);
  const interactionEvents = safeArray(row.interactionEventsJson)
    .map(normalizeBrowserDiagnosticInteractionEvent)
    .filter((entry): entry is BrowserDiagnosticInteractionEvent =>
      Boolean(entry),
    )
    .slice(0, MAX_BROWSER_DIAGNOSTIC_INTERACTION_EVENTS);
  const snapshot: BrowserDiagnosticsSnapshot = {
    pageUrl: row.pageUrl ?? null,
    userAgent: row.userAgent ?? null,
    startedAt: row.startedAt ?? "",
    endedAt: row.endedAt ?? "",
    consoleLogs,
    networkRequests,
    interactionEvents,
  };
  return {
    ...snapshot,
    summary: summarizeBrowserDiagnostics(snapshot),
    timeline: buildBrowserDiagnosticTimeline(snapshot),
  };
}
