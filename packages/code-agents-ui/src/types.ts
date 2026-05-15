import type { CodeAgentPermissionMode } from "./code-agents.js";

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

export interface CodeAgentsOpenRequest {
  goalId?: string;
  runId?: string;
  nonce: number;
}
