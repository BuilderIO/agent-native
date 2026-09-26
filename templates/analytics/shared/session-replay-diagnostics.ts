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
