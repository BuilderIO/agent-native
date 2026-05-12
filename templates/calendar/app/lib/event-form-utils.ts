import type { CalendarEvent } from "@shared/api";

export type ReminderMethod = "popup" | "email";
export type ReminderMode = "default" | "none" | "custom";

export interface ReminderDraft {
  id: string;
  method: ReminderMethod;
  minutes: number;
}

export interface AttachmentDraft {
  id: string;
  fileUrl: string;
  title: string;
}

export const REMINDER_PRESETS = [
  { value: 0, label: "At start" },
  { value: 10, label: "10 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
  { value: 10080, label: "1 week before" },
] as const;

export const MAX_EVENT_ATTACHMENTS = 25;

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createReminderDraft(
  minutes = 10,
  method: ReminderMethod = "popup",
): ReminderDraft {
  return { id: makeId("reminder"), method, minutes };
}

export function remindersToDraftState(
  event: Pick<CalendarEvent, "reminders" | "remindersUseDefault">,
): {
  mode: ReminderMode;
  reminders: ReminderDraft[];
} {
  if (event.remindersUseDefault !== false) {
    return { mode: "default", reminders: [createReminderDraft()] };
  }
  if (!event.reminders || event.reminders.length === 0) {
    return { mode: "none", reminders: [createReminderDraft()] };
  }
  return {
    mode: "custom",
    reminders: event.reminders.map((reminder) =>
      createReminderDraft(reminder.minutes, reminder.method),
    ),
  };
}

export function buildReminderPayload(
  mode: ReminderMode,
  reminders: ReminderDraft[],
): Pick<CalendarEvent, "reminders" | "remindersUseDefault"> {
  if (mode === "default") return { remindersUseDefault: true };
  if (mode === "none") return { remindersUseDefault: false, reminders: [] };
  const normalized = reminders
    .slice(0, 5)
    .map((reminder) => ({
      method: reminder.method,
      minutes: Math.max(0, Math.min(40320, Math.round(reminder.minutes))),
    }))
    .filter((reminder) => Number.isFinite(reminder.minutes));
  return { remindersUseDefault: false, reminders: normalized };
}

export function formatReminderText(minutes: number): string {
  if (minutes === 0) return "At start";
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours} ${hours === 1 ? "hour" : "hours"} before`;
  }
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? "day" : "days"} before`;
}

export function createAttachmentDraft(): AttachmentDraft {
  return { id: makeId("attachment"), fileUrl: "", title: "" };
}

export function attachmentsToDrafts(
  attachments: CalendarEvent["attachments"] | undefined,
): AttachmentDraft[] {
  if (!attachments || attachments.length === 0)
    return [createAttachmentDraft()];
  return attachments.map((attachment) => ({
    id: makeId("attachment"),
    fileUrl: attachment.fileUrl,
    title: attachment.title,
  }));
}

function safeAttachmentTitle(fileUrl: string, title: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(fileUrl).hostname;
  } catch {
    return "Attachment";
  }
}

export function validateAttachmentDrafts(drafts: AttachmentDraft[]): {
  attachments: CalendarEvent["attachments"];
  error?: string;
} {
  const attachments: NonNullable<CalendarEvent["attachments"]> = [];
  for (const draft of drafts) {
    const fileUrl = draft.fileUrl.trim();
    const title = draft.title.trim();
    if (!fileUrl && !title) continue;
    let url: URL;
    try {
      url = new URL(fileUrl);
    } catch {
      return { attachments, error: "Attachment needs a valid URL." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        attachments,
        error: "Attachment URL must start with http or https.",
      };
    }
    attachments.push({
      fileUrl: url.toString(),
      title: safeAttachmentTitle(url.toString(), title),
    });
    if (attachments.length > MAX_EVENT_ATTACHMENTS) {
      return {
        attachments,
        error: `Google Calendar supports up to ${MAX_EVENT_ATTACHMENTS} attachments per event.`,
      };
    }
  }
  return { attachments };
}

export function getEventEndValidationMessage({
  allDay,
  startDate,
  endDate,
  startTime,
  endTime,
}: {
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}) {
  if (allDay) return "End date must be on or after the start date.";
  if (startDate === endDate && startTime && endTime) {
    return endTime <= startTime
      ? "End time must be later than start time."
      : "End date and time must be after start date and time.";
  }
  return "End date and time must be after start date and time.";
}

export function getLocalTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getTimezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );
  return asUtc - date.getTime();
}

export function dateTimeInTimezoneToIso(
  date: string,
  time: string,
  timezone: string,
) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTimeAsUtc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0),
  );
  let offset = getTimezoneOffsetMs(wallTimeAsUtc, timezone);
  let result = new Date(wallTimeAsUtc.getTime() - offset);
  offset = getTimezoneOffsetMs(result, timezone);
  result = new Date(wallTimeAsUtc.getTime() - offset);
  return result.toISOString();
}

export function formatTimezoneLabel(timezone: string) {
  const city = timezone.split("/").pop()?.replace(/_/g, " ") || timezone;
  return `${city} (${timezone})`;
}
