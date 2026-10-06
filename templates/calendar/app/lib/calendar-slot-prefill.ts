import { agentNativePath } from "@agent-native/core/client/api-path";
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

export function calendarSlotDraftId(prefill: CalendarSlotPrefill): string {
  const timezone = btoa(prefill.timezone)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `slot-${Date.parse(prefill.start).toString(36)}-${Date.parse(prefill.end).toString(36)}-${timezone}`;
}

export async function createOrLoadCalendarSlotDraft(
  prefill: CalendarSlotPrefill,
  id: string,
): Promise<CalendarEventDraft> {
  const path = agentNativePath(
    `/_agent-native/application-state/calendar-draft-${id}`,
  );
  const draft = createCalendarSlotDraft(prefill, id);
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected: null, next: draft }),
  });
  if (!response.ok) throw new Error("Could not create calendar slot draft");

  const result = (await response.json()) as { changed?: unknown };
  if (result.changed === true) return draft;
  if (result.changed !== false) {
    throw new Error("Could not create calendar slot draft");
  }

  const savedResponse = await fetch(path);
  if (!savedResponse.ok) {
    throw new Error("Could not load existing calendar slot draft");
  }
  const saved = (await savedResponse.json()) as unknown;
  if (
    typeof saved !== "object" ||
    saved === null ||
    Array.isArray(saved) ||
    (saved as { id?: unknown }).id !== id
  ) {
    throw new Error("Could not load existing calendar slot draft");
  }
  return saved as CalendarEventDraft;
}
