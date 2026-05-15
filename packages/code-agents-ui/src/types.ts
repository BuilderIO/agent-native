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
}

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
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
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

export type CodeAgentControlCommand = "resume" | "status" | "stop" | "approve";

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
