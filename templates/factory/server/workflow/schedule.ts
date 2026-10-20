import type { WorkflowGraph, WorkflowNodeOfKind } from "./contract.js";

export type TriggerSettings = WorkflowNodeOfKind<"trigger">["settings"];
type TriggerKind = "every" | "daily" | "weekdays" | "weekly";

const SCHEDULE_ERROR_CODES = [
  "trigger_count",
  "timezone_required",
  "timezone_invalid",
  "cadence_unsupported",
  "instant_invalid",
] as const;
export type ScheduleErrorCode = (typeof SCHEDULE_ERROR_CODES)[number];

/** A schedule the job runner cannot express, or cannot express without guessing. */
export class WorkflowScheduleError extends Error {
  readonly code: ScheduleErrorCode;
  readonly nodeId?: string;

  constructor(code: ScheduleErrorCode, message: string, nodeId?: string) {
    super(message);
    this.name = "WorkflowScheduleError";
    this.code = code;
    this.nodeId = nodeId;
  }
}

export interface JobSchedule {
  cron: string;
  /** Null when the cron means the same thing in every zone (`every`, no zone set). */
  timezone: string | null;
  hasWait: boolean;
  triggerKind: TriggerKind;
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DAY_MINUTES = 24 * HOUR_MINUTES;
// A weekly trigger is the sparsest schedule: the latest instant is within a week.
const LOOKBACK_DAYS = 8;

export const SUPPORTED_CHECK_CADENCES_MINUTES = [
  5, 6, 10, 12, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440,
] as const;

const EVERY_MINUTES = { "5m": 5, "10m": 10, "15m": 15, "30m": 30, "60m": 60 };

/**
 * A cadence in minutes as cron. Only cadences that divide the hour, or whole
 * hours that divide the day, repeat evenly: a 7-minute step restarts at every
 * hour and a 5-hour step at midnight, so any other value is refused instead of
 * rounded.
 */
function cronForCadence(minutes: number, nodeId?: string): string {
  if (minutes < HOUR_MINUTES && HOUR_MINUTES % minutes === 0) {
    return `*/${minutes} * * * *`;
  }
  if (minutes === HOUR_MINUTES) return "0 * * * *";
  if (minutes === DAY_MINUTES) return "0 0 * * *";
  const hours = minutes / HOUR_MINUTES;
  if (Number.isInteger(hours) && hours < 24 && 24 % hours === 0) {
    return `0 */${hours} * * *`;
  }
  throw new WorkflowScheduleError(
    "cadence_unsupported",
    `A ${minutes}-minute cadence does not repeat evenly. Use one of ${SUPPORTED_CHECK_CADENCES_MINUTES.join(", ")} minutes.`,
    nodeId,
  );
}

function triggerKindOf(settings: TriggerSettings): TriggerKind {
  const { schedule } = settings;
  if ("every" in schedule) return "every";
  if ("daily" in schedule) return "daily";
  if ("weekdays" in schedule) return "weekdays";
  return "weekly";
}

function splitTime(at: string): { hour: number; minute: number } {
  const [hour = "", minute = ""] = at.split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

function cronForTrigger(settings: TriggerSettings): string {
  const { schedule } = settings;
  if ("every" in schedule) return cronForCadence(EVERY_MINUTES[schedule.every]);
  if ("daily" in schedule) {
    const { hour, minute } = splitTime(schedule.daily.at);
    return `${minute} ${hour} * * *`;
  }
  if ("weekdays" in schedule) {
    const { hour, minute } = splitTime(schedule.weekdays.at);
    return `${minute} ${hour} * * 1-5`;
  }
  const { hour, minute } = splitTime(schedule.weekly.at);
  return `${minute} ${hour} * * ${schedule.weekly.day}`;
}

/**
 * The cron the job file carries. With no Wait the job fires at the Trigger's
 * cadence. With one it must also wake parked items, so it fires at the check
 * cadence, or at the Trigger's own cadence when that is shorter; the engine
 * then decides on each tick whether the Trigger is due (`nextTriggerDue`).
 *
 * A time-of-day Trigger needs a zone from the node or the workflow: the same
 * "08:00" is a different instant in each, so no zone is guessed.
 */
export function deriveJobSchedule(graph: WorkflowGraph): JobSchedule {
  const triggers = graph.nodes.filter(
    (node): node is WorkflowNodeOfKind<"trigger"> => node.kind === "trigger",
  );
  const trigger = triggers[0];
  if (triggers.length !== 1 || !trigger) {
    throw new WorkflowScheduleError(
      "trigger_count",
      `A workflow has exactly one trigger, found ${triggers.length}.`,
    );
  }
  const triggerKind = triggerKindOf(trigger.settings);
  const timezone = trigger.settings.timezone ?? graph.settings.timezone ?? null;
  if (triggerKind !== "every" && timezone === null) {
    throw new WorkflowScheduleError(
      "timezone_required",
      `A ${triggerKind} trigger needs a time zone on the trigger or in the workflow settings.`,
      trigger.id,
    );
  }
  const hasWait = graph.nodes.some((node) => node.kind === "wait");
  if (!hasWait) {
    return {
      cron: cronForTrigger(trigger.settings),
      timezone,
      hasWait,
      triggerKind,
    };
  }
  const check = graph.settings.checkCadenceMinutes;
  const cadence =
    "every" in trigger.settings.schedule
      ? Math.min(EVERY_MINUTES[trigger.settings.schedule.every], check)
      : check;
  // Validated even when the Trigger is the shorter clock, so a setting that
  // cannot run is refused now and not the day the Trigger is changed.
  cronForCadence(check);
  return {
    cron: cronForCadence(cadence),
    timezone,
    hasWait,
    triggerKind,
  };
}

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      throw new WorkflowScheduleError(
        "timezone_invalid",
        `"${timezone}" is not a known time zone.`,
      );
    }
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function partsIn(timezone: string, utcMs: number): ZoneParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(utcMs))) {
    parts[part.type] = Number(part.value);
  }
  return parts as ZoneParts;
}

/** Local minus UTC, in minutes, at one instant. */
function offsetMinutesAt(timezone: string, utcMs: number): number {
  const p = partsIn(timezone, utcMs);
  const localAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((localAsUtc - Math.floor(utcMs / 1000) * 1000) / MINUTE_MS);
}

/**
 * The instant a wall-clock time falls on in a zone. A time that happens twice
 * (clocks go back) is the first one; a time that never happens (clocks jump
 * forward) is the same reading shifted by the jump. That matches how the job
 * scheduler's cron parser resolves both, so the engine and the scheduler agree
 * on the one fire of that day.
 */
function wallClockInstant(
  timezone: string,
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
): number {
  const guess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
  );
  const before = offsetMinutesAt(timezone, guess - DAY_MS);
  const after = offsetMinutesAt(timezone, guess + DAY_MS);
  const valid = [...new Set([before, after])]
    .map((offset) => guess - offset * MINUTE_MS)
    .filter(
      (instant) =>
        offsetMinutesAt(timezone, instant) === (guess - instant) / MINUTE_MS,
    );
  if (valid.length > 0) return Math.min(...valid);
  return guess - before * MINUTE_MS;
}

function toMs(value: string | Date, label: string): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new WorkflowScheduleError(
      "instant_invalid",
      `${label} is not a valid instant.`,
    );
  }
  return ms;
}

function latestScheduledInstant(
  settings: TriggerSettings,
  atMs: number,
  timezone: string | null,
): number {
  const { schedule } = settings;
  if ("every" in schedule) {
    const period = EVERY_MINUTES[schedule.every] * MINUTE_MS;
    return Math.floor(atMs / period) * period;
  }
  if (timezone === null) {
    throw new WorkflowScheduleError(
      "timezone_required",
      `A ${triggerKindOf(settings)} trigger needs a time zone.`,
    );
  }
  const time = splitTime(
    "daily" in schedule
      ? schedule.daily.at
      : "weekdays" in schedule
        ? schedule.weekdays.at
        : schedule.weekly.at,
  );
  const today = partsIn(timezone, atMs);
  for (let back = 0; back < LOOKBACK_DAYS; back += 1) {
    const day = new Date(
      Date.UTC(today.year, today.month - 1, today.day - back),
    );
    const weekday = day.getUTCDay();
    const wanted =
      "daily" in schedule ||
      ("weekdays" in schedule && weekday >= 1 && weekday <= 5) ||
      ("weekly" in schedule && weekday === schedule.weekly.day);
    if (!wanted) continue;
    const instant = wallClockInstant(
      timezone,
      {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
      },
      time,
    );
    if (instant <= atMs) return instant;
  }
  // Every kind fires at least once in LOOKBACK_DAYS, so reaching here means the
  // zone data is broken; failing beats returning a plausible instant.
  throw new WorkflowScheduleError(
    "instant_invalid",
    "No scheduled instant was found in the last eight days.",
  );
}

interface NextTriggerDueOptions {
  /**
   * How far back a Trigger that has never fired looks for an instant it
   * missed. Without a limit, enabling a morning digest at 14:00 would send it
   * at once for 08:00. Pass the check cadence so the first tick after the
   * instant still counts. Default 60 minutes.
   */
  firstRunLookbackMinutes?: number;
}

const DEFAULT_FIRST_RUN_LOOKBACK_MINUTES = 60;

/**
 * The scheduled instant the Trigger is due for, or null when it is not.
 *
 * It is the latest instant at or before `now` that comes after
 * `lastTriggerAt`, so several missed instants collapse into one fire, and a
 * tick that runs a little late still fires for the instant it belongs to. Pass
 * the instant this returned last time as `lastTriggerAt`. A retried tick gets
 * the same instant back, which is what keys it.
 *
 * `every` instants sit on a UTC grid (`every: "15m"` is :00, :15, :30, :45) and
 * ignore the zone. Time-of-day kinds follow the wall clock of `timezone`, so
 * 08:00 stays 08:00 across a clock change. `weekly.day` is 0 for Sunday.
 */
export function nextTriggerDue(
  triggerSettings: TriggerSettings,
  lastTriggerAt: string | Date | null,
  now: string | Date,
  timezone: string | null,
  options: NextTriggerDueOptions = {},
): string | null {
  const nowMs = toMs(now, "now");
  const lastMs =
    lastTriggerAt === null ? null : toMs(lastTriggerAt, "lastTriggerAt");
  const latest = latestScheduledInstant(triggerSettings, nowMs, timezone);
  if (lastMs !== null) {
    return latest > lastMs ? new Date(latest).toISOString() : null;
  }
  const lookbackMs =
    (options.firstRunLookbackMinutes ?? DEFAULT_FIRST_RUN_LOOKBACK_MINUTES) *
    MINUTE_MS;
  return latest > nowMs - lookbackMs ? new Date(latest).toISOString() : null;
}
