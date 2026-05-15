/** IPC channel names shared between main, preload, and renderer. */
import type { CodeAgentPermissionMode } from "./code-agents";

export const IPC = {
  /** Window control channels (renderer → main) */
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",

  /** Window state query (renderer ↔ main) */
  WINDOW_IS_MAXIMIZED: "window:is-maximized",

  /** Window state broadcast (main → renderer) */
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed",

  /** Inter-app message relay (renderer → main → renderer) */
  INTER_APP_SEND: "inter-app:send",
  INTER_APP_MESSAGE: "inter-app:message",

  /** App status events (main → renderer) */
  APP_STATUS: "app:status",

  /** App config management (renderer ↔ main) */
  APPS_LOAD: "apps:load",
  APPS_ADD: "apps:add",
  APPS_REMOVE: "apps:remove",
  APPS_UPDATE: "apps:update",
  APPS_RESET: "apps:reset",

  /** Active webview tracking (renderer → main) */
  SET_ACTIVE_APP: "webview:set-active-app",
  SET_ACTIVE_WEBVIEW: "webview:set-active-webview",

  /** Clipboard helpers (renderer ↔ main) */
  CLIPBOARD_WRITE_TEXT: "clipboard:write-text",

  /** Frame settings (renderer ↔ main) */
  FRAME_LOAD: "frame:load",
  FRAME_UPDATE: "frame:update",

  /** Auto-update (renderer ↔ main) */
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL: "update:install",
  UPDATE_GET_STATUS: "update:get-status",
  /** Broadcast (main → renderer) */
  UPDATE_STATUS_CHANGED: "update:status-changed",

  /** Agent-Native Code hub (renderer ↔ main) */
  CODE_AGENTS_LIST_RUNS: "code-agents:list-runs",
  CODE_AGENTS_CREATE_RUN: "code-agents:create-run",
  CODE_AGENTS_READ_TRANSCRIPT: "code-agents:read-transcript",
  CODE_AGENTS_APPEND_FOLLOW_UP: "code-agents:append-follow-up",
  CODE_AGENTS_UPDATE_RUN: "code-agents:update-run",
  CODE_AGENTS_CONTROL_RUN: "code-agents:control-run",
  CODE_AGENTS_LIST_MIGRATION_RUNS: "code-agents:list-migration-runs",
  CODE_AGENTS_OPEN_TERMINAL: "code-agents:open-terminal",

  /** Deep links (main → renderer) */
  DEEP_LINK_OPEN: "deep-link:open",
} as const;

/** Auto-update status surfaced from electron-updater. */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "unsupported"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "not-available"; currentVersion: string }
  | {
      state: "downloading";
      percent: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    }
  | { state: "downloaded"; version: string; releaseNotes?: string }
  | { state: "error"; message: string };

export interface ActiveWebviewTarget {
  appId: string;
  webContentsId?: number;
}

export interface InterAppMessage {
  from: string;
  targetAppId: string;
  event: string;
  data: unknown;
}

export type CodeAgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "unknown";

export interface CodeAgentRunProgress {
  label?: string;
  completed: number;
  total: number;
  failed?: number;
  percent: number;
}

export interface CodeAgentRunDetail {
  label: string;
  value: string;
}

export interface CodeAgentRun {
  id: string;
  goalId: string;
  title: string;
  subtitle?: string;
  status: CodeAgentRunStatus;
  phase?: string;
  needsApproval?: boolean;
  progress?: CodeAgentRunProgress;
  details?: CodeAgentRunDetail[];
  surfaceUrl?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CodeAgentMigrationRun extends CodeAgentRun {
  name: string;
  sourceRoot: string;
  outputRoot: string;
  target: string;
  phase: string;
  approved: boolean;
  taskCount: number;
  passedTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeAgentRunListResult<
  TRun extends CodeAgentRun = CodeAgentRun,
> {
  status: "ok" | "unauthorized" | "unavailable";
  goalId?: string;
  runs: TRun[];
  workbenchUrl?: string;
  error?: string;
}

export type CodeAgentTranscriptEventType =
  | "user"
  | "system"
  | "artifact"
  | "status";

export interface CodeAgentTranscriptEvent {
  id: string;
  runId: string;
  type: CodeAgentTranscriptEventType;
  title?: string;
  text: string;
  createdAt: string;
  artifactPath?: string;
  artifactUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CodeAgentTranscriptRequest {
  goalId?: string;
  runId: string;
}

export interface CodeAgentTranscriptResult {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  error?: string;
}

export interface CodeAgentCreateRunRequest {
  goalId?: string;
  prompt: string;
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
}

export interface CodeAgentCreateRunResult {
  ok: boolean;
  run?: CodeAgentRun;
  event?: CodeAgentTranscriptEvent;
  eventFile?: string;
  message: string;
  error?: string;
}

export interface CodeAgentFollowUpRequest {
  goalId?: string;
  runId: string;
  prompt: string;
  permissionMode?: CodeAgentPermissionMode;
}

export interface CodeAgentFollowUpResult {
  ok: boolean;
  event?: CodeAgentTranscriptEvent;
  eventFile?: string;
  message: string;
  error?: string;
}

export interface CodeAgentUpdateRunRequest {
  goalId?: string;
  runId: string;
  permissionMode?: CodeAgentPermissionMode;
}

export interface CodeAgentUpdateRunResult {
  ok: boolean;
  run?: CodeAgentRun;
  message: string;
  error?: string;
}

export interface CodeAgentTerminalRequest {
  cwd?: string;
  sourceRoot?: string;
  outputRoot?: string;
}

export interface CodeAgentTerminalResult {
  ok: boolean;
  cwd: string;
  error?: string;
}

export type CodeAgentControlCommand = "resume" | "status" | "stop";

export interface CodeAgentControlResult {
  ok: boolean;
  command: CodeAgentControlCommand;
  action?: "open-ui" | "refresh" | "none";
  message: string;
  error?: string;
}

export interface DesktopOpenRequest {
  app?: string;
  goalId?: string;
  runId?: string;
}
