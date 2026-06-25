import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import type { AgentPromptAttachment } from "../code-agents/prompt-attachments.js";

export type CodeAgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "unknown";

export const CODE_AGENT_PERMISSION_MODES = [
  "read-only",
  "ask-before-edit",
  "auto-edit",
  "full-auto",
] as const;

export type CodeAgentPermissionMode =
  (typeof CODE_AGENT_PERMISSION_MODES)[number];

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

export type CodeAgentFollowUpMode = "immediate" | "queued";

export interface CodeAgentPendingFollowUp {
  id: string;
  prompt: string;
  mode: CodeAgentFollowUpMode;
  createdAt: string;
  eventId?: string;
  permissionMode?: CodeAgentPermissionMode;
  source?: string;
  attachments?: AgentPromptAttachment[];
}

export interface CodeAgentRunRecord {
  schemaVersion: 1;
  id: string;
  goalId: string;
  title: string;
  subtitle?: string;
  status: CodeAgentRunStatus;
  phase?: string;
  needsApproval?: boolean;
  progress?: CodeAgentRunProgress;
  permissionMode?: CodeAgentPermissionMode;
  details?: CodeAgentRunDetail[];
  artifactRoot?: string;
  surfaceUrl?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type CodeAgentTranscriptEventKind =
  | "user"
  | "system"
  | "note"
  | "artifact"
  | "status";

export interface CodeAgentTranscriptEvent {
  schemaVersion: 1;
  id: string;
  runId: string;
  kind: CodeAgentTranscriptEventKind;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCodeAgentRunInput {
  goalId: string;
  title: string;
  subtitle?: string;
  status?: CodeAgentRunStatus;
  phase?: string;
  needsApproval?: boolean;
  progress?: CodeAgentRunProgress;
  permissionMode?: CodeAgentPermissionMode;
  details?: CodeAgentRunDetail[];
  artifactRoot?: string;
  surfaceUrl?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
}

export interface AppendCodeAgentTranscriptEventInput {
  runId: string;
  kind: CodeAgentTranscriptEventKind;
  message: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface QueueCodeAgentFollowUpInput {
  runId: string;
  prompt: string;
  mode: CodeAgentFollowUpMode;
  eventId?: string;
  permissionMode?: CodeAgentPermissionMode;
  source?: string;
  createdAt?: string;
  attachments?: AgentPromptAttachment[];
}

const STORE_ENV = "AGENT_NATIVE_CODE_AGENTS_HOME";

export function codeAgentStoreRoot(): string {
  return path.resolve(
    process.env[STORE_ENV] ??
      path.join(os.homedir(), ".agent-native", "code-agents"),
  );
}

export function codeAgentRunsDir(): string {
  return path.join(codeAgentStoreRoot(), "runs");
}

export function codeAgentRunArtifactsDir(runId: string): string {
  return path.join(codeAgentStoreRoot(), "artifacts", runId);
}

export function codeAgentTranscriptsDir(): string {
  return path.join(codeAgentStoreRoot(), "transcripts");
}

export function codeAgentRunTranscriptPath(runId: string): string {
  return path.join(codeAgentTranscriptsDir(), `${runId}.jsonl`);
}

// --------------- Command allowlist ---------------

const COMMAND_ALLOWLIST_FILENAME = "command-allowlist.json";

export function codeAgentCommandAllowlistPath(): string {
  return path.join(codeAgentStoreRoot(), COMMAND_ALLOWLIST_FILENAME);
}

/**
 * Load the per-store command allowlist.  Returns an array of exact command
 * strings the user has marked "always allow".
 */
export function readCodeAgentCommandAllowlist(): string[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(codeAgentCommandAllowlistPath(), "utf-8"),
    ) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Persist a command to the per-store allowlist so future identical commands
 * are auto-approved without a prompt.  Deduplicates by exact string match.
 */
export function addCodeAgentCommandToAllowlist(command: string): void {
  const current = readCodeAgentCommandAllowlist();
  if (current.includes(command)) return;
  const next = [...current, command];
  fs.mkdirSync(codeAgentStoreRoot(), { recursive: true });
  fs.writeFileSync(
    codeAgentCommandAllowlistPath(),
    JSON.stringify(next, null, 2),
  );
}

/** Return true if `command` is in the stored allowlist. */
export function isCodeAgentCommandAllowed(command: string): boolean {
  return readCodeAgentCommandAllowlist().includes(command);
}

export function createCodeAgentRunRecord(
  input: CreateCodeAgentRunInput,
): CodeAgentRunRecord {
  const now = new Date().toISOString();
  const id = `${input.goalId}-${timestampSlug(now)}-${crypto.randomUUID().slice(0, 8)}`;
  const record: CodeAgentRunRecord = {
    schemaVersion: 1,
    id,
    goalId: input.goalId,
    title: input.title,
    subtitle: input.subtitle,
    status: input.status ?? "queued",
    phase: input.phase,
    needsApproval: input.needsApproval,
    progress: input.progress,
    permissionMode: input.permissionMode,
    details: input.details,
    artifactRoot: input.artifactRoot,
    surfaceUrl: input.surfaceUrl,
    cwd: input.cwd ?? process.cwd(),
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
  writeCodeAgentRunRecord(record);
  return record;
}

export function normalizeCodeAgentPermissionMode(
  value: unknown,
): CodeAgentPermissionMode | null {
  if (typeof value !== "string") return null;
  return CODE_AGENT_PERMISSION_MODES.includes(value as CodeAgentPermissionMode)
    ? (value as CodeAgentPermissionMode)
    : null;
}

export function writeCodeAgentRunRecord(record: CodeAgentRunRecord): void {
  fs.mkdirSync(codeAgentRunsDir(), { recursive: true });
  fs.writeFileSync(
    codeAgentRunRecordPath(record.id),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export function getCodeAgentRunRecord(
  runId: string,
): CodeAgentRunRecord | null {
  return readRunFile(codeAgentRunRecordPath(runId));
}

export function updateCodeAgentRunRecord(
  runId: string,
  updates:
    | Partial<CodeAgentRunRecord>
    | ((record: CodeAgentRunRecord) => Partial<CodeAgentRunRecord>),
): CodeAgentRunRecord | null {
  const record = getCodeAgentRunRecord(runId);
  if (!record) return null;
  const patch = typeof updates === "function" ? updates(record) : updates;
  const next: CodeAgentRunRecord = {
    ...record,
    ...patch,
    metadata: {
      ...(record.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  writeCodeAgentRunRecord(next);
  return next;
}

export function listCodeAgentRunRecords(goalId?: string): CodeAgentRunRecord[] {
  const dir = codeAgentRunsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readRunFile(path.join(dir, file)))
    .filter((run): run is CodeAgentRunRecord => Boolean(run))
    .filter((run) => !goalId || run.goalId === goalId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLastCodeAgentRunRecord(
  goalId?: string,
): CodeAgentRunRecord | null {
  return listCodeAgentRunRecords(goalId)[0] ?? null;
}

export function appendCodeAgentTranscriptEvent(
  input: AppendCodeAgentTranscriptEventInput,
): CodeAgentTranscriptEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const event: CodeAgentTranscriptEvent = {
    schemaVersion: 1,
    id: `evt-${timestampSlug(createdAt)}-${crypto.randomUUID().slice(0, 8)}`,
    runId: input.runId,
    kind: input.kind,
    message: input.message,
    createdAt,
    metadata: input.metadata,
  };

  fs.mkdirSync(codeAgentTranscriptsDir(), { recursive: true });
  fs.appendFileSync(
    codeAgentRunTranscriptPath(input.runId),
    `${JSON.stringify(event)}\n`,
  );
  touchCodeAgentRunRecord(input.runId, createdAt);
  return event;
}

export function listCodeAgentTranscriptEvents(
  runId: string,
): CodeAgentTranscriptEvent[] {
  const transcriptPath = codeAgentRunTranscriptPath(runId);
  if (!fs.existsSync(transcriptPath)) return [];
  return fs
    .readFileSync(transcriptPath, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(readTranscriptLine)
    .filter((event): event is CodeAgentTranscriptEvent => Boolean(event));
}

export function isActiveCodeAgentRun(run: CodeAgentRunRecord): boolean {
  return run.status === "running" || run.status === "needs-approval";
}

export function queueCodeAgentFollowUp(
  input: QueueCodeAgentFollowUpInput,
): CodeAgentPendingFollowUp | null {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const followUp: CodeAgentPendingFollowUp = {
    id: `followup-${timestampSlug(createdAt)}-${crypto.randomUUID().slice(0, 8)}`,
    prompt: input.prompt,
    mode: input.mode,
    createdAt,
    eventId: input.eventId,
    permissionMode: input.permissionMode,
    source: input.source,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  };
  const updated = updateCodeAgentRunRecord(input.runId, (record) => ({
    metadata: {
      pendingFollowUps: [
        ...readPendingFollowUps(record.metadata?.pendingFollowUps),
        followUp,
      ],
    },
  }));
  return updated ? followUp : null;
}

export function dequeueCodeAgentFollowUp(
  runId: string,
): CodeAgentPendingFollowUp | null {
  let selected: CodeAgentPendingFollowUp | null = null;
  updateCodeAgentRunRecord(runId, (record) => {
    const [first, ...rest] = readPendingFollowUps(
      record.metadata?.pendingFollowUps,
    );
    selected = first ?? null;
    return {
      metadata: {
        pendingFollowUps: rest.length > 0 ? rest : undefined,
      },
    };
  });
  return selected;
}

function codeAgentRunRecordPath(runId: string): string {
  return path.join(codeAgentRunsDir(), `${runId}.json`);
}

function readPendingFollowUps(value: unknown): CodeAgentPendingFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): CodeAgentPendingFollowUp | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.prompt !== "string" ||
        typeof candidate.createdAt !== "string" ||
        (candidate.mode !== "immediate" && candidate.mode !== "queued")
      ) {
        return null;
      }
      return {
        id: candidate.id,
        prompt: candidate.prompt,
        mode: candidate.mode,
        createdAt: candidate.createdAt,
        eventId:
          typeof candidate.eventId === "string" ? candidate.eventId : undefined,
        permissionMode:
          normalizeCodeAgentPermissionMode(candidate.permissionMode) ??
          undefined,
        source:
          typeof candidate.source === "string" ? candidate.source : undefined,
      } satisfies CodeAgentPendingFollowUp;
    })
    .filter((item): item is CodeAgentPendingFollowUp => Boolean(item));
}

function touchCodeAgentRunRecord(runId: string, updatedAt: string): void {
  const record = readRunFile(codeAgentRunRecordPath(runId));
  if (!record) return;
  writeCodeAgentRunRecord({ ...record, updatedAt });
}

function readRunFile(filePath: string): CodeAgentRunRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Partial<CodeAgentRunRecord>;
    if (
      record.schemaVersion !== 1 ||
      typeof record.id !== "string" ||
      typeof record.goalId !== "string" ||
      typeof record.title !== "string" ||
      typeof record.status !== "string" ||
      typeof record.cwd !== "string" ||
      typeof record.createdAt !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      return null;
    }
    return record as CodeAgentRunRecord;
  } catch {
    return null;
  }
}

function readTranscriptLine(line: string): CodeAgentTranscriptEvent | null {
  try {
    const raw = JSON.parse(line) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const event = raw as Partial<CodeAgentTranscriptEvent> & {
      type?: unknown;
      role?: unknown;
      text?: unknown;
      content?: unknown;
    };
    const kind = isTranscriptEventKind(event.kind)
      ? event.kind
      : normalizeTranscriptKind(event.type ?? event.role);
    const message =
      typeof event.message === "string"
        ? event.message
        : typeof event.text === "string"
          ? event.text
          : typeof event.content === "string"
            ? event.content
            : undefined;
    if (
      event.schemaVersion !== 1 ||
      typeof event.id !== "string" ||
      typeof event.runId !== "string" ||
      !kind ||
      typeof message !== "string" ||
      typeof event.createdAt !== "string"
    ) {
      return null;
    }
    return {
      ...(event as Partial<CodeAgentTranscriptEvent>),
      kind,
      message,
    } as CodeAgentTranscriptEvent;
  } catch {
    return null;
  }
}

function normalizeTranscriptKind(
  value: unknown,
): CodeAgentTranscriptEventKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "human" || normalized === "prompt") return "user";
  if (normalized === "assistant") return "system";
  if (isTranscriptEventKind(normalized)) return normalized;
  return null;
}

function isTranscriptEventKind(
  value: unknown,
): value is CodeAgentTranscriptEventKind {
  return (
    value === "user" ||
    value === "system" ||
    value === "note" ||
    value === "artifact" ||
    value === "status"
  );
}

function timestampSlug(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}
