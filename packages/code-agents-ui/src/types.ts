import type { AgentPromptAttachment } from "@agent-native/core/client";

import type { CodeAgentPermissionMode } from "./code-agents.js";

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
  effort?: CodeAgentReasoningEffort;
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

export type CodeAgentPromptAttachment = AgentPromptAttachment;

export type CodeAgentFollowUpMode = "immediate" | "queued";

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
  source?: string;
  sourceLabel?: string;
  kind?: string;
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
  /**
   * Structured marker for events that need special UI handling beyond
   * free-text matching. `"credential-gap"` marks the status event reporting
   * that no LLM provider key (or Codex CLI login) is available. Optional so
   * older persisted transcripts without the field keep parsing unchanged.
   */
  signal?: "credential-gap";
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

export interface CodeAgentTranscriptSubscriptionBatch extends CodeAgentTranscriptResult {
  subscriptionId?: string;
  reason?: string;
}

export interface CodeAgentCreateRunRequest {
  goalId?: string;
  prompt: string;
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
  attachments?: CodeAgentPromptAttachment[];
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
  followUpMode?: CodeAgentFollowUpMode;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
  attachments?: CodeAgentPromptAttachment[];
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
  title?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
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

export interface CodeAgentProviderConnectResult {
  ok: boolean;
  message: string;
  error?: string;
  settings?: {
    configured?: boolean;
    configuredProviders?: string[];
  };
}

export type CodeAgentControlCommand =
  | "resume"
  | "status"
  | "stop"
  | "approve"
  | "approve-always"
  | "deny";

export interface CodeAgentControlResult {
  ok: boolean;
  command: CodeAgentControlCommand;
  action?: "open-ui" | "refresh" | "none" | "select-run";
  run?: CodeAgentRun;
  message: string;
  error?: string;
}

export interface CodeAgentRetryRunRequest {
  goalId?: string;
  runId: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
}

export interface CodeAgentRetryRunResult {
  ok: boolean;
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
  effort?: CodeAgentReasoningEffort;
  attachments?: CodeAgentPromptAttachment[];
}

export interface CodeAgentRerunResult extends CodeAgentCreateRunResult {
  sourceRunId?: string;
}

export interface CodeAgentsOpenRequest {
  goalId?: string;
  runId?: string;
  nonce: number;
}
