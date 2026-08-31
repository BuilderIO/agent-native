export type AutomationSchedulePreset =
  | "hourly"
  | "daily-midnight"
  | "daily-noon"
  | "weekdays"
  | "weekly"
  | "custom";

export type AutomationScheduleUnit = "hour" | "day" | "week" | "month";

export interface AutomationScheduleDraft {
  preset: AutomationSchedulePreset;
  time: string;
  weekday: number;
  interval: number;
  unit: AutomationScheduleUnit;
  monthDay: number;
}

export interface ParsedAutomationSchedule {
  draft: AutomationScheduleDraft;
  recognized: boolean;
}

export const AUTOMATION_WEEKDAYS = [
  { value: 0, short: "Sun" },
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
] as const;

export const DEFAULT_AUTOMATION_SCHEDULE_DRAFT: AutomationScheduleDraft = {
  preset: "hourly",
  time: "09:00",
  weekday: 0,
  interval: 1,
  unit: "day",
  monthDay: 1,
};

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function timeParts(value: string): { minute: number; hour: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { minute: 0, hour: 9 };
  return {
    hour: boundedInteger(Number(match[1]), 0, 23),
    minute: boundedInteger(Number(match[2]), 0, 59),
  };
}

function cronTime(value: string): string {
  const { minute, hour } = timeParts(value);
  return `${minute} ${hour}`;
}

function normalizeDraft(
  draft: AutomationScheduleDraft,
): AutomationScheduleDraft {
  return {
    ...draft,
    time: /^\d{2}:\d{2}$/.test(draft.time) ? draft.time : "09:00",
    weekday: boundedInteger(draft.weekday, 0, 6),
    interval: boundedInteger(draft.interval, 1, 31),
    monthDay: boundedInteger(draft.monthDay, 1, 31),
  };
}

export function automationScheduleToCron(draft: AutomationScheduleDraft): {
  schedule?: string;
  error?: "weekly-interval";
} {
  const next = normalizeDraft(draft);
  if (next.preset === "hourly") return { schedule: "0 * * * *" };

  const time = cronTime(next.time);
  if (next.preset === "daily-midnight") return { schedule: "0 0 * * *" };
  if (next.preset === "daily-noon") return { schedule: "0 12 * * *" };
  if (next.preset === "weekdays") return { schedule: `${time} * * 1-5` };
  if (next.preset === "weekly") {
    return { schedule: `${time} * * ${next.weekday}` };
  }

  if (next.unit === "hour") {
    const hours = next.interval === 1 ? "*" : `*/${next.interval}`;
    return {
      schedule: `${timeParts(next.time).minute} ${hours} * * *`,
    };
  }
  if (next.unit === "day") {
    const days = next.interval === 1 ? "*" : `*/${next.interval}`;
    return { schedule: `${time} ${days} * *` };
  }
  if (next.unit === "week") {
    if (next.interval !== 1) return { error: "weekly-interval" };
    return { schedule: `${time} * * ${next.weekday}` };
  }
  const months = next.interval === 1 ? "*" : `*/${next.interval}`;
  return {
    schedule: `${time} ${next.monthDay} ${months} *`,
  };
}

function numeric(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function timeFromCron(minute: string, hour: string): string | null {
  const parsedMinute = numeric(minute);
  const parsedHour = numeric(hour);
  if (
    parsedMinute === null ||
    parsedHour === null ||
    parsedMinute > 59 ||
    parsedHour > 23
  ) {
    return null;
  }
  return `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

export function automationScheduleDraftFromCron(
  value: string,
): ParsedAutomationSchedule {
  const fallback = { ...DEFAULT_AUTOMATION_SCHEDULE_DRAFT };
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return { draft: fallback, recognized: false };
  if (value.trim() === "0 * * * *") {
    return { draft: { ...fallback, preset: "hourly" }, recognized: true };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const time = timeFromCron(minute, hour);
  if (time && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const preset =
      time === "00:00"
        ? "daily-midnight"
        : time === "12:00"
          ? "daily-noon"
          : "custom";
    return {
      draft: { ...fallback, preset, time, unit: "day" },
      recognized: true,
    };
  }

  if (time && dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return {
      draft: { ...fallback, preset: "weekdays", time },
      recognized: true,
    };
  }

  if (time && dayOfMonth === "*" && month === "*" && /^\d$/.test(dayOfWeek)) {
    return {
      draft: {
        ...fallback,
        preset: "weekly",
        time,
        weekday: Number(dayOfWeek),
      },
      recognized: true,
    };
  }

  const hourlyInterval = /^\*\/(\d+)$/.exec(hour);
  const minuteValue = numeric(minute);
  if (
    minuteValue !== null &&
    minuteValue <= 59 &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*" &&
    hourlyInterval
  ) {
    return {
      draft: {
        ...fallback,
        preset: "custom",
        time: `00:${String(minuteValue).padStart(2, "0")}`,
        unit: "hour",
        interval: Number(hourlyInterval[1]),
      },
      recognized: true,
    };
  }

  const dailyInterval = /^\*\/(\d+)$/.exec(dayOfMonth);
  if (time && month === "*" && dayOfWeek === "*" && dailyInterval) {
    return {
      draft: {
        ...fallback,
        preset: "custom",
        time,
        unit: "day",
        interval: Number(dailyInterval[1]),
      },
      recognized: true,
    };
  }

  const day = numeric(dayOfMonth);
  const monthInterval = /^\*\/(\d+)$/.exec(month);
  if (
    time &&
    day !== null &&
    day >= 1 &&
    day <= 31 &&
    monthInterval &&
    dayOfWeek === "*"
  ) {
    return {
      draft: {
        ...fallback,
        preset: "custom",
        time,
        unit: "month",
        interval: Number(monthInterval[1]),
        monthDay: day,
      },
      recognized: true,
    };
  }

  return { draft: fallback, recognized: false };
}

export function formatAutomationTime(value: string): string {
  const { hour, minute } = timeParts(value);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}
