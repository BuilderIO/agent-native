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
const UPCOMING_WINDOW_DAYS = [14, UPCOMING_DAYS];
const PAST_WINDOW_DAYS = [14, PAST_DAYS];
const CALENDAR_DEADLINE_MS = 5_000;
const CALENDAR_MAX_PAGES = 4;
const GOOGLE_PAGE_SIZE = 250;
const GOOGLE_MAX_PAGES = 4;
const NOT_MEETINGS = new Set([
  "workingLocation",
  "outOfOffice",
  "focusTime",
  "birthday",
]);

const calendarInventorySchema = z.object({
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
      key: z.string(),
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
type Clock = { now: Date; today: string };
type Deadline = { expired: boolean };

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

function dateIn(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function readCalendarPage(
  auth: CalendarAuth,
  input: Record<string, unknown>,
  deadline: Deadline,
): Promise<CalendarInventory> {
  if (deadline.expired) {
    throw new CalendarSkipped(
      "unavailable",
      new Error("Calendar ran out of time"),
    );
  }
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
  if (
    inventory.sourceCoverage.some(
      (entry) =>
        entry.source === "google" && entry.error?.code === "NOT_CONNECTED",
    )
  ) {
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

async function readCalendarWindow(
  auth: CalendarAuth,
  email: string,
  from: Date,
  to: Date,
  deadline: Deadline,
) {
  const items: CalendarItem[] = [];
  const failed = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < CALENDAR_MAX_PAGES; page += 1) {
    const inventory = await readCalendarPage(
      auth,
      {
        from: from.toISOString(),
        to: to.toISOString(),
        query: email,
        sources: ["google"],
        format: "inventory",
        pageSize: 100,
        ...(cursor ? { cursor } : {}),
      },
      deadline,
    );
    items.push(...inventory.items);
    for (const account of inventory.accounts) {
      if (account.status === "error") {
        failed.set(
          account.accountEmail,
          account.error?.message ?? "Calendar read failed",
        );
      }
    }
    if (!inventory.page.hasMore) return { items, failed };
    cursor = inventory.page.nextCursor;
    if (!cursor) break;
  }
  throw new CalendarSkipped(
    "unavailable",
    new Error(
      `Calendar has more than ${CALENDAR_MAX_PAGES} pages of events mentioning ${email} between ${from.toISOString()} and ${to.toISOString()}`,
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
    item.attendees.some((attendee) => sameEmail(attendee.email, email));
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

function isOver(meeting: ContactMeeting, clock: Clock) {
  return meeting.allDay
    ? meeting.end.slice(0, 10) <= clock.today
    : Date.parse(meeting.end) <= clock.now.getTime();
}

function splitMeetings(meetings: ContactMeeting[], clock: Clock) {
  const unique = new Map<string, ContactMeeting>();
  for (const meeting of meetings) {
    const key = `${meeting.start}|${meeting.end}|${meeting.title}`;
    if (!unique.has(key)) unique.set(key, meeting);
  }
  const all = [...unique.values()];
  const startOf = (meeting: ContactMeeting) => Date.parse(meeting.start);
  return {
    upcoming: all
      .filter((meeting) => !isOver(meeting, clock))
      .sort((a, b) => startOf(a) - startOf(b)),
    recent: all
      .filter((meeting) => isOver(meeting, clock))
      .sort((a, b) => startOf(b) - startOf(a)),
  };
}

function firstOf(
  meetings: ReturnType<typeof splitMeetings>,
  limit: number,
): Pick<FoundMeetings, "upcoming" | "recent"> {
  return {
    upcoming: meetings.upcoming.slice(0, limit),
    recent: meetings.recent.slice(0, limit),
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
  clock: Clock,
  limit: number,
  calendarUrl: string | undefined,
  deadline: Deadline,
): Promise<FoundMeetings> {
  let auth: Awaited<ReturnType<typeof resolveA2ACallerAuth>>;
  try {
    auth = await resolveA2ACallerAuth();
  } catch (error) {
    throw new CalendarSkipped("unavailable", error);
  }
  const userEmail = auth.userEmail;
  if (!userEmail) {
    throw new CalendarSkipped(
      "unavailable",
      new Error("No signed-in user to send to Calendar"),
    );
  }
  const signedIn = { ...auth, userEmail };
  const toMeetings = (items: CalendarItem[]) =>
    items.flatMap((item) => calendarMeeting(item, email, calendarUrl) ?? []);

  const read = async (direction: "upcoming" | "recent") => {
    const items: CalendarItem[] = [];
    const failed = new Map<string, string>();
    let reached = 0;
    const windows =
      direction === "upcoming" ? UPCOMING_WINDOW_DAYS : PAST_WINDOW_DAYS;
    for (const days of windows) {
      const from =
        direction === "upcoming"
          ? addDays(clock.now, reached)
          : addDays(clock.now, -days);
      const to =
        direction === "upcoming"
          ? addDays(clock.now, days)
          : addDays(clock.now, -reached);
      const window = await readCalendarWindow(
        signedIn,
        email,
        from,
        to,
        deadline,
      );
      items.push(...window.items);
      for (const [account, message] of window.failed) {
        failed.set(account, message);
      }
      const settled = splitMeetings(toMeetings(items), clock)[direction].filter(
        (meeting) =>
          direction === "upcoming" ||
          Date.parse(meeting.start) >= from.getTime(),
      );
      if (settled.length >= limit) break;
      reached = days;
    }
    return { items, failed };
  };

  const [upcoming, past] = await Promise.all([
    read("upcoming"),
    read("recent"),
  ]);
  return {
    ...firstOf(
      splitMeetings(toMeetings([...upcoming.items, ...past.items]), clock),
      limit,
    ),
    failedAccounts: failedList(new Map([...upcoming.failed, ...past.failed])),
  };
}

function googleCalendarError(error: unknown) {
  if (error instanceof Error && "status" in error && error.status === 403) {
    return "Mail can't read this account's calendar. Reconnect the account to allow it.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function readGoogleEvents(
  accessToken: string,
  email: string,
  clock: Clock,
) {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
    const response = (await calendarListEvents(accessToken, "primary", {
      q: email,
      timeMin: addDays(clock.now, -PAST_DAYS).toISOString(),
      timeMax: addDays(clock.now, UPCOMING_DAYS).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: GOOGLE_PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    })) as {
      kind?: string;
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    } | null;
    if (response?.kind !== "calendar#events") {
      throw new Error("Google Calendar didn't return a list of events.");
    }
    events.push(...(response.items ?? []));
    pageToken = response.nextPageToken;
    if (!pageToken) return events;
  }
  throw new Error(
    `More than ${GOOGLE_MAX_PAGES * GOOGLE_PAGE_SIZE} events mention ${email}, so Mail couldn't read them all.`,
  );
}

async function readFromMail(
  ownerEmail: string,
  email: string,
  clock: Clock,
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
        const events = await readGoogleEvents(client.accessToken, email, clock);
        for (const event of events) {
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
    ...firstOf(splitMeetings(meetings, clock), limit),
    failedAccounts: failedList(failed),
  };
}

async function withDeadline<T>(
  work: (deadline: Deadline) => Promise<T>,
  ms: number,
): Promise<T> {
  const deadline: Deadline = { expired: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadline.expired = true;
      reject(
        new CalendarSkipped(
          "unavailable",
          new Error(`Calendar didn't answer within ${ms} ms`),
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([work(deadline), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function listContactMeetings(
  email: string,
  limit: number,
  timeZone = "UTC",
): Promise<ContactMeetings> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    fail("Sign in to see your meetings with a person.", {
      statusCode: 401,
      errorCode: "unauthenticated",
    });
  }
  const now = new Date();
  const clock = { now, today: dateIn(now, timeZone) };
  const calendarUrl = peerAppUrl("calendar");
  const link = calendarUrl ? { calendarUrl } : {};
  let calendar: CalendarSkipped["state"];
  try {
    const found = await withDeadline(
      (deadline) =>
        readFromCalendar(email, clock, limit, calendarUrl, deadline),
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
    ...(await readFromMail(ownerEmail, email, clock, limit)),
    calendar,
    ...link,
  };
}
