import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { fail } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import type { ContactMeeting, ContactMeetings } from "../../shared/types.js";
import { calendarListEvents } from "./google-api.js";
import { getClientsWithErrors } from "./google-auth.js";
import { peerAppTarget, peerAppUrl } from "./peer-apps.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 60;
const PAST_DAYS = 90;
const PAST_WINDOW_DAYS = [14, PAST_DAYS];
const CALENDAR_DEADLINE_MS = 5_000;
const CALENDAR_MAX_PAGES = 3;
const NOT_MEETINGS = new Set([
  "workingLocation",
  "outOfOffice",
  "focusTime",
  "birthday",
]);

const calendarInventorySchema = z.object({
  resolvedAccounts: z.array(z.string()),
  accounts: z.array(
    z.object({
      accountEmail: z.string(),
      status: z.enum(["ok", "error"]),
      error: z.object({ message: z.string() }).optional(),
    }),
  ),
  sourceCoverage: z.array(
    z.object({
      source: z.string(),
      status: z.string(),
      error: z.object({ code: z.string() }).optional(),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      allDay: z.boolean(),
      eventType: z.string().optional(),
      status: z.string().optional(),
      accountEmail: z.string().optional(),
      calendarSourceKey: z.string().optional(),
      organizer: z.object({ email: z.string().optional() }).optional(),
      attendees: z.array(z.object({ email: z.string().optional() })),
      attendeesComplete: z.boolean(),
    }),
  ),
  page: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
  }),
});

type CalendarInventory = z.infer<typeof calendarInventorySchema>;
type CalendarItem = CalendarInventory["items"][number];
type CalendarAuth = Awaited<ReturnType<typeof resolveA2ACallerAuth>> & {
  userEmail: string;
};
type FoundMeetings = Pick<
  ContactMeetings,
  "upcoming" | "recent" | "failedAccounts"
>;

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  status?: string;
  eventType?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string };
  creator?: { email?: string };
  attendees?: Array<{ email?: string }>;
};

class CalendarSkipped extends Error {
  constructor(
    readonly state: "not_connected" | "unavailable",
    readonly reason?: unknown,
  ) {
    super(
      state === "not_connected"
        ? "Google Calendar isn't connected in Calendar."
        : "Calendar couldn't be read.",
    );
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function sameEmail(value: string | undefined, email: string) {
  return value?.trim().toLowerCase() === email;
}

async function readCalendarPage(
  auth: CalendarAuth,
  input: Record<string, unknown>,
): Promise<CalendarInventory> {
  let response: Awaited<ReturnType<typeof invokeAgentAction>>;
  try {
    response = await invokeAgentAction({
      target: peerAppTarget("calendar"),
      selfAppId: "mail",
      action: "list-events",
      input,
      userEmail: auth.userEmail,
      ...(auth.orgDomain ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs: CALENDAR_DEADLINE_MS,
    });
  } catch (error) {
    throw new CalendarSkipped("unavailable", error);
  }
  const { result } = response;
  if (result.status !== "completed") {
    throw new CalendarSkipped("unavailable", new Error(result.output));
  }
  let output: unknown;
  try {
    output = JSON.parse(result.output);
  } catch (error) {
    throw new CalendarSkipped("unavailable", error);
  }
  const parsed = calendarInventorySchema.safeParse(output);
  if (!parsed.success) {
    throw new CalendarSkipped("unavailable", parsed.error);
  }
  const inventory = parsed.data;
  const notConnected = inventory.sourceCoverage.some(
    (entry) =>
      entry.source === "google" && entry.error?.code === "NOT_CONNECTED",
  );
  if (notConnected || inventory.resolvedAccounts.length === 0) {
    throw new CalendarSkipped("not_connected");
  }
  if (
    inventory.accounts.length > 0 &&
    inventory.accounts.every((account) => account.status === "error")
  ) {
    throw new CalendarSkipped(
      "unavailable",
      new Error(
        inventory.accounts
          .map(
            (account) => `${account.accountEmail}: ${account.error?.message}`,
          )
          .join("; "),
      ),
    );
  }
  return inventory;
}

async function readCalendarRange(
  auth: CalendarAuth,
  email: string,
  from: Date,
  to: Date,
  firstPageOnly: boolean,
) {
  const items: CalendarItem[] = [];
  const failed = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < CALENDAR_MAX_PAGES; page += 1) {
    const inventory = await readCalendarPage(auth, {
      from: from.toISOString(),
      to: to.toISOString(),
      query: email,
      sources: ["google"],
      format: "inventory",
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...inventory.items);
    for (const account of inventory.accounts) {
      if (account.status === "error") {
        failed.set(
          account.accountEmail,
          account.error?.message ?? "Calendar read failed",
        );
      }
    }
    if (firstPageOnly || !inventory.page.hasMore) return { items, failed };
    cursor = inventory.page.nextCursor;
    if (!cursor) break;
  }
  throw new CalendarSkipped(
    "unavailable",
    new Error(
      `Calendar returned more than ${CALENDAR_MAX_PAGES} pages of events with ${email}`,
    ),
  );
}

function calendarMeeting(
  item: CalendarItem,
  email: string,
  calendarUrl: string | undefined,
): ContactMeeting | undefined {
  if (item.status === "cancelled") return undefined;
  if (item.eventType && NOT_MEETINGS.has(item.eventType)) return undefined;
  const withPerson =
    sameEmail(item.organizer?.email, email) ||
    item.attendees.some((attendee) => sameEmail(attendee.email, email)) ||
    !item.attendeesComplete;
  if (!withPerson) return undefined;
  const link = buildDeepLink({
    app: "calendar",
    view: "calendar",
    params: {
      eventId: item.id,
      date: item.start.slice(0, 10),
      calendarSourceKey: item.calendarSourceKey,
    },
  });
  return {
    id: item.id,
    title: item.title,
    start: item.start,
    end: item.end,
    allDay: item.allDay,
    ...(calendarUrl ? { url: `${calendarUrl}${link}` } : {}),
    ...(item.accountEmail ? { accountEmail: item.accountEmail } : {}),
  };
}

function googleMeeting(
  event: GoogleCalendarEvent,
  email: string,
  accountEmail: string,
): ContactMeeting | undefined {
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!event.id || !start || !end || event.status === "cancelled") {
    return undefined;
  }
  if (event.eventType && NOT_MEETINGS.has(event.eventType)) return undefined;
  const withPerson =
    sameEmail(event.organizer?.email, email) ||
    sameEmail(event.creator?.email, email) ||
    (event.attendees ?? []).some((attendee) =>
      sameEmail(attendee.email, email),
    );
  if (!withPerson) return undefined;
  return {
    id: event.id,
    title: event.summary ?? "",
    start,
    end,
    allDay: !event.start?.dateTime,
    ...(event.htmlLink ? { url: event.htmlLink } : {}),
    accountEmail,
  };
}

function splitMeetings(meetings: ContactMeeting[], now: Date, limit: number) {
  const unique = new Map<string, ContactMeeting>();
  for (const meeting of meetings) {
    const key = `${meeting.start}|${meeting.end}|${meeting.title}`;
    if (!unique.has(key)) unique.set(key, meeting);
  }
  const all = [...unique.values()];
  const startOf = (meeting: ContactMeeting) => Date.parse(meeting.start);
  const isOver = (meeting: ContactMeeting) =>
    Date.parse(meeting.end) <= now.getTime();
  return {
    upcoming: all
      .filter((meeting) => !isOver(meeting))
      .sort((a, b) => startOf(a) - startOf(b))
      .slice(0, limit),
    recent: all
      .filter(isOver)
      .sort((a, b) => startOf(b) - startOf(a))
      .slice(0, limit),
  };
}

function failedList(failed: Map<string, string>) {
  return [...failed].map(([accountEmail, message]) => ({
    accountEmail,
    message,
  }));
}

async function readFromCalendar(
  email: string,
  now: Date,
  limit: number,
  calendarUrl: string | undefined,
): Promise<FoundMeetings> {
  const auth = await resolveA2ACallerAuth();
  const userEmail = auth.userEmail;
  if (!userEmail) throw new CalendarSkipped("unavailable");
  const signedIn = { ...auth, userEmail };
  const toMeetings = (items: CalendarItem[]) =>
    items.flatMap((item) => calendarMeeting(item, email, calendarUrl) ?? []);

  const readUpcoming = readCalendarRange(
    signedIn,
    email,
    now,
    addDays(now, UPCOMING_DAYS),
    true,
  );
  const readPast = async () => {
    const items: CalendarItem[] = [];
    const failed = new Map<string, string>();
    let to = now;
    for (const days of PAST_WINDOW_DAYS) {
      const from = addDays(now, -days);
      const range = await readCalendarRange(signedIn, email, from, to, false);
      items.push(...range.items);
      for (const [account, message] of range.failed) {
        failed.set(account, message);
      }
      if (splitMeetings(toMeetings(items), now, limit).recent.length >= limit) {
        break;
      }
      to = from;
    }
    return { items, failed };
  };

  const [upcoming, past] = await Promise.all([readUpcoming, readPast()]);
  const failed = new Map([...upcoming.failed, ...past.failed]);
  return {
    ...splitMeetings(
      toMeetings([...upcoming.items, ...past.items]),
      now,
      limit,
    ),
    failedAccounts: failedList(failed),
  };
}

function googleCalendarError(error: unknown) {
  if (error instanceof Error && "status" in error && error.status === 403) {
    return "Mail can't read this account's calendar. Reconnect the account to allow it.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function readFromMail(
  ownerEmail: string,
  email: string,
  now: Date,
  limit: number,
): Promise<FoundMeetings & { source: "mail" | "none" }> {
  const { clients, errors } = await getClientsWithErrors(ownerEmail);
  const failed = new Map(errors.map((error) => [error.email, error.error]));
  if (clients.length === 0 && failed.size === 0) {
    return { source: "none", upcoming: [], recent: [], failedAccounts: [] };
  }
  const meetings: ContactMeeting[] = [];
  await Promise.all(
    clients.map(async (client) => {
      try {
        const page = (await calendarListEvents(client.accessToken, "primary", {
          q: email,
          timeMin: addDays(now, -PAST_DAYS).toISOString(),
          timeMax: addDays(now, UPCOMING_DAYS).toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: 250,
        })) as { items?: GoogleCalendarEvent[] } | null;
        for (const event of page?.items ?? []) {
          const meeting = googleMeeting(event, email, client.email);
          if (meeting) meetings.push(meeting);
        }
      } catch (error) {
        failed.set(client.email, googleCalendarError(error));
      }
    }),
  );
  if (failed.size === clients.length + errors.length) {
    fail(
      `Couldn't read your calendars. ${failedList(failed)
        .map((account) => `${account.accountEmail}: ${account.message}`)
        .join("; ")}`,
      { statusCode: 502, errorCode: "meetings_unavailable" },
    );
  }
  return {
    source: "mail",
    ...splitMeetings(meetings, now, limit),
    failedAccounts: failedList(failed),
  };
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new CalendarSkipped(
            "unavailable",
            new Error(`Calendar didn't answer within ${ms} ms`),
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function listContactMeetings(
  email: string,
  limit: number,
): Promise<ContactMeetings> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    fail("Sign in to see your meetings with a person.", {
      statusCode: 401,
      errorCode: "unauthenticated",
    });
  }
  const now = new Date();
  const calendarUrl = peerAppUrl("calendar");
  const link = calendarUrl ? { calendarUrl } : {};
  let calendar: CalendarSkipped["state"];
  try {
    const found = await withDeadline(
      readFromCalendar(email, now, limit, calendarUrl),
      CALENDAR_DEADLINE_MS,
    );
    return { source: "calendar", calendar: "connected", ...link, ...found };
  } catch (error) {
    if (!(error instanceof CalendarSkipped)) throw error;
    calendar = error.state;
    if (error.state === "unavailable") {
      console.warn(
        "[contact-meetings] Calendar couldn't be read; using Mail's Google access instead:",
        error.reason ?? error,
      );
    }
  }
  return {
    ...(await readFromMail(ownerEmail, email, now, limit)),
    calendar,
    ...link,
  };
}
