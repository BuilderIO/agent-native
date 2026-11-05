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
  /**
   * On a `console` error: true for an exception Monitoring captured, false for
   * a plain `console.error`. Older recorders leave it out.
   */
  exception?: boolean;
  args?: string[];
  stack?: string;
  url?: string;
  repeat?: number;
}

export interface SessionReplayNetworkEventPayload {
  api: "fetch" | "xhr";
  method: string;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  error?: string;
  responseBody?: string;
}

export interface SessionReplayConsoleDiagnosticsEntry extends SessionReplayConsoleEventPayload {
  offsetMs: number;
  timestamp: number;
}

export interface SessionReplayNetworkDiagnosticsEntry extends SessionReplayNetworkEventPayload {
  offsetMs: number;
  timestamp: number;
}

export interface SessionReplayDiagnostics {
  console: {
    total: number;
    errorCount: number;
    warnCount: number;
    entries: SessionReplayConsoleDiagnosticsEntry[];
    truncated: boolean;
    hasMore: boolean;
  };
  network: {
    total: number;
    failedCount: number;
    entries: SessionReplayNetworkDiagnosticsEntry[];
    truncated: boolean;
    hasMore: boolean;
  };
}

export function isFailedSessionReplayNetworkStatus(status: number): boolean {
  return status === 0 || status >= 400;
}

const ACTION_ROUTE_PATTERN = /\/_agent-native\/actions\/([A-Za-z0-9._:%-]+)/;

/** The action name when a captured request called an Agent-Native action. */
export function replayActionName(url: string | undefined): string | null {
  if (!url) return null;
  const match = ACTION_ROUTE_PATTERN.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
