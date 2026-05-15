import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

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
  details?: CodeAgentRunDetail[];
  artifactRoot?: string;
  surfaceUrl?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
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
  details?: CodeAgentRunDetail[];
  artifactRoot?: string;
  surfaceUrl?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
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

export function writeCodeAgentRunRecord(record: CodeAgentRunRecord): void {
  fs.mkdirSync(codeAgentRunsDir(), { recursive: true });
  fs.writeFileSync(
    path.join(codeAgentRunsDir(), `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
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

function timestampSlug(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}
