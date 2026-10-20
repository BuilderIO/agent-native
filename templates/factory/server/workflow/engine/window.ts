import type { WorkflowNodeOfKind } from "../contract.js";
import type { RunWindow } from "./types.js";

type Schedule = WorkflowNodeOfKind<"trigger">["settings"]["schedule"];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const read: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year,
    month: read.month,
    day: read.day,
    hour: read.hour,
    minute: read.minute,
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return wall - Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
}

/** The instant a wall clock reads `hour:minute` on a calendar day in a zone; run twice so a daylight-saving jump settles. */
function instantAt(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/**
 * The latest scheduled instant strictly before `end`: a tick's own instant
 * is not "before" itself, so the digest at 08:00 Monday looks back to Friday.
 */
export function previousScheduledInstant(
  schedule: Schedule,
  timeZone: string,
  end: Date,
): Date | null {
  if ("every" in schedule) {
    return new Date(
      end.getTime() - Number.parseInt(schedule.every, 10) * MINUTE_MS,
    );
  }
  const rule =
    "daily" in schedule
      ? { at: schedule.daily.at, days: null }
      : "weekdays" in schedule
        ? { at: schedule.weekdays.at, days: [1, 2, 3, 4, 5] }
        : { at: schedule.weekly.at, days: [schedule.weekly.day] };
  const [hour, minute] = rule.at.split(":").map(Number);
  const today = localParts(end, timeZone);
  for (let back = 0; back <= 14; back += 1) {
    const date = new Date(
      Date.UTC(today.year, today.month - 1, today.day - back),
    );
    if (rule.days && !rule.days.includes(date.getUTCDay())) continue;
    const candidate = instantAt(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
      timeZone,
    );
    if (candidate.getTime() < end.getTime()) return candidate;
  }
  return null;
}

type WindowResult =
  | { ok: true; window: RunWindow }
  | { ok: false; message: string };

/**
 * The span this run covers. It starts where the last run that fired the
 * trigger ended, so downtime or a retried tick widens the window instead of
 * leaving a gap, and ends at the tick's scheduled instant. With no earlier
 * run it looks back one `lookbackMinutes` if the workflow sets one, else one
 * schedule period.
 */
export function computeRunWindow(args: {
  schedule: Schedule;
  timeZone: string;
  lastTriggerAt: string | null;
  end: Date;
  lookbackMinutes?: number;
}): WindowResult {
  const { schedule, timeZone, lastTriggerAt, end, lookbackMinutes } = args;
  if (lastTriggerAt !== null) {
    const start = new Date(lastTriggerAt);
    if (start.getTime() > end.getTime()) {
      return {
        ok: false,
        message: `The last trigger time (${lastTriggerAt}) is after this window's end (${end.toISOString()}).`,
      };
    }
    return {
      ok: true,
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        firstRun: false,
      },
    };
  }
  const start =
    lookbackMinutes === undefined
      ? previousScheduledInstant(schedule, timeZone, end)
      : new Date(end.getTime() - lookbackMinutes * MINUTE_MS);
  if (start === null) {
    return {
      ok: false,
      message: "No scheduled instant was found before this window's end.",
    };
  }
  return {
    ok: true,
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      firstRun: true,
    },
  };
}
