import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { codeAgentStoreRoot } from "./code-agent-runs.js";

export type CodeAgentScheduleScope = "global" | "thread";
export type CodeAgentScheduleStatus = "queued" | "completed" | "errored";

export interface CodeAgentScheduleRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  prompt: string;
  scope: CodeAgentScheduleScope;
  targetRunId?: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastStatus?: CodeAgentScheduleStatus;
  lastError?: string;
  lastTriggeredRunId?: string;
  createdByRunId?: string;
}

export interface CreateCodeAgentScheduleInput {
  name: string;
  prompt: string;
  scope?: CodeAgentScheduleScope;
  targetRunId?: string;
  intervalMinutes: number;
  enabled?: boolean;
  createdByRunId?: string;
  now?: Date;
}

export interface UpdateCodeAgentScheduleInput {
  name?: string;
  prompt?: string;
  scope?: CodeAgentScheduleScope;
  targetRunId?: string | null;
  intervalMinutes?: number;
  enabled?: boolean;
}

export interface CodeAgentScheduleRunPatch {
  lastRunAt: string;
  lastStatus: CodeAgentScheduleStatus;
  nextRunAt?: string;
  lastError?: string | null;
  lastTriggeredRunId?: string;
}

const SCHEDULE_FILE_NAME = "schedules.json";
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 31 * 24 * 60;

export function codeAgentSchedulesPath(): string {
  return path.join(codeAgentStoreRoot(), SCHEDULE_FILE_NAME);
}

export function listCodeAgentSchedules(): CodeAgentScheduleRecord[] {
  const records = readScheduleFile();
  return records.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.nextRunAt.localeCompare(b.nextRunAt);
  });
}

export function getCodeAgentSchedule(
  scheduleId: string,
): CodeAgentScheduleRecord | null {
  return (
    readScheduleFile().find((schedule) => schedule.id === scheduleId) ?? null
  );
}

export function createCodeAgentSchedule(
  input: CreateCodeAgentScheduleInput,
): CodeAgentScheduleRecord {
  const name = normalizeRequiredText(input.name, "Schedule name");
  const prompt = normalizeRequiredText(input.prompt, "Schedule prompt");
  const scope = input.scope ?? "global";
  if (scope !== "global" && scope !== "thread") {
    throw new Error("Schedule scope must be global or thread.");
  }
  const targetRunId = normalizeOptionalText(input.targetRunId);
  if (scope === "thread" && !targetRunId) {
    throw new Error("Thread schedules require a target run.");
  }
  const intervalMinutes = normalizeIntervalMinutes(input.intervalMinutes);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const record: CodeAgentScheduleRecord = {
    schemaVersion: 1,
    id: `schedule-${timestampSlug(nowIso)}-${crypto.randomUUID().slice(0, 8)}`,
    name,
    prompt,
    scope,
    ...(targetRunId ? { targetRunId } : {}),
    intervalMinutes,
    enabled: input.enabled ?? true,
    createdAt: nowIso,
    updatedAt: nowIso,
    nextRunAt: new Date(now.getTime() + intervalMinutes * 60_000).toISOString(),
    ...(input.createdByRunId
      ? { createdByRunId: normalizeOptionalText(input.createdByRunId) }
      : {}),
  };
  writeScheduleFile([...readScheduleFile(), record]);
  return record;
}

export function updateCodeAgentSchedule(
  scheduleId: string,
  input: UpdateCodeAgentScheduleInput,
): CodeAgentScheduleRecord | null {
  const schedules = readScheduleFile();
  const current = schedules.find((schedule) => schedule.id === scheduleId);
  if (!current) return null;

  const nextScope = input.scope ?? current.scope;
  if (nextScope !== "global" && nextScope !== "thread") {
    throw new Error("Schedule scope must be global or thread.");
  }
  const nextTargetRunId =
    input.targetRunId === null
      ? undefined
      : normalizeOptionalText(input.targetRunId ?? current.targetRunId);
  if (nextScope === "thread" && !nextTargetRunId) {
    throw new Error("Thread schedules require a target run.");
  }
  const intervalChanged = input.intervalMinutes !== undefined;
  const intervalMinutes = intervalChanged
    ? normalizeIntervalMinutes(input.intervalMinutes)
    : current.intervalMinutes;
  const now = new Date();
  const next: CodeAgentScheduleRecord = {
    ...current,
    ...(input.name !== undefined
      ? { name: normalizeRequiredText(input.name, "Schedule name") }
      : {}),
    ...(input.prompt !== undefined
      ? { prompt: normalizeRequiredText(input.prompt, "Schedule prompt") }
      : {}),
    scope: nextScope,
    ...(nextTargetRunId ? { targetRunId: nextTargetRunId } : {}),
    ...(nextTargetRunId ? {} : { targetRunId: undefined }),
    intervalMinutes,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    updatedAt: now.toISOString(),
    ...(intervalChanged
      ? {
          nextRunAt: new Date(
            now.getTime() + intervalMinutes * 60_000,
          ).toISOString(),
        }
      : {}),
  };
  writeScheduleFile(
    schedules.map((schedule) => (schedule.id === scheduleId ? next : schedule)),
  );
  return next;
}

export function deleteCodeAgentSchedule(scheduleId: string): boolean {
  const schedules = readScheduleFile();
  const next = schedules.filter((schedule) => schedule.id !== scheduleId);
  if (next.length === schedules.length) return false;
  writeScheduleFile(next);
  return true;
}

export function markCodeAgentScheduleRun(
  scheduleId: string,
  patch: CodeAgentScheduleRunPatch,
): CodeAgentScheduleRecord | null {
  const schedules = readScheduleFile();
  const current = schedules.find((schedule) => schedule.id === scheduleId);
  if (!current) return null;
  const next: CodeAgentScheduleRecord = {
    ...current,
    updatedAt: new Date().toISOString(),
    lastRunAt: patch.lastRunAt,
    lastStatus: patch.lastStatus,
    ...(patch.nextRunAt ? { nextRunAt: patch.nextRunAt } : {}),
    ...(patch.lastError
      ? { lastError: patch.lastError }
      : { lastError: undefined }),
    ...(patch.lastTriggeredRunId
      ? { lastTriggeredRunId: patch.lastTriggeredRunId }
      : {}),
  };
  writeScheduleFile(
    schedules.map((schedule) => (schedule.id === scheduleId ? next : schedule)),
  );
  return next;
}

export function isCodeAgentScheduleDue(
  schedule: CodeAgentScheduleRecord,
  now = new Date(),
): boolean {
  return schedule.enabled && Date.parse(schedule.nextRunAt) <= now.getTime();
}

export function nextCodeAgentScheduleRunAt(
  schedule: CodeAgentScheduleRecord,
  now = new Date(),
): string {
  const intervalMs = schedule.intervalMinutes * 60_000;
  let next = Date.parse(schedule.nextRunAt);
  if (!Number.isFinite(next)) next = now.getTime() + intervalMs;
  while (next <= now.getTime()) next += intervalMs;
  return new Date(next).toISOString();
}

function readScheduleFile(): CodeAgentScheduleRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(codeAgentSchedulesPath(), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(isScheduleRecord);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") return [];
    console.warn(
      "[code-agent-schedules] Could not read schedule file:",
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

function writeScheduleFile(records: CodeAgentScheduleRecord[]): void {
  const filePath = codeAgentSchedulesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(records, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function isScheduleRecord(value: unknown): value is CodeAgentScheduleRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CodeAgentScheduleRecord>;
  return (
    record.schemaVersion === 1 &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.prompt === "string" &&
    (record.scope === "global" || record.scope === "thread") &&
    (record.scope !== "thread" || typeof record.targetRunId === "string") &&
    typeof record.intervalMinutes === "number" &&
    record.intervalMinutes >= MIN_INTERVAL_MINUTES &&
    record.intervalMinutes <= MAX_INTERVAL_MINUTES &&
    typeof record.enabled === "boolean" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.nextRunAt === "string"
  );
}

function normalizeRequiredText(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized.slice(0, 8_000);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 256) : undefined;
}

function normalizeIntervalMinutes(value: unknown): number {
  const interval = Number(value);
  if (
    !Number.isInteger(interval) ||
    interval < MIN_INTERVAL_MINUTES ||
    interval > MAX_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Interval must be a whole number between ${MIN_INTERVAL_MINUTES} minute and ${MAX_INTERVAL_MINUTES / (24 * 60)} days.`,
    );
  }
  return interval;
}

function timestampSlug(value: string): string {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}
