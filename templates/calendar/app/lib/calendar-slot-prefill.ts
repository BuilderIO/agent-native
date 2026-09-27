import type { CalendarEventDraft } from "@shared/api";
import { isCalendarTimezone } from "@shared/timezone";

export interface CalendarSlotPrefill {
  start: string;
  end: string;
  timezone: string;
}

const PREFILL_PARAMS = ["createSlot", "start", "end", "timezone"] as const;
const MIN_SLOT_MS = 5 * 60_000;
const MAX_SLOT_MS = 24 * 60 * 60_000;

export function parseCalendarSlotPrefill(
  params: URLSearchParams,
): CalendarSlotPrefill | null {
  if (PREFILL_PARAMS.some((key) => params.getAll(key).length !== 1)) {
    return null;
  }

  if (params.get("createSlot") !== "1") return null;

  const startValue = params.get("start")!;
  const endValue = params.get("end")!;
  const timezone = params.get("timezone")!;
  const start = new Date(startValue);
  const end = new Date(endValue);
  const duration = end.getTime() - start.getTime();

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start.toISOString() !== startValue ||
    end.toISOString() !== endValue ||
    duration < MIN_SLOT_MS ||
    duration > MAX_SLOT_MS ||
    !isCalendarTimezone(timezone)
  ) {
    return null;
  }

  return { start: start.toISOString(), end: end.toISOString(), timezone };
}

export function createCalendarSlotDraft(
  prefill: CalendarSlotPrefill,
  id: string,
  now = new Date().toISOString(),
): CalendarEventDraft {
  return {
    id,
    title: "",
    description: "",
    location: "",
    start: prefill.start,
    end: prefill.end,
    startTimeZone: prefill.timezone,
    endTimeZone: prefill.timezone,
    allDay: false,
    eventType: "default",
    createdAt: now,
    updatedAt: now,
  };
}
