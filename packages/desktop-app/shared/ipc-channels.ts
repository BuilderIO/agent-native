/** IPC channel names shared between main, preload, and renderer. */
import type { CodeAgentPermissionMode } from "./code-agents";
import type {
  DesktopShortcutSettings,
  DesktopShortcutUpdateResult,
  DesktopShortcutUpsertRequest,
} from "./desktop-shortcuts";

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
  APPS_CHOOSE_LOCAL_FOLDER: "apps:choose-local-folder",

  /** Hosted Plan app local-file sync (Plan webview ↔ main) */
  PLAN_FILES_GET_FOLDER: "plan-files:get-folder",
  PLAN_FILES_CHOOSE_FOLDER: "plan-files:choose-folder",
  PLAN_FILES_WRITE: "plan-files:write",
  PLAN_FILES_READ: "plan-files:read",
  PLAN_FILES_CLEAR_FOLDER: "plan-files:clear-folder",

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
  CODE_AGENTS_LIST_MODELS: "code-agents:list-models",
  CODE_AGENTS_READ_TRANSCRIPT: "code-agents:read-transcript",
  CODE_AGENTS_APPEND_FOLLOW_UP: "code-agents:append-follow-up",
  CODE_AGENTS_UPDATE_RUN: "code-agents:update-run",
  CODE_AGENTS_CONTROL_RUN: "code-agents:control-run",
  CODE_AGENTS_RETRY_RUN: "code-agents:retry-run",
  CODE_AGENTS_RERUN_RUN: "code-agents:rerun-run",
  CODE_AGENTS_GET_HOST_METADATA: "code-agents:get-host-metadata",
  CODE_AGENTS_LIST_CODE_PACKS: "code-agents:list-code-packs",
  CODE_AGENTS_LIST_PROJECTS: "code-agents:list-projects",
  CODE_AGENTS_SELECT_PROJECT: "code-agents:select-project",
  CODE_AGENTS_CHOOSE_PROJECT: "code-agents:choose-project",
  CODE_AGENTS_LIST_MIGRATION_RUNS: "code-agents:list-migration-runs",
  CODE_AGENTS_OPEN_TERMINAL: "code-agents:open-terminal",
  CODE_AGENTS_REMOTE_CONNECTOR_GET_STATUS:
    "code-agents:remote-connector:get-status",
  CODE_AGENTS_REMOTE_CONNECTOR_SET_ENABLED:
    "code-agents:remote-connector:set-enabled",
  CODE_AGENTS_REMOTE_CONNECTOR_PAIR: "code-agents:remote-connector:pair",
  CODE_AGENTS_PROVIDER_SETTINGS_GET: "code-agents:provider-settings:get",
  CODE_AGENTS_PROVIDER_SETTINGS_UPDATE: "code-agents:provider-settings:update",
  CODE_AGENTS_PROVIDER_BUILDER_CONNECT: "code-agents:provider-builder:connect",

  /** Deep links (main → renderer) */
  DEEP_LINK_OPEN: "deep-link:open",

  /** Local desktop app-launch shortcuts (renderer ↔ main) */
  SHORTCUTS_LOAD: "shortcuts:load",
  SHORTCUTS_UPSERT: "shortcuts:upsert",
  SHORTCUTS_REMOVE: "shortcuts:remove",
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

export interface LocalAppFolderInfo {
  path: string;
  name: string;
  devUrl: string;
  devPort: number;
  devCommand: string;
  packageManager?: string;
  warning?: string;
}

export interface LocalAppFolderSelectResult {
  ok: boolean;
  folder?: LocalAppFolderInfo;
  error?: string;
}

export interface DesktopPlanMdxFolder {
  "plan.mdx": string;
  "canvas.mdx"?: string;
  "prototype.mdx"?: string;
  ".plan-state.json"?: string;
  "assets/"?: Record<string, string>;
}

export interface DesktopPlanFilesFolder {
  name: string;
  planId: string;
  title?: string;
  updatedAt?: string;
}

export interface DesktopPlanFilesFolderRequest {
  planId: string;
}

export interface DesktopPlanFilesChooseFolderRequest {
  planId: string;
  title?: string;
}

export interface DesktopPlanFilesWriteRequest {
  planId: string;
  title?: string;
  mdx: DesktopPlanMdxFolder;
}

export interface DesktopPlanFilesReadRequest {
  planId: string;
}

export interface DesktopPlanFilesClearFolderRequest {
  planId: string;
}

export type DesktopPlanFilesResult =
  | {
      ok: true;
      folder: DesktopPlanFilesFolder;
      files?: string[];
      mdx?: DesktopPlanMdxFolder;
    }
  | {
      ok: false;
      error: string;
      canceled?: boolean;
      folder?: DesktopPlanFilesFolder;
    };

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

export type CodeAgentReasoningEffort =
  | "auto"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface CodeAgentModelSelection {
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
}

export interface CodeAgentModelOption {
  engine: string;
  engineLabel: string;
  model: string;
  label: string;
  description?: string;
  configured?: boolean;
}

export interface CodeAgentModelListResult {
  status: "ok" | "unavailable";
  models: CodeAgentModelOption[];
  selected?: CodeAgentModelSelection;
  error?: string;
}

export interface CodeAgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  /** Base64 data URL for image attachments (e.g. "data:image/png;base64,..."). */
  dataUrl?: string;
}

export interface CodeAgentProjectCommand {
  kind: "command";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  argumentHint?: string;
  reserved: boolean;
  body?: string;
}

export interface CodeAgentProjectSkill {
  kind: "skill";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  body?: string;
}

export interface CodeAgentCodePack {
  schemaVersion: 1;
  root: string;
  commands: CodeAgentProjectCommand[];
  skills: CodeAgentProjectSkill[];
}

export interface CodeAgentCodePackResult {
  status: "ok" | "unavailable";
  pack?: CodeAgentCodePack;
  error?: string;
}

export interface CodeAgentProjectFolder {
  id: string;
  path: string;
  name: string;
  updatedAt?: string;
}

export interface CodeAgentProjectListResult {
  status: "ok" | "unavailable";
  projects: CodeAgentProjectFolder[];
  selectedPath?: string;
  defaultPath?: string;
  error?: string;
}

export interface CodeAgentProjectSelectResult {
  ok: boolean;
  project?: CodeAgentProjectFolder;
  projects: CodeAgentProjectFolder[];
  selectedPath?: string;
  error?: string;
}

export interface CodeAgentQueueMetadata {
  queued: boolean;
  queuedAt?: string;
  queuedBy?: "desktop" | "cli" | "host" | string;
  queueId?: string;
  queuePosition?: number;
  attempt?: number;
  retryOf?: string;
  rerunOf?: string;
}

export interface CodeAgentSteeringMetadata {
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
}

export interface CodeAgentRun {
  id: string;
  goalId: string;
  title: string;
  subtitle?: string;
  kind?: string;
  source?: string;
  sourceLabel?: string;
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
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
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
  followUpMode?: "immediate" | "queued";
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
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
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  metadata?: Record<string, unknown>;
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

export type CodeAgentRemoteConnectorState =
  | "disabled"
  | "unconfigured"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export interface CodeAgentRemoteConnectorStatus {
  state: CodeAgentRemoteConnectorState;
  enabled: boolean;
  configured: boolean;
  configPath: string;
  relayUrl?: string;
  pid?: number;
  startedAt?: string;
  lastExitAt?: string;
  lastExitCode?: number | null;
  lastExitSignal?: string | null;
  restartCount: number;
  nextRestartAt?: string;
  error?: string;
}

export interface CodeAgentRemoteConnectorControlResult {
  ok: boolean;
  status: CodeAgentRemoteConnectorStatus;
  error?: string;
}

export interface CodeAgentRemoteConnectorPairRequest {
  relayUrl?: string;
  label?: string;
}

export interface CodeAgentRemoteConnectorPairResult {
  ok: boolean;
  status: CodeAgentRemoteConnectorStatus;
  deviceId?: string;
  message?: string;
  error?: string;
}

export type CodeAgentProviderId = "builder" | "anthropic" | "openai" | "google";

export type CodeAgentProviderCredentialKey =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GOOGLE_GENERATIVE_AI_API_KEY"
  | "BUILDER_PRIVATE_KEY"
  | "BUILDER_PUBLIC_KEY";

export interface CodeAgentProviderStatus {
  id: CodeAgentProviderId;
  label: string;
  configured: boolean;
  configuredKeys: CodeAgentProviderCredentialKey[];
  missingKeys: CodeAgentProviderCredentialKey[];
  savedKeys: CodeAgentProviderCredentialKey[];
  source?: "desktop-settings" | "environment" | "mixed";
}

export interface CodeAgentProviderSettings {
  configured: boolean;
  configuredProviders: string[];
  providers: CodeAgentProviderStatus[];
  storagePath: string;
}

export type CodeAgentProviderSettingsUpdate = Partial<
  Record<CodeAgentProviderCredentialKey, string | null>
>;

export interface CodeAgentProviderSettingsUpdateResult {
  ok: boolean;
  settings: CodeAgentProviderSettings;
  message: string;
  error?: string;
}

export type CodeAgentControlCommand =
  | "resume"
  | "status"
  | "stop"
  | "approve"
  | "approve-always"
  | "deny";

export type CodeAgentHostControlCommand =
  | CodeAgentControlCommand
  | "retry"
  | "rerun";

export interface CodeAgentControlResult {
  ok: boolean;
  command: CodeAgentControlCommand;
  action?: "open-ui" | "refresh" | "none" | "select-run";
  run?: CodeAgentRun;
  message: string;
  error?: string;
}

export interface CodeAgentRerunRequest {
  goalId?: string;
  runId: string;
  prompt?: string;
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
}

export interface CodeAgentRerunResult extends CodeAgentCreateRunResult {
  sourceRunId?: string;
}

export interface CodeAgentRetryRunRequest {
  goalId?: string;
  runId: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  metadata?: Record<string, unknown>;
}

export interface CodeAgentRetryRunResult {
  ok: boolean;
  run?: CodeAgentRun;
  message: string;
  error?: string;
}

export interface CodeAgentCodePackMetadata {
  name: string;
  version?: string;
  root?: string;
  packagePath?: string;
  cliEntry?: string;
  available?: boolean;
}

export interface CodeAgentHostMetadata {
  status: "ok" | "unavailable";
  platform: NodeJS.Platform | string;
  desktopVersion?: string;
  storeRoot: string;
  runsDir: string;
  transcriptsDir: string;
  codePack?: CodeAgentCodePackMetadata;
  llmProvider?: {
    configured: boolean;
    label?: string;
    configuredProviders?: string[];
    missingEnvVars?: string[];
  };
  capabilities: {
    fileBackedRuns: boolean;
    nativeTaskRunner: boolean;
    queueMetadata: boolean;
    steeringMetadata: boolean;
    retryRun: boolean;
    rerunRun: boolean;
    openTerminal: boolean;
    controlCommands: CodeAgentHostControlCommand[];
  };
  error?: string;
}

export interface DesktopOpenRequest {
  app?: string;
  goalId?: string;
  path?: string;
  softOpen?: boolean;
  runId?: string;
}

export type {
  DesktopShortcutSettings,
  DesktopShortcutUpdateResult,
  DesktopShortcutUpsertRequest,
};
