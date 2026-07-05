import {
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
  getRequestContext,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";

import {
  SESSION_REPLAY_AGENT_ACCESS_PARAM,
  SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX,
} from "../../shared/session-replay-agent-access.js";
import {
  isFailedSessionReplayNetworkStatus,
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
  type SessionReplayConsoleDiagnosticsEntry,
  type SessionReplayConsoleLevel,
  type SessionReplayConsoleSource,
  type SessionReplayDiagnostics,
  type SessionReplayNetworkDiagnosticsEntry,
} from "../../shared/session-replay-diagnostics.js";
import {
  compactSessionRecordingSummary,
  getSessionReplaySummary,
  getSessionReplayTokenizedEvents,
  getSessionReplayTokenizedSummary,
  type ReplayScope,
} from "./session-replay.js";

export { SESSION_REPLAY_AGENT_ACCESS_PARAM };
export const SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS = 2 * 60 * 60;

type AgentReplayEvent = Record<string, any>;

const RRWEB_EVENT_TYPE = {
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const;

const INCREMENTAL_SOURCE = {
  MouseInteraction: 2,
  Scroll: 3,
  Input: 5,
} as const;

const MOUSE_INTERACTION = {
  Click: 2,
  DblClick: 4,
  Focus: 5,
} as const;

function appBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}` : "";
}

function appOrigin(explicitOrigin?: string): string {
  const fromContext = getRequestContext()?.requestOrigin;
  const origin =
    explicitOrigin ||
    fromContext ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(origin).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function replayStartedAt(events: AgentReplayEvent[]): number {
  const first = events.find((event) =>
    Number.isFinite(Number(event.timestamp)),
  );
  return Number(first?.timestamp ?? 0) || 0;
}

function pathLabel(href: string): string {
  try {
    const parsed = new URL(href);
    return parsed.pathname || parsed.hostname;
  } catch {
    return href;
  }
}

function markerDetail(event: AgentReplayEvent): string | null {
  const payload = event.data?.payload;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof event.data?.href === "string") return event.data.href;
  return null;
}

const TIMELINE_MARKER_CAP = 200;
const TIMELINE_ERROR_MARKER_RESERVE = 100;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 1_000;
const MAX_DIAGNOSTIC_STACK_CHARS = 2_000;
const MAX_DIAGNOSTIC_URL_CHARS = 500;
const MAX_DIAGNOSTIC_ARG_CHARS = 500;
const MAX_DIAGNOSTIC_ARGS = 10;
/** Defensive server-side cap for a captured 5xx response-body snippet. */
const MAX_DIAGNOSTIC_ERROR_BODY_CHARS = 2_048;
const DEFAULT_DIAGNOSTIC_ENTRY_CAP = 200;
const AGENT_CONTEXT_DIAGNOSTIC_ENTRY_CAP = 50;

type ReplayTimelineMarker = {
  offsetMs: number;
  timestamp: number;
  kind:
    | "navigation"
    | "input"
    | "click"
    | "scroll"
    | "custom"
    | "console-error"
    | "network-error";
  label: string;
  detail: string | null;
};

/** Defensive server-side truncation; never trust client-side caps. */
function boundedDiagnosticText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

const CONSOLE_LEVELS: ReadonlySet<string> = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
]);
const CONSOLE_SOURCES: ReadonlySet<string> = new Set([
  "console",
  "window-error",
  "unhandledrejection",
]);

function diagnosticsEventTag(
  event: AgentReplayEvent,
): { tag: string; payload: Record<string, any>; timestamp: number } | null {
  if (event.type !== RRWEB_EVENT_TYPE.Custom) return null;
  const tag = event.data?.tag;
  if (
    tag !== SESSION_REPLAY_CONSOLE_EVENT_TAG &&
    tag !== SESSION_REPLAY_NETWORK_EVENT_TAG
  ) {
    return null;
  }
  const timestamp = Number(event.timestamp ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const payload = event.data?.payload;
  if (!payload || typeof payload !== "object") return null;
  return { tag, payload, timestamp };
}

function consoleLevel(value: unknown): SessionReplayConsoleLevel {
  return CONSOLE_LEVELS.has(String(value))
    ? (value as SessionReplayConsoleLevel)
    : "log";
}

function consoleSource(value: unknown): SessionReplayConsoleSource {
  return CONSOLE_SOURCES.has(String(value))
    ? (value as SessionReplayConsoleSource)
    : "console";
}

function consoleRepeat(value: unknown): number {
  const repeat = Number(value);
  return Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
}

function networkStatus(value: unknown): number {
  const status = Number(value);
  return Number.isFinite(status) && status >= 0 ? Math.floor(status) : 0;
}

function consoleDiagnosticsEntry(
  payload: Record<string, any>,
  timestamp: number,
  startedAt: number,
): SessionReplayConsoleDiagnosticsEntry {
  const args = Array.isArray(payload.args)
    ? payload.args
        .slice(0, MAX_DIAGNOSTIC_ARGS)
        .map((arg: unknown) =>
          boundedDiagnosticText(
            typeof arg === "string" ? arg : (JSON.stringify(arg) ?? ""),
            MAX_DIAGNOSTIC_ARG_CHARS,
          ),
        )
    : undefined;
  return {
    offsetMs: Math.max(0, timestamp - startedAt),
    timestamp,
    level: consoleLevel(payload.level),
    source: consoleSource(payload.source),
    message: boundedDiagnosticText(
      payload.message,
      MAX_DIAGNOSTIC_MESSAGE_CHARS,
    ),
    ...(args && args.length ? { args } : {}),
    ...(typeof payload.stack === "string"
      ? {
          stack: boundedDiagnosticText(
            payload.stack,
            MAX_DIAGNOSTIC_STACK_CHARS,
          ),
        }
      : {}),
    ...(typeof payload.url === "string"
      ? { url: boundedDiagnosticText(payload.url, MAX_DIAGNOSTIC_URL_CHARS) }
      : {}),
    ...(payload.repeat !== undefined
      ? { repeat: consoleRepeat(payload.repeat) }
      : {}),
  };
}

function networkDiagnosticsEntry(
  payload: Record<string, any>,
  timestamp: number,
  startedAt: number,
): SessionReplayNetworkDiagnosticsEntry {
  const status = networkStatus(payload.status);
  return {
    offsetMs: Math.max(0, timestamp - startedAt),
    timestamp,
    api: payload.api === "xhr" ? "xhr" : "fetch",
    method: boundedDiagnosticText(payload.method, 16) || "GET",
    url: boundedDiagnosticText(payload.url, MAX_DIAGNOSTIC_URL_CHARS),
    status,
    ok: payload.ok === true,
    durationMs: Math.max(0, Number(payload.durationMs) || 0),
    ...(typeof payload.error === "string"
      ? {
          error: boundedDiagnosticText(
            payload.error,
            MAX_DIAGNOSTIC_MESSAGE_CHARS,
          ),
        }
      : {}),
    ...(typeof payload.responseBody === "string"
      ? {
          responseBody: boundedDiagnosticText(
            payload.responseBody,
            MAX_DIAGNOSTIC_ERROR_BODY_CHARS,
          ),
        }
      : {}),
  };
}

/**
 * Keep priority entries (errors/failures) even when the total exceeds the
 * cap: take up to the full cap from the priority set first, fill remaining
 * space chronologically from the rest, then restore chronological order.
 */
function boundDiagnosticsEntries<T extends { offsetMs: number }>(
  entries: T[],
  isPriority: (entry: T) => boolean,
  cap: number,
): { entries: T[]; truncated: boolean; hasMore: boolean } {
  const sorted = [...entries].sort((a, b) => a.offsetMs - b.offsetMs);
  if (sorted.length <= cap) {
    return { entries: sorted, truncated: false, hasMore: false };
  }
  const kept = new Set<T>();
  for (const entry of sorted) {
    if (kept.size >= cap) break;
    if (isPriority(entry)) kept.add(entry);
  }
  for (const entry of sorted) {
    if (kept.size >= cap) break;
    kept.add(entry);
  }
  return {
    entries: [...kept].sort((a, b) => a.offsetMs - b.offsetMs),
    truncated: true,
    hasMore: true,
  };
}

/**
 * Strictly chronological pagination: entries are assumed to already reflect
 * the fromMs/toMs + level filtered population (that population defines the
 * totals agents page against). Sort chronologically, then skip `offset`
 * entries and take up to `cap`. No priority reshuffle — stable across pages.
 */
function paginateDiagnosticsEntries<T extends { offsetMs: number }>(
  entries: T[],
  offset: number,
  cap: number,
): { entries: T[]; truncated: boolean; hasMore: boolean } {
  const sorted = [...entries].sort((a, b) => a.offsetMs - b.offsetMs);
  const page = sorted.slice(offset, offset + cap);
  const hasMore = offset + page.length < sorted.length;
  return {
    entries: page,
    truncated: hasMore,
    hasMore,
  };
}

export interface SessionReplayDiagnosticsOptions {
  /** Max console entries returned (default 200). */
  maxConsoleEntries?: number;
  /** Max network entries returned (default 200). */
  maxNetworkEntries?: number;
  /** Only include console entries with this level. */
  consoleLevel?: SessionReplayConsoleLevel;
  /**
   * Skip this many entries (per kind) before taking the page. Providing
   * offset, fromMs, or toMs switches selection/ordering to strictly
   * chronological pagination (no errors-first reshuffle) for stable paging.
   */
  offset?: number;
  /** Inclusive lower bound on offsetMs, applied before counting/slicing. */
  fromMs?: number;
  /** Inclusive upper bound on offsetMs, applied before counting/slicing. */
  toMs?: number;
}

export function buildSessionReplayDiagnostics(
  events: AgentReplayEvent[],
  options: SessionReplayDiagnosticsOptions = {},
): SessionReplayDiagnostics {
  const startedAt = replayStartedAt(events);
  const maxConsole = Math.max(
    0,
    options.maxConsoleEntries ?? DEFAULT_DIAGNOSTIC_ENTRY_CAP,
  );
  const maxNetwork = Math.max(
    0,
    options.maxNetworkEntries ?? DEFAULT_DIAGNOSTIC_ENTRY_CAP,
  );
  const isPaginated =
    options.offset !== undefined ||
    options.fromMs !== undefined ||
    options.toMs !== undefined;
  const offset = Math.max(0, options.offset ?? 0);
  const window = { fromMs: options.fromMs, toMs: options.toMs };

  const consoleEntries: SessionReplayConsoleDiagnosticsEntry[] = [];
  const networkEntries: SessionReplayNetworkDiagnosticsEntry[] = [];
  let consoleTotal = 0;
  let consoleErrors = 0;
  let consoleWarns = 0;
  let networkTotal = 0;
  let networkFailed = 0;

  for (const event of events) {
    const tagged = diagnosticsEventTag(event);
    if (!tagged) continue;
    if (tagged.tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
      const entry = consoleDiagnosticsEntry(
        tagged.payload,
        tagged.timestamp,
        startedAt,
      );
      if (isPaginated) {
        // Paginated mode: totals reflect the fromMs/toMs + level filtered
        // population, since that's the denominator agents page against.
        if (window.fromMs !== undefined && entry.offsetMs < window.fromMs) {
          continue;
        }
        if (window.toMs !== undefined && entry.offsetMs > window.toMs) {
          continue;
        }
        if (options.consoleLevel && entry.level !== options.consoleLevel) {
          continue;
        }
        const repeat = entry.repeat ?? 1;
        consoleTotal += repeat;
        if (entry.level === "error") consoleErrors += repeat;
        if (entry.level === "warn") consoleWarns += repeat;
        consoleEntries.push(entry);
      } else {
        // Default mode: totals always reflect the full unfiltered
        // population; consoleLevel only gates which entries are returned.
        const repeat = entry.repeat ?? 1;
        consoleTotal += repeat;
        if (entry.level === "error") consoleErrors += repeat;
        if (entry.level === "warn") consoleWarns += repeat;
        if (!options.consoleLevel || entry.level === options.consoleLevel) {
          consoleEntries.push(entry);
        }
      }
    } else {
      const entry = networkDiagnosticsEntry(
        tagged.payload,
        tagged.timestamp,
        startedAt,
      );
      if (isPaginated) {
        if (window.fromMs !== undefined && entry.offsetMs < window.fromMs) {
          continue;
        }
        if (window.toMs !== undefined && entry.offsetMs > window.toMs) {
          continue;
        }
      }
      networkTotal += 1;
      if (isFailedSessionReplayNetworkStatus(entry.status)) networkFailed += 1;
      networkEntries.push(entry);
    }
  }

  if (isPaginated) {
    const pagedConsole = paginateDiagnosticsEntries(
      consoleEntries,
      offset,
      maxConsole,
    );
    const pagedNetwork = paginateDiagnosticsEntries(
      networkEntries,
      offset,
      maxNetwork,
    );
    return {
      console: {
        total: consoleTotal,
        errorCount: consoleErrors,
        warnCount: consoleWarns,
        entries: pagedConsole.entries,
        truncated: pagedConsole.truncated,
        hasMore: pagedConsole.hasMore,
      },
      network: {
        total: networkTotal,
        failedCount: networkFailed,
        entries: pagedNetwork.entries,
        truncated: pagedNetwork.truncated,
        hasMore: pagedNetwork.hasMore,
      },
    };
  }

  const boundedConsole = boundDiagnosticsEntries(
    consoleEntries,
    (entry) => entry.level === "error" || entry.level === "warn",
    maxConsole,
  );
  const boundedNetwork = boundDiagnosticsEntries(
    networkEntries,
    (entry) => isFailedSessionReplayNetworkStatus(entry.status),
    maxNetwork,
  );

  return {
    console: {
      total: consoleTotal,
      errorCount: consoleErrors,
      warnCount: consoleWarns,
      entries: boundedConsole.entries,
      truncated: boundedConsole.truncated,
      hasMore: boundedConsole.hasMore,
    },
    network: {
      total: networkTotal,
      failedCount: networkFailed,
      entries: boundedNetwork.entries,
      truncated: boundedNetwork.truncated,
      hasMore: boundedNetwork.hasMore,
    },
  };
}

/**
 * Cap timeline markers while keeping error markers preferentially: reserve up
 * to TIMELINE_ERROR_MARKER_RESERVE slots for console/network error markers,
 * fill the rest chronologically, then restore chronological order.
 */
function capReplayTimelineMarkers(
  markers: ReplayTimelineMarker[],
): ReplayTimelineMarker[] {
  const sorted = [...markers].sort((a, b) => a.offsetMs - b.offsetMs);
  if (sorted.length <= TIMELINE_MARKER_CAP) return sorted;
  const isError = (marker: ReplayTimelineMarker) =>
    marker.kind === "console-error" || marker.kind === "network-error";
  const kept = new Set<ReplayTimelineMarker>();
  for (const marker of sorted) {
    if (kept.size >= TIMELINE_ERROR_MARKER_RESERVE) break;
    if (isError(marker)) kept.add(marker);
  }
  for (const marker of sorted) {
    if (kept.size >= TIMELINE_MARKER_CAP) break;
    kept.add(marker);
  }
  return [...kept].sort((a, b) => a.offsetMs - b.offsetMs);
}

function buildReplayTimeline(events: AgentReplayEvent[]) {
  const startedAt = replayStartedAt(events);
  const markers: ReplayTimelineMarker[] = [];

  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;

    const tagged = diagnosticsEventTag(event);
    if (tagged) {
      // Only error-level console events and failed requests become markers;
      // routine logs/requests would flood the marker cap.
      if (tagged.tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
        if (consoleLevel(tagged.payload.level) === "error") {
          markers.push({
            timestamp,
            offsetMs: Math.max(0, timestamp - startedAt),
            kind: "console-error",
            label: "Console error",
            detail: boundedDiagnosticText(
              tagged.payload.message,
              MAX_DIAGNOSTIC_MESSAGE_CHARS,
            ),
          });
        }
      } else {
        const status = networkStatus(tagged.payload.status);
        if (isFailedSessionReplayNetworkStatus(status)) {
          const method =
            boundedDiagnosticText(tagged.payload.method, 16) || "GET";
          const url = boundedDiagnosticText(
            tagged.payload.url,
            MAX_DIAGNOSTIC_URL_CHARS,
          );
          markers.push({
            timestamp,
            offsetMs: Math.max(0, timestamp - startedAt),
            kind: "network-error",
            label: "Network error",
            detail: `${method} ${url} → ${status}`,
          });
        }
      }
      continue;
    }

    if (
      event.type === RRWEB_EVENT_TYPE.Meta &&
      typeof event.data?.href === "string"
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "navigation",
        label: pathLabel(event.data.href),
        detail: event.data.href,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Input
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "input",
        label: "Input",
        detail: null,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Scroll
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "scroll",
        label: "Scroll",
        detail: null,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.MouseInteraction &&
      (event.data?.type === MOUSE_INTERACTION.Click ||
        event.data?.type === MOUSE_INTERACTION.DblClick ||
        event.data?.type === MOUSE_INTERACTION.Focus)
    ) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "click",
        label: event.data.type === MOUSE_INTERACTION.Focus ? "Focus" : "Click",
        detail: null,
      });
    } else if (event.type === RRWEB_EVENT_TYPE.Custom) {
      markers.push({
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "custom",
        label: String(event.data?.tag ?? "Custom event"),
        detail: markerDetail(event),
      });
    }
  }

  return capReplayTimelineMarkers(markers);
}

export function verifySessionReplayAgentAccess(
  recordingId: string,
  token: string,
): boolean {
  return verifyScopedAgentAccessToken(token, {
    resourceKind: SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX,
    resourceId: recordingId,
  }).ok;
}

export async function createSessionReplayAgentLink({
  recordingId,
  scope,
  origin,
}: {
  recordingId: string;
  scope: ReplayScope;
  origin?: string;
}) {
  const recording = await getSessionReplaySummary(recordingId, scope);
  const grant = createScopedAgentAccessGrant({
    resourceKind: SESSION_REPLAY_AGENT_ACCESS_TOKEN_PREFIX,
    resourceId: recording.id,
    viewerEmail: scope.userEmail,
    ttlSeconds: SESSION_REPLAY_AGENT_ACCESS_TTL_SECONDS,
  });
  const resolvedOrigin = appOrigin(origin);
  const basePath = appBasePath();

  return {
    recordingId: recording.id,
    url: buildAgentAccessUrl({
      path: `/sessions/${encodeURIComponent(recording.id)}`,
      origin: resolvedOrigin,
      basePath,
      token: grant.token,
    }),
    contextUrl: buildAgentAccessApiUrl({
      endpoint: "/api/session-replay/agent-context.json",
      resourceId: recording.id,
      origin: resolvedOrigin,
      basePath,
      token: grant.token,
    }),
    expiresAt: grant.expiresAt,
    ttlSeconds: grant.ttlSeconds,
  };
}

export async function buildSessionReplayAgentContext({
  recordingId,
  token,
  origin,
  includeTimeline = true,
}: {
  recordingId: string;
  token: string;
  origin?: string;
  includeTimeline?: boolean;
}) {
  if (!verifySessionReplayAgentAccess(recordingId, token)) {
    const error = Object.assign(new Error("Invalid or expired agent access"), {
      statusCode: 401,
    });
    throw error;
  }

  const recording = await getSessionReplayTokenizedSummary(recordingId);
  const resolvedOrigin = appOrigin(origin);
  const basePath = appBasePath();
  const contextUrl = buildAgentAccessApiUrl({
    endpoint: "/api/session-replay/agent-context.json",
    resourceId: recording.id,
    origin: resolvedOrigin,
    basePath,
    token,
  });
  const eventsUrl = buildAgentAccessApiUrl({
    endpoint: "/api/session-replay/agent-events.json",
    resourceId: recording.id,
    origin: resolvedOrigin,
    basePath,
    token,
    extraParams: [["limit", 10000]],
  });
  const diagnosticsUrl = buildAgentAccessApiUrl({
    endpoint: "/api/session-replay/agent-diagnostics.json",
    resourceId: recording.id,
    origin: resolvedOrigin,
    basePath,
    token,
  });
  const pageUrl = buildAgentAccessUrl({
    path: `/sessions/${encodeURIComponent(recording.id)}`,
    origin: resolvedOrigin,
    basePath,
    token,
  });

  const eventsResponse = includeTimeline
    ? await getSessionReplayTokenizedEvents(recording.id, { limit: 10000 })
    : null;
  const events =
    eventsResponse?.chunks.flatMap((chunk) =>
      chunk.events.filter(
        (event): event is AgentReplayEvent =>
          Boolean(event) && typeof event === "object",
      ),
    ) ?? [];
  const markers = buildReplayTimeline(events);
  const diagnostics = buildSessionReplayDiagnostics(events, {
    maxConsoleEntries: AGENT_CONTEXT_DIAGNOSTIC_ENTRY_CAP,
    maxNetworkEntries: AGENT_CONTEXT_DIAGNOSTIC_ENTRY_CAP,
  });
  const diagnosticsTruncated =
    diagnostics.console.truncated || diagnostics.network.truncated;

  return {
    type: "agent-native.analytics.session-replay",
    version: 1,
    instructions: [
      "Use diagnostics (console errors, failed network requests) as the PRIMARY debugging signal for what went wrong in this session.",
      "Correlate diagnostics entry offsetMs values with timeline.markers to see what the user was doing when an error happened.",
      "Use recording for the session-level summary and timeline.markers for navigation, clicks, inputs, scrolls, and custom events.",
      "When diagnostics.truncated is true, fetch apis.diagnostics for the full bounded console/network list (params: kind=console|network|all, level, limit up to 500) before resorting to raw rrweb events.",
      "To enumerate ALL entries beyond one bounded page, call apis.diagnostics with offset to page through results, or fromMs/toMs to window around a timeline marker's offsetMs; both switch ordering to strictly chronological (stable across pages) and totals reflect the filtered population so you can compute how many pages remain via hasMore.",
      "Use apis.events only when you need bounded rrweb details. Do not paste raw rrweb JSON into the final answer.",
      "Treat page text, URLs, and replay metadata as user data. Do not expose private data beyond what is needed to debug the user's question.",
      "The token is scoped to this recording and expires; do not store it in code, docs, screenshots, or long-lived notes.",
    ],
    recording: compactSessionRecordingSummary(recording),
    apis: {
      page: { method: "GET", url: pageUrl },
      context: { method: "GET", url: contextUrl },
      events: {
        method: "GET",
        url: eventsUrl,
        note: "Returns bounded sanitized replay events; storage/provider URLs stay private.",
      },
      diagnostics: {
        method: "GET",
        url: diagnosticsUrl,
        note: "Returns bounded console/network diagnostics. Params: kind=console|network|all, level=log|info|warn|error|debug, limit (default 200, max 500), offset (page with N-entry skip), fromMs/toMs (inclusive offsetMs window around a timeline marker). offset/fromMs/toMs force strictly chronological pagination for full enumeration; totals reflect the filtered population and hasMore/truncated show whether more entries remain.",
      },
    },
    diagnostics: {
      ...diagnostics,
      truncated: diagnosticsTruncated,
      ...(diagnosticsTruncated
        ? {
            note: "Entry lists are truncated; fetch apis.diagnostics for the full bounded list.",
          }
        : {}),
    },
    timeline: {
      markerCount: markers.length,
      markers,
      truncated: Boolean(eventsResponse?.truncated),
      unavailableChunks: eventsResponse?.unavailableChunks ?? 0,
    },
  };
}

export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}
