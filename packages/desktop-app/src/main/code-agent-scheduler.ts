import type {
  CodeAgentSchedule,
  CodeAgentScheduleListResult,
  CodeAgentScheduleResult,
} from "@shared/ipc-channels";

import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  isActiveCodeAgentRun,
  listCodeAgentRunRecords,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
  type CodeAgentPermissionMode,
} from "../../../core/src/cli/code-agent-runs.js";
import {
  createCodeAgentSchedule,
  deleteCodeAgentSchedule,
  getCodeAgentSchedule,
  isCodeAgentScheduleDue,
  listCodeAgentSchedules,
  markCodeAgentScheduleRun,
  nextCodeAgentScheduleRunAt,
  updateCodeAgentSchedule,
  type CodeAgentScheduleRecord,
} from "../../../core/src/cli/code-agent-schedules.js";

export interface DesktopCodeAgentSchedulerDeps {
  defaultCwd: () => string;
  isRunActive: (runId: string) => boolean;
  startRun: (
    runId: string,
    cwd: string,
    permissionMode?: CodeAgentPermissionMode,
  ) => void;
}

export class DesktopCodeAgentScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly deps: DesktopCodeAgentSchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 1_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  list(): CodeAgentScheduleListResult {
    return { status: "ok", schedules: listCodeAgentSchedules().map(toShared) };
  }

  create(input: unknown): CodeAgentScheduleResult {
    try {
      const payload = objectValue(input);
      const scope = payload.scope === "thread" ? "thread" : "global";
      const targetRunId = stringValue(payload.targetRunId);
      if (
        scope === "thread" &&
        (!targetRunId || !getCodeAgentRunRecord(targetRunId))
      ) {
        return {
          ok: false,
          message: "Choose an existing thread for a thread schedule.",
          error: "Target thread was not found.",
        };
      }
      const schedule = createCodeAgentSchedule({
        name: stringValue(payload.name) ?? "",
        prompt: stringValue(payload.prompt) ?? "",
        scope,
        targetRunId,
        intervalMinutes: Number(payload.intervalMinutes),
        enabled: payload.enabled !== false,
        createdByRunId: stringValue(payload.createdByRunId),
      });
      return {
        ok: true,
        schedule: toShared(schedule),
        message: "Schedule created.",
      };
    } catch (error) {
      return {
        ok: false,
        message: "Could not create schedule.",
        error: errorMessage(error),
      };
    }
  }

  update(input: unknown): CodeAgentScheduleResult {
    try {
      const payload = objectValue(input);
      const scheduleId = stringValue(payload.scheduleId);
      if (!scheduleId) {
        return {
          ok: false,
          message: "Schedule id is required.",
          error: "Missing scheduleId.",
        };
      }
      const scope =
        payload.scope === "global" || payload.scope === "thread"
          ? payload.scope
          : undefined;
      const targetRunId = stringValue(payload.targetRunId);
      if (
        scope === "thread" &&
        (!targetRunId || !getCodeAgentRunRecord(targetRunId))
      ) {
        return {
          ok: false,
          message: "Choose an existing thread for a thread schedule.",
          error: "Target thread was not found.",
        };
      }
      const schedule = updateCodeAgentSchedule(scheduleId, {
        ...(stringValue(payload.name) !== undefined
          ? { name: stringValue(payload.name) }
          : {}),
        ...(stringValue(payload.prompt) !== undefined
          ? { prompt: stringValue(payload.prompt) }
          : {}),
        ...(scope ? { scope } : {}),
        ...(payload.targetRunId !== undefined
          ? { targetRunId: targetRunId ?? null }
          : {}),
        ...(payload.intervalMinutes !== undefined
          ? { intervalMinutes: Number(payload.intervalMinutes) }
          : {}),
        ...(typeof payload.enabled === "boolean"
          ? { enabled: payload.enabled }
          : {}),
      });
      return schedule
        ? {
            ok: true,
            schedule: toShared(schedule),
            message: "Schedule updated.",
          }
        : {
            ok: false,
            message: "Schedule was not found.",
            error: `No schedule exists for ${scheduleId}.`,
          };
    } catch (error) {
      return {
        ok: false,
        message: "Could not update schedule.",
        error: errorMessage(error),
      };
    }
  }

  delete(input: unknown): CodeAgentScheduleResult {
    const scheduleId = stringValue(objectValue(input).scheduleId);
    if (!scheduleId) {
      return {
        ok: false,
        message: "Schedule id is required.",
        error: "Missing scheduleId.",
      };
    }
    const schedule = getCodeAgentSchedule(scheduleId);
    if (!schedule || !deleteCodeAgentSchedule(scheduleId)) {
      return {
        ok: false,
        message: "Schedule was not found.",
        error: `No schedule exists for ${scheduleId}.`,
      };
    }
    return {
      ok: true,
      schedule: toShared(schedule),
      message: "Schedule deleted.",
    };
  }

  async runNow(input: unknown): Promise<CodeAgentScheduleResult> {
    const scheduleId = stringValue(objectValue(input).scheduleId);
    if (!scheduleId) {
      return {
        ok: false,
        message: "Schedule id is required.",
        error: "Missing scheduleId.",
      };
    }
    const schedule = getCodeAgentSchedule(scheduleId);
    if (!schedule) {
      return {
        ok: false,
        message: "Schedule was not found.",
        error: `No schedule exists for ${scheduleId}.`,
      };
    }
    try {
      const triggered = await this.dispatchSchedule(schedule, new Date(), true);
      return {
        ok: true,
        schedule: toShared(triggered),
        message: "Schedule queued now.",
      };
    } catch (error) {
      return {
        ok: false,
        message: "Could not run schedule.",
        error: errorMessage(error),
      };
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      for (const schedule of listCodeAgentSchedules()) {
        if (!isCodeAgentScheduleDue(schedule, now)) continue;
        try {
          await this.dispatchSchedule(schedule, now, false);
        } catch (error) {
          markCodeAgentScheduleRun(schedule.id, {
            lastRunAt: now.toISOString(),
            lastStatus: "errored",
            nextRunAt: nextCodeAgentScheduleRunAt(schedule, now),
            lastError: errorMessage(error),
          });
        }
      }
      this.startQueuedAgentWork();
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchSchedule(
    schedule: CodeAgentScheduleRecord,
    now: Date,
    manual: boolean,
  ): Promise<CodeAgentScheduleRecord> {
    const nowIso = now.toISOString();
    const nextRunAt = nextCodeAgentScheduleRunAt(schedule, now);
    if (schedule.scope === "thread") {
      if (!schedule.targetRunId)
        throw new Error("Thread schedule has no target thread.");
      const target = getCodeAgentRunRecord(schedule.targetRunId);
      if (!target)
        throw new Error(`Target thread not found: ${schedule.targetRunId}`);
      const event = appendCodeAgentTranscriptEvent({
        runId: target.id,
        kind: "user",
        message: schedule.prompt,
        metadata: {
          source: "scheduled-task",
          scheduledTask: true,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          ...(manual ? { manuallyTriggered: true } : {}),
        },
      });
      const followUp = queueCodeAgentFollowUp({
        runId: target.id,
        prompt: schedule.prompt,
        mode: "queued",
        eventId: event.id,
        source: "scheduled-task",
      });
      if (!followUp) throw new Error(`Could not queue ${target.id}`);
      if (!this.deps.isRunActive(target.id) && !isActiveCodeAgentRun(target)) {
        this.deps.startRun(target.id, target.cwd, target.permissionMode);
      }
      return (
        markCodeAgentScheduleRun(schedule.id, {
          lastRunAt: nowIso,
          lastStatus: "queued",
          nextRunAt,
          lastError: null,
          lastTriggeredRunId: target.id,
        }) ?? schedule
      );
    }

    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: schedule.name,
      subtitle: "Scheduled task",
      status: "queued",
      phase: "queued",
      permissionMode: "full-auto",
      cwd: this.deps.defaultCwd(),
      metadata: {
        source: "scheduled-task",
        scheduledTask: true,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        startRequested: true,
        initialPrompt: schedule.prompt,
        ...(manual ? { manuallyTriggered: true } : {}),
      },
    });
    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "user",
      message: schedule.prompt,
      metadata: {
        source: "scheduled-task",
        scheduledTask: true,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        ...(manual ? { manuallyTriggered: true } : {}),
      },
    });
    this.deps.startRun(run.id, run.cwd, run.permissionMode);
    updateCodeAgentRunRecord(run.id, { metadata: { startRequested: false } });
    return (
      markCodeAgentScheduleRun(schedule.id, {
        lastRunAt: nowIso,
        lastStatus: "queued",
        nextRunAt,
        lastError: null,
        lastTriggeredRunId: run.id,
      }) ?? schedule
    );
  }

  private startQueuedAgentWork(): void {
    for (const run of listCodeAgentRunRecords()) {
      if (this.deps.isRunActive(run.id) || isActiveCodeAgentRun(run)) continue;
      const metadata = run.metadata ?? {};
      const pendingFollowUps = Array.isArray(metadata.pendingFollowUps)
        ? metadata.pendingFollowUps.length
        : 0;
      const shouldStart =
        metadata.startRequested === true ||
        metadata.createdByAgent === true ||
        metadata.source === "scheduled-task" ||
        pendingFollowUps > 0;
      if (!shouldStart) continue;
      this.deps.startRun(run.id, run.cwd, run.permissionMode);
      updateCodeAgentRunRecord(run.id, { metadata: { startRequested: false } });
    }
  }
}

function toShared(record: CodeAgentScheduleRecord): CodeAgentSchedule {
  return record;
}

function objectValue(input: unknown): Record<string, unknown> {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
