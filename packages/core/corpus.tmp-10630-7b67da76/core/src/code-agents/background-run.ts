import {
  codeAgentRunArtifactsDir,
  codeAgentRunTranscriptPath,
  getCodeAgentRunRecord,
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
  type CodeAgentPermissionMode,
  type CodeAgentRunDetail,
  type CodeAgentRunProgress,
  type CodeAgentRunRecord,
  type CodeAgentRunStatus,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptEventKind,
} from "../cli/code-agent-runs.js";

export type BackgroundAgentRunKind = "code" | "agent-team" | "harness";

export type BackgroundAgentRunSource =
  | "local-code"
  | "hosted-agent-team"
  | "agent-harness";

export type BackgroundAgentRunStatus = CodeAgentRunStatus;

export interface BackgroundAgentRunSourceRecord {
  type: "code-agent-run" | "agent-team-task" | "agent-harness-session";
  id: string;
  threadId?: string;
  parentThreadId?: string;
  name?: string;
}

export interface BackgroundAgentRun {
  schemaVersion: 1;
  id: string;
  kind: BackgroundAgentRunKind;
  source: BackgroundAgentRunSource;
  sourceLabel?: string;
  sourceRecord: BackgroundAgentRunSourceRecord;
  title: string;
  subtitle?: string;
  status: BackgroundAgentRunStatus;
  phase?: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
  goalId: string;
  permissionMode?: CodeAgentPermissionMode;
  progress?: CodeAgentRunProgress;
  needsInput: boolean;
  needsApproval: boolean;
  details?: CodeAgentRunDetail[];
  transcriptPath?: string;
  artifactRoot?: string;
  surfaceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface BackgroundAgentTranscriptEvent {
  schemaVersion: 1;
  id: string;
  runId: string;
  kind: CodeAgentTranscriptEventKind;
  source: BackgroundAgentRunSource;
  sourceRecord: {
    type:
      | "code-agent-transcript-event"
      | "agent-team-run-event"
      | "agent-harness-run-event";
    id: string;
    seq?: number;
  };
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ListBackgroundAgentRunsOptions {
  goalId?: string;
  ownerEmail?: string | null;
  orgId?: string | null;
}

export function toBackgroundAgentRun(
  run: CodeAgentRunRecord,
): BackgroundAgentRun {
  return {
    schemaVersion: 1,
    id: run.id,
    kind: "code",
    source: "local-code",
    sourceLabel: "Local Code",
    sourceRecord: {
      type: "code-agent-run",
      id: run.id,
    },
    title: run.title,
    subtitle: run.subtitle,
    status: run.status,
    phase: run.phase,
    cwd: run.cwd,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    goalId: run.goalId,
    permissionMode: run.permissionMode,
    progress: run.progress,
    needsInput: run.status === "paused" || run.status === "needs-approval",
    needsApproval:
      run.needsApproval === true || run.status === "needs-approval",
    details: run.details,
    transcriptPath: codeAgentRunTranscriptPath(run.id),
    artifactRoot: run.artifactRoot ?? codeAgentRunArtifactsDir(run.id),
    surfaceUrl: run.surfaceUrl,
    metadata: run.metadata,
  };
}

export function toBackgroundAgentTranscriptEvent(
  event: CodeAgentTranscriptEvent,
): BackgroundAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id: event.id,
    runId: event.runId,
    kind: event.kind,
    source: "local-code",
    sourceRecord: {
      type: "code-agent-transcript-event",
      id: event.id,
    },
    message: event.message,
    createdAt: event.createdAt,
    metadata: event.metadata,
  };
}

export function listBackgroundAgentRuns(
  options: ListBackgroundAgentRunsOptions = {},
): BackgroundAgentRun[] {
  return listCodeAgentRunRecords(options.goalId).map(toBackgroundAgentRun);
}

export function getBackgroundAgentRun(
  runId: string,
): BackgroundAgentRun | null {
  const run = getCodeAgentRunRecord(runId);
  return run ? toBackgroundAgentRun(run) : null;
}

export function listBackgroundAgentTranscriptEvents(
  runId: string,
): BackgroundAgentTranscriptEvent[] {
  return listCodeAgentTranscriptEvents(runId).map(
    toBackgroundAgentTranscriptEvent,
  );
}
