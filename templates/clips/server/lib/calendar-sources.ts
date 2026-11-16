/**
 * Which calendars Clips reads in each connected Google account.
 *
 * An account starts with only its main calendar on. Turning another calendar
 * on adds its Google id to `calendar_accounts.enabled_calendar_ids_json`; the
 * main calendar is stored as "primary", the alias Google accepts for it.
 */

import {
  listCalendarList,
  listEvents,
  type CalendarEvent,
  type CalendarListEntry,
} from "./google-calendar-client.js";

export const PRIMARY_CALENDAR_ID = "primary";

// Free/busy-only calendars return busy blocks with no title or attendees.
const READABLE_ACCESS_ROLES = new Set(["owner", "writer", "reader"]);

export interface CalendarSourceSetting {
  enabledCalendarIdsJson?: string | null;
}

export interface CalendarChoice {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  enabled: boolean;
}

export interface CalendarEventFromSource {
  calendarId: string;
  event: CalendarEvent;
}

/** The calendars Clips reads for an account, main calendar first. */
export function enabledCalendarIds(account: CalendarSourceSetting): string[] {
  const raw = account.enabledCalendarIdsJson;
  if (raw == null) return [PRIMARY_CALENDAR_ID];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [PRIMARY_CALENDAR_ID];
  }
  if (!Array.isArray(parsed)) return [PRIMARY_CALENDAR_ID];
  const ids = [
    ...new Set(
      parsed.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  return ids.sort(
    (a, b) =>
      Number(b === PRIMARY_CALENDAR_ID) - Number(a === PRIMARY_CALENDAR_ID),
  );
}

export function isCalendarEnabled(
  account: CalendarSourceSetting,
  calendarId: string,
): boolean {
  return enabledCalendarIds(account).includes(calendarId);
}

/** The account's readable calendars, main calendar first, with their switch state. */
export function calendarChoices(
  entries: CalendarListEntry[],
  account: CalendarSourceSetting,
): CalendarChoice[] {
  const enabled = new Set(enabledCalendarIds(account));
  return entries
    .filter(
      (entry) =>
        !!entry.id && READABLE_ACCESS_ROLES.has(entry.accessRole ?? ""),
    )
    .map((entry) => {
      const id = entry.primary ? PRIMARY_CALENDAR_ID : entry.id;
      return {
        id,
        name: entry.summaryOverride || entry.summary || entry.id,
        color: entry.backgroundColor ?? null,
        primary: entry.primary === true,
        enabled: enabled.has(id),
      };
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

export async function listCalendarChoices(args: {
  account: CalendarSourceSetting;
  accessToken: string;
}): Promise<CalendarChoice[]> {
  const entries = await listCalendarList({ accessToken: args.accessToken });
  return calendarChoices(entries, args.account);
}

// A calendar removed from the account since it was turned on.
function isGoneCalendarError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed \((404|410)\)/.test(message);
}

// The same meeting can sit on several calendars of one account.
function sameMeetingKey(event: CalendarEvent): string {
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  return `${event.iCalUID ?? event.id}|${start}`;
}

/**
 * Read the events of every calendar turned on for the account. A meeting on
 * more than one of them is kept once, from the first calendar (the main one
 * when it is on). Throws when every calendar failed; when only some did,
 * returns the others' events and the first failure as `error`.
 */
export async function listEnabledCalendarEvents(args: {
  account: CalendarSourceSetting;
  accessToken: string;
  timeMin: string;
  timeMax: string;
  maxResults: number;
}): Promise<{
  items: CalendarEventFromSource[];
  capped: boolean;
  error?: unknown;
}> {
  const calendarIds = enabledCalendarIds(args.account);
  const reads = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const [read] = await Promise.allSettled([
        listEvents({
          accessToken: args.accessToken,
          calendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          maxResults: args.maxResults,
        }),
      ]);
      return { calendarId, read };
    }),
  );

  const items: CalendarEventFromSource[] = [];
  const seen = new Set<string>();
  let capped = false;
  let error: unknown;
  let failed = 0;
  for (const { calendarId, read } of reads) {
    if (read.status === "rejected") {
      if (
        calendarId !== PRIMARY_CALENDAR_ID &&
        isGoneCalendarError(read.reason)
      ) {
        continue;
      }
      failed += 1;
      error ??= read.reason;
      continue;
    }
    if (read.value.nextPageToken) capped = true;
    for (const event of read.value.items) {
      const key = sameMeetingKey(event);
      if (seen.has(key)) continue;
      // A cancelled copy never hides a live one read later.
      if (event.status !== "cancelled") seen.add(key);
      items.push({ calendarId, event });
    }
  }

  if (failed > 0 && failed === calendarIds.length) throw error;
  return { items, capped, error };
}
