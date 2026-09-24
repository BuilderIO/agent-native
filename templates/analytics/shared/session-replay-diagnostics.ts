/**
 * Shared contract for console/network diagnostics captured inside session
 * replay streams. The replay recorder emits these as rrweb custom events
 * (`type: 5`) tagged with the constants below; server signal derivation, the
 * agent timeline/diagnostics builders, and the sessions UI all key off this
 * one module so the tag strings and payload shapes cannot drift.
 */

export const SESSION_REPLAY_CONSOLE_EVENT_TAG = "agent-native.console";
export const SESSION_REPLAY_NETWORK_EVENT_TAG = "agent-native.network";

export type SessionReplayConsoleLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug";

export type SessionReplayConsoleSource =
  | "console"
  | "window-error"
  | "unhandledrejection";

export interface SessionReplayConsoleEventPayload {
  level: SessionReplayConsoleLevel;
  source: SessionReplayConsoleSource;
  message: string;
  args?: string[];
  stack?: string;
  url?: string;
  /** Number of identical consecutive occurrences collapsed into this event. */
  repeat?: number;
}

export interface SessionReplayNetworkEventPayload {
  api: "fetch" | "xhr";
  method: string;
  url: string;
  /** HTTP status code; 0 means the request failed at the network layer. */
  status: number;
  ok: boolean;
  durationMs: number;
  error?: string;
  /**
   * Bounded, redacted response-body snippet. Present only for 5xx
   * responses -- request bodies and headers are never captured, and
   * non-5xx/network-failure responses never carry a body.
   */
  responseBody?: string;
}

export interface SessionReplayConsoleDiagnosticsEntry extends SessionReplayConsoleEventPayload {
  /** Milliseconds since the first replay event. */
  offsetMs: number;
  /** Epoch milliseconds of the rrweb event. */
  timestamp: number;
}

export interface SessionReplayNetworkDiagnosticsEntry extends SessionReplayNetworkEventPayload {
  /** Milliseconds since the first replay event. */
  offsetMs: number;
  /** Epoch milliseconds of the rrweb event. */
  timestamp: number;
}

export interface SessionReplayDiagnostics {
  console: {
    total: number;
    errorCount: number;
    warnCount: number;
    entries: SessionReplayConsoleDiagnosticsEntry[];
    truncated: boolean;
    /** True when more console entries remain after this page/response. */
    hasMore: boolean;
  };
  network: {
    total: number;
    failedCount: number;
    entries: SessionReplayNetworkDiagnosticsEntry[];
    truncated: boolean;
    /** True when more network entries remain after this page/response. */
    hasMore: boolean;
  };
}

export function isFailedSessionReplayNetworkStatus(status: number): boolean {
  return status === 0 || status >= 400;
}
