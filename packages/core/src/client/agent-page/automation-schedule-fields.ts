import { isValidCron } from "../../jobs/cron.js";

export type AutomationFrequency =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly";

export interface FriendlyAutomationSchedule {
  frequency: AutomationFrequency;
  hour: number;
  minute: number;
  weekday: number;
  dayOfMonth: number;
}

export const DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE: FriendlyAutomationSchedule =
  {
    frequency: "daily",
    hour: 9,
    minute: 0,
    weekday: 1,
    dayOfMonth: 1,
  };

function integerInRange(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

/** Parse only schedules whose meaning can be represented by the friendly fields. */
export function parseFriendlyAutomationSchedule(
  cron: string,
): FriendlyAutomationSchedule | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = parts;
  const minute = integerInRange(minuteField, 0, 59);
  if (minute === null || month !== "*") return null;

  if (hourField === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return {
      ...DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
      frequency: "hourly",
      minute,
    };
  }

  const hour = integerInRange(hourField, 0, 23);
  if (hour === null) return null;

  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return {
      ...DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
      frequency: "daily",
      hour,
      minute,
    };
  }

  if (
    dayOfMonth === "*" &&
    (dayOfWeek === "1-5" || dayOfWeek.toUpperCase() === "MON-FRI")
  ) {
    return {
      ...DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
      frequency: "weekdays",
      hour,
      minute,
    };
  }

  if (dayOfMonth === "*") {
    const parsedWeekday = integerInRange(dayOfWeek, 0, 7);
    if (parsedWeekday !== null) {
      return {
        ...DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
        frequency: "weekly",
        hour,
        minute,
        weekday: parsedWeekday === 7 ? 0 : parsedWeekday,
      };
    }
  }

  if (dayOfWeek === "*") {
    const parsedDay = integerInRange(dayOfMonth, 1, 31);
    if (parsedDay !== null) {
      return {
        ...DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
        frequency: "monthly",
        hour,
        minute,
        dayOfMonth: parsedDay,
      };
    }
  }

  return null;
}

/** Convert friendly fields to one deterministic, five-field cron expression. */
export function friendlyAutomationScheduleToCron(
  schedule: FriendlyAutomationSchedule,
): string {
  const minute = Math.min(59, Math.max(0, Math.trunc(schedule.minute)));
  const hour = Math.min(23, Math.max(0, Math.trunc(schedule.hour)));

  switch (schedule.frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly": {
      const weekday = Math.min(6, Math.max(0, Math.trunc(schedule.weekday)));
      return `${minute} ${hour} * * ${weekday}`;
    }
    case "monthly": {
      const day = Math.min(31, Math.max(1, Math.trunc(schedule.dayOfMonth)));
      return `${minute} ${hour} ${day} * *`;
    }
  }
}

export function isValidAutomationSchedule(cron: string): boolean {
  return isValidCron(cron);
}

export function timeValue(schedule: FriendlyAutomationSchedule): string {
  return `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
}

export function withTimeValue(
  schedule: FriendlyAutomationSchedule,
  value: string,
): FriendlyAutomationSchedule | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = integerInRange(match[1], 0, 23);
  const minute = integerInRange(match[2], 0, 59);
  return hour === null || minute === null
    ? null
    : { ...schedule, hour, minute };
}
