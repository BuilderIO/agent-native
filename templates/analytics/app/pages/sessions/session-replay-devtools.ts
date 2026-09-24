import {
  isFailedSessionReplayNetworkStatus,
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
  type SessionReplayConsoleLevel,
  type SessionReplayConsoleSource,
} from "@shared/session-replay-diagnostics";

type AnyReplayEvent = Record<string, any>;

const RRWEB_CUSTOM_EVENT_TYPE = 5;

const CONSOLE_LEVELS: ReadonlySet<SessionReplayConsoleLevel> = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
]);

const CONSOLE_SOURCES: ReadonlySet<SessionReplayConsoleSource> = new Set([
  "console",
  "window-error",
  "unhandledrejection",
]);

export type ReplayConsoleEntry = {
  id: string;
  offsetMs: number;
  timestamp: number;
  level: SessionReplayConsoleLevel;
  source: SessionReplayConsoleSource;
  message: string;
  args: string[];
  stack?: string;
  url?: string;
  repeat: number;
};

export type ReplayNetworkEntry = {
  id: string;
  offsetMs: number;
  timestamp: number;
  api: "fetch" | "xhr";
  method: string;
  url: string;
  status: number;
  ok: boolean;
  failed: boolean;
  durationMs: number;
  error?: string;
  responseBody?: string;
};

export type ReplayDevToolsDiagnostics = {
  console: ReplayConsoleEntry[];
  network: ReplayNetworkEntry[];
  consoleErrorCount: number;
  networkFailedCount: number;
};

export type ConsoleLevelFilter = "all" | "log" | "info" | "warn" | "error";
export type NetworkKindFilter = "all" | "fetch" | "xhr" | "failed";

/**
 * Pulls the embedded `agent-native.console` / `agent-native.network` rrweb
 * custom events out of a sanitized replay event stream. Offsets are relative
 * to the first replay event, matching how the player timeline computes time.
 */
export function extractReplayDiagnostics(
  events: readonly AnyReplayEvent[],
): ReplayDevToolsDiagnostics {
  const startedAt = firstReplayTimestamp(events);
  const consoleEntries: ReplayConsoleEntry[] = [];
  const networkEntries: ReplayNetworkEntry[] = [];

  for (const event of events) {
    if (!event || event.type !== RRWEB_CUSTOM_EVENT_TYPE) continue;
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const tag = event.data?.tag;
    const payload = event.data?.payload;
    if (!payload || typeof payload !== "object") continue;
    const offsetMs = Math.max(0, timestamp - startedAt);

    if (tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
      consoleEntries.push(
        normalizeConsoleEntry(
          payload,
          timestamp,
          offsetMs,
          consoleEntries.length,
        ),
      );
    } else if (tag === SESSION_REPLAY_NETWORK_EVENT_TAG) {
      networkEntries.push(
        normalizeNetworkEntry(
          payload,
          timestamp,
          offsetMs,
          networkEntries.length,
        ),
      );
    }
  }

  consoleEntries.sort((a, b) => a.offsetMs - b.offsetMs);
  networkEntries.sort((a, b) => a.offsetMs - b.offsetMs);

  return {
    console: consoleEntries,
    network: networkEntries,
    consoleErrorCount: consoleEntries.filter((entry) => entry.level === "error")
      .length,
    networkFailedCount: networkEntries.filter((entry) => entry.failed).length,
  };
}

function normalizeConsoleEntry(
  payload: AnyReplayEvent,
  timestamp: number,
  offsetMs: number,
  index: number,
): ReplayConsoleEntry {
  const level = CONSOLE_LEVELS.has(payload.level) ? payload.level : "log";
  const source = CONSOLE_SOURCES.has(payload.source)
    ? payload.source
    : "console";
  const repeat = Math.max(1, Math.floor(Number(payload.repeat)) || 1);
  return {
    id: `console-${timestamp}-${index}`,
    offsetMs,
    timestamp,
    level,
    source,
    message: typeof payload.message === "string" ? payload.message : "",
    args: Array.isArray(payload.args)
      ? payload.args.filter((arg): arg is string => typeof arg === "string")
      : [],
    stack: typeof payload.stack === "string" ? payload.stack : undefined,
    url: typeof payload.url === "string" ? payload.url : undefined,
    repeat,
  };
}

function normalizeNetworkEntry(
  payload: AnyReplayEvent,
  timestamp: number,
  offsetMs: number,
  index: number,
): ReplayNetworkEntry {
  const status = Number.isFinite(Number(payload.status))
    ? Math.max(0, Math.floor(Number(payload.status)))
    : 0;
  const ok = payload.ok === true;
  return {
    id: `network-${timestamp}-${index}`,
    offsetMs,
    timestamp,
    api: payload.api === "xhr" ? "xhr" : "fetch",
    method:
      typeof payload.method === "string" && payload.method
        ? payload.method.toUpperCase()
        : "GET",
    url: typeof payload.url === "string" ? payload.url : "",
    status,
    ok,
    failed: !ok || isFailedSessionReplayNetworkStatus(status),
    durationMs: Math.max(0, Math.round(Number(payload.durationMs) || 0)),
    error: typeof payload.error === "string" ? payload.error : undefined,
    responseBody:
      typeof payload.responseBody === "string"
        ? payload.responseBody
        : undefined,
  };
}

function firstReplayTimestamp(events: readonly AnyReplayEvent[]): number {
  for (const event of events) {
    const timestamp = Number(event?.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
}

/** Chip bucket for a console level; `debug` folds into the Log chip. */
export function consoleLevelBucket(
  level: SessionReplayConsoleLevel,
): Exclude<ConsoleLevelFilter, "all"> {
  if (level === "debug") return "log";
  return level;
}

export function filterConsoleEntries(
  entries: readonly ReplayConsoleEntry[],
  level: ConsoleLevelFilter,
  query: string,
): ReplayConsoleEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (level !== "all" && consoleLevelBucket(entry.level) !== level) {
      return false;
    }
    if (!needle) return true;
    return (
      entry.message.toLowerCase().includes(needle) ||
      entry.args.some((arg) => arg.toLowerCase().includes(needle)) ||
      (entry.url ?? "").toLowerCase().includes(needle)
    );
  });
}

export function filterNetworkEntries(
  entries: readonly ReplayNetworkEntry[],
  kind: NetworkKindFilter,
  query: string,
): ReplayNetworkEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (kind === "failed" && !entry.failed) return false;
    if ((kind === "fetch" || kind === "xhr") && entry.api !== kind) {
      return false;
    }
    if (!needle) return true;
    return (
      entry.url.toLowerCase().includes(needle) ||
      entry.method.toLowerCase().includes(needle) ||
      String(entry.status).includes(needle)
    );
  });
}

/**
 * Index of the latest entry at/before the current playback time (250ms
 * tolerance, matching the timeline's active-marker window), or -1.
 * Entries must be sorted by offsetMs ascending.
 */
export function latestEntryIndexAt(
  entries: ReadonlyArray<{ offsetMs: number }>,
  timeMs: number,
): number {
  let active = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].offsetMs <= timeMs + 250) active = index;
    else break;
  }
  return active;
}

/** Middle-truncates long strings, keeping the start and the tail visible. */
export function middleTruncate(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** Prefers path + query for parseable URLs so rows read like a network tab. */
export function networkDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || url;
  } catch {
    return url;
  }
}

export function formatOffsetClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
