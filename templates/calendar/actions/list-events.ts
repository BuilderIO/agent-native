import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  getRequestTimezone,
  getRequestUserEmail,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { accessFilter } from "@agent-native/core/sharing";
import { and, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { fetchICalEvents } from "../server/lib/ical-fetcher.js";
import type { CalendarEvent, ExternalCalendar } from "../shared/api.js";
import { calendarEventMatchesQuery } from "./event-search.js";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// External ICS feeds are third-party HTTP fetches re-parsed on every
// list-events call; a short TTL avoids re-fetching/re-parsing the same feed
// + range on every poll while a calendar tab stays open. Per-process only —
// a serverless cold start just resets it, which is fine since the feed is
// re-fetched on the next call.
const ICAL_CACHE_TTL_MS = 5 * 60_000;
const icalCache = new Map<
  string,
  { events: CalendarEvent[]; fetchedAt: number }
>();

async function fetchICalEventsCached(
  cal: ExternalCalendar,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const cacheKey = `${cal.url}|${from}|${to}`;
  const cached = icalCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ICAL_CACHE_TTL_MS) {
    return cached.events;
  }
  const events = await fetchICalEvents(
    cal.id,
    cal.name,
    cal.url,
    cal.color,
    from,
    to,
    { throwOnError: true },
  );
  icalCache.set(cacheKey, { events, fetchedAt: Date.now() });
  return events;
}

interface CalendarEventRange {
  from: string;
  to: string;
  timezone: string;
  defaulted: boolean;
}

interface ListCalendarEventsArgs {
  from?: string;
  to?: string;
  query?: string;
  overlayEmails?: string | string[];
  accountEmails?: string[];
  sources?: CalendarInventorySource[];
  providerPageSize?: number;
}

interface ListCalendarEventsOptions {
  ownedAccounts?: string[];
  range?: CalendarEventRange;
}

type CalendarInventorySource = "google" | "bookings" | "ics" | "overlays";

interface CalendarEventsResult {
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string }>;
  googleConnected: boolean;
  range: CalendarEventRange;
  icalErrors: Array<{ id: string; name: string; error: string }>;
  icalSources: Array<{
    id: string;
    name: string;
    status: "ok" | "error";
    error?: string;
  }>;
  overlaySources: Array<{
    email: string;
    status: "ok" | "error";
    error?: string;
  }>;
  requestedAccounts: string[] | null;
  resolvedAccounts: string[];
  queriedAccounts: string[];
  sources: CalendarInventorySource[];
}

export interface CalendarInventoryItem {
  key: string;
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  eventType?: CalendarEvent["eventType"];
  status?: CalendarEvent["status"];
  transparency?: CalendarEvent["transparency"];
  source: "google" | "booking" | "ics" | "overlay";
  sourceId?: string;
  accountEmail?: string;
  overlayEmail?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  selfResponseStatus?: CalendarEvent["responseStatus"];
  attendeeCount: number;
  attendeeStatusCounts: Record<string, number>;
  attendees: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    optional?: boolean;
    self?: boolean;
    organizer?: boolean;
  }>;
  attendeesComplete: boolean;
}

interface InventoryCursor {
  owner: string;
  query: string;
  start: string;
  key: string;
}

const INVENTORY_VERSION = 1;
const INVENTORY_CURSOR_PREFIX = "calendar-inventory:";
const INVENTORY_PAGE_SIZE = 100;
const INVENTORY_MAX_PAGE_SIZE = 250;
const INVENTORY_ITEM_BUDGET_BYTES = 12_000;
const INVENTORY_STRING_LIMIT = 240;
const INVENTORY_ATTENDEE_PREVIEW_LIMIT = 8;

function cap(
  value: string | undefined,
  limit = INVENTORY_STRING_LIMIT,
): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function sanitizeError(message: unknown, fallback: string) {
  return (
    cap(
      String(message ?? fallback)
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(
          /\b(access_token|refresh_token|id_token|token)=([^\s&]+)/gi,
          "$1=[redacted]",
        ),
    ) ?? fallback
  );
}

function sourceCoverageError(message: string, fallback: string) {
  const bounded = sanitizeError(message, fallback);
  const notConnected = /not connected|reconnect|authentication/i.test(bounded);
  return {
    code: notConnected ? "NOT_CONNECTED" : "SOURCE_READ_FAILED",
    message: bounded,
    retryable: !notConnected,
  };
}

function normalizedEmails(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ).sort();
}

function mergeAccountErrors(
  ...groups: Array<Array<{ email: string; error: string }>>
): Array<{ email: string; error: string }> {
  return Array.from(
    new Map(
      groups
        .flat()
        .map((entry) => [
          `${entry.email.trim().toLowerCase()}\0${entry.error}`,
          entry,
        ]),
    ).values(),
  );
}

function normalizedOverlayEmails(value: string | string[] | undefined) {
  return normalizedEmails(
    Array.isArray(value)
      ? value
      : value?.split(",").map((email) => email.trim()),
  );
}

function resolveInventorySources(
  sources: CalendarInventorySource[] | undefined,
): CalendarInventorySource[] {
  return Array.from(
    new Set<CalendarInventorySource>(
      sources ?? ["google", "bookings", "ics", "overlays"],
    ),
  );
}

function inventoryQueryKey(args: {
  from: string;
  to: string;
  query?: string;
  accountEmails: string[];
  overlayEmails?: string | string[];
  sources: CalendarInventorySource[];
}): string {
  const canonical = JSON.stringify({
    v: INVENTORY_VERSION,
    from: args.from,
    to: args.to,
    query: args.query?.trim().toLowerCase() || "",
    accountEmails: normalizedEmails(args.accountEmails),
    overlayEmails: normalizedOverlayEmails(args.overlayEmails),
    sources: [...args.sources].sort(),
  });
  return createHash("sha256").update(canonical).digest("base64url");
}

function encodeInventoryCursor(cursor: InventoryCursor): string {
  const resourceId = `${INVENTORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
  return signShortLivedToken({ resourceId, ttlSeconds: 600 });
}

function decodeInventoryCursor(
  token: string,
  owner: string,
  query: string,
): InventoryCursor {
  const [payload] = token.split(".", 1);
  if (!payload) throw new Error("Invalid inventory cursor");
  let resourceId: unknown;
  try {
    resourceId = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ).resourceId;
  } catch {
    throw new Error("Invalid inventory cursor");
  }
  if (
    typeof resourceId !== "string" ||
    !resourceId.startsWith(INVENTORY_CURSOR_PREFIX)
  )
    throw new Error("Invalid inventory cursor");
  if (!verifyShortLivedToken(token, resourceId).ok)
    throw new Error("Expired or invalid inventory cursor");
  let cursor: InventoryCursor;
  try {
    cursor = JSON.parse(
      Buffer.from(
        resourceId.slice(INVENTORY_CURSOR_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    );
  } catch {
    throw new Error("Invalid inventory cursor");
  }
  if (
    cursor.owner !== owner ||
    cursor.query !== query ||
    !cursor.start ||
    !cursor.key
  )
    throw new Error("Inventory cursor does not match this query");
  return cursor;
}

function compactInventoryEvent(event: CalendarEvent): CalendarInventoryItem {
  const attendees = event.attendees ?? [];
  const attendeeStatusCounts = attendees.reduce<Record<string, number>>(
    (counts, attendee) => {
      const status = attendee.responseStatus ?? "unknown";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const key = [
    event.source,
    event.accountEmail ?? event.overlayEmail ?? "local",
    event.googleEventId ?? event.id,
    event.start,
  ].join(":");
  const source = event.overlayEmail
    ? "overlay"
    : event.source === "local"
      ? "booking"
      : event.source === "ical"
        ? "ics"
        : event.source;
  return {
    key,
    id: event.googleEventId ?? event.id,
    title: cap(event.title) ?? "Untitled",
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    eventType: event.eventType,
    status: event.status,
    transparency: event.transparency,
    source,
    sourceId: event.sourceId,
    accountEmail: event.accountEmail,
    overlayEmail: event.overlayEmail,
    organizer: event.organizer
      ? {
          email: cap(event.organizer.email, 320) ?? "",
          displayName: cap(event.organizer.displayName),
          self: event.organizer.self,
        }
      : undefined,
    selfResponseStatus: event.responseStatus,
    attendeeCount: attendees.length,
    attendeeStatusCounts,
    attendees: attendees
      .slice(0, INVENTORY_ATTENDEE_PREVIEW_LIMIT)
      .map((attendee) => ({
        email: cap(attendee.email, 320) ?? "",
        displayName: cap(attendee.displayName),
        responseStatus: attendee.responseStatus,
        optional: attendee.optional,
        self: attendee.self,
        organizer: attendee.organizer,
      })),
    attendeesComplete: attendees.length <= INVENTORY_ATTENDEE_PREVIEW_LIMIT,
  };
}

function normalizeTimezone(timezone?: string): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function datePartsInTimezone(date: Date, timezone: string) {
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
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function dateOnlyInTimezone(date: Date, timezone: string): string {
  const parts = datePartsInTimezone(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function offsetMsForTimezone(date: Date, timezone: string): number {
  const parts = datePartsInTimezone(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

function zonedDateOnlyToUtcIso(dateOnly: string, timezone: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstGuess = new Date(wallClockUtc);
  const firstOffset = offsetMsForTimezone(firstGuess, timezone);
  const secondGuess = new Date(wallClockUtc - firstOffset);
  const secondOffset = offsetMsForTimezone(secondGuess, timezone);
  return new Date(wallClockUtc - secondOffset).toISOString();
}

function normalizeDateBound(value: string, timezone: string): string {
  if (DATE_ONLY_RE.test(value)) {
    return zonedDateOnlyToUtcIso(value, timezone);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.toISOString();
}

export function resolveCalendarEventRange(args: {
  from?: string;
  to?: string;
  timezone?: string;
}): CalendarEventRange {
  const timezone = normalizeTimezone(args.timezone ?? getRequestTimezone());
  const today = dateOnlyInTimezone(new Date(), timezone);
  let from = args.from?.trim();
  let to = args.to?.trim();
  let defaulted = false;

  if (!from && !to) {
    from = today;
    to = addDaysToDateOnly(today, 1);
    defaulted = true;
  } else if (from && !to) {
    if (DATE_ONLY_RE.test(from)) {
      to = addDaysToDateOnly(from, 1);
    } else {
      const start = new Date(from);
      if (Number.isNaN(start.getTime())) {
        throw new Error(`Invalid date: ${from}`);
      }
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      to = end.toISOString();
    }
    defaulted = true;
  } else if (!from && to) {
    from = today;
    defaulted = true;
  }

  const normalizedFrom = normalizeDateBound(from!, timezone);
  const normalizedTo = normalizeDateBound(to!, timezone);
  if (new Date(normalizedFrom).getTime() >= new Date(normalizedTo).getTime()) {
    throw new Error("from must be before to");
  }
  return {
    from: normalizedFrom,
    to: normalizedTo,
    timezone,
    defaulted,
  };
}

async function listLocalBookingEvents(
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const db = getDb();
  const links = await db
    .select({
      slug: schema.bookingLinks.slug,
      title: schema.bookingLinks.title,
      color: schema.bookingLinks.color,
    })
    .from(schema.bookingLinks)
    .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));

  const slugs = links.map((link) => link.slug);
  if (slugs.length === 0) return [];

  const linkBySlug = new Map(links.map((link) => [link.slug, link]));
  const rows = await db
    // Project only the columns the event mapper reads — skip the heavy
    // field_responses JSON blob (and other unused columns) that a bare
    // .select() would pull for every booking on this hot calendar path.
    .select({
      id: schema.bookings.id,
      name: schema.bookings.name,
      email: schema.bookings.email,
      slug: schema.bookings.slug,
      start: schema.bookings.start,
      end: schema.bookings.end,
      eventTitle: schema.bookings.eventTitle,
      notes: schema.bookings.notes,
      meetingLink: schema.bookings.meetingLink,
      googleEventId: schema.bookings.googleEventId,
      status: schema.bookings.status,
      createdAt: schema.bookings.createdAt,
    })
    .from(schema.bookings)
    .where(
      and(
        inArray(schema.bookings.slug, slugs),
        ne(schema.bookings.status, "cancelled"),
        lte(schema.bookings.start, to),
        gte(schema.bookings.end, from),
      ),
    );

  return rows.map((booking) => {
    const link = linkBySlug.get(booking.slug);
    const description = [
      booking.notes,
      `Booked by ${booking.name} <${booking.email}>`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      id: `booking:${booking.id}`,
      title:
        booking.eventTitle || link?.title || `Booking with ${booking.name}`,
      description,
      start: booking.start,
      end: booking.end,
      location: booking.meetingLink ?? "",
      allDay: false,
      source: "local",
      googleEventId: booking.googleEventId ?? undefined,
      meetingLink: booking.meetingLink ?? undefined,
      color: link?.color ?? undefined,
      status: booking.status,
      attendees: [{ email: booking.email, displayName: booking.name }],
      createdAt: booking.createdAt,
      updatedAt: booking.createdAt,
    };
  });
}

function shouldShowLocalBookingEvent({
  event,
  googleEventIds,
  googleReadAuthoritative,
}: {
  event: CalendarEvent;
  googleEventIds: Set<string>;
  googleReadAuthoritative: boolean;
}): boolean {
  if (!event.googleEventId) return true;
  if (googleEventIds.has(event.googleEventId)) return false;

  // A linked booking's Google event is the visible calendar source of truth.
  // Keep the local fallback only when Google did not provide an authoritative
  // answer, such as an auth or fetch error.
  return !googleReadAuthoritative;
}

export async function listCalendarEvents(
  args: ListCalendarEventsArgs = {},
  options: ListCalendarEventsOptions = {},
): Promise<CalendarEventsResult> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  const range =
    options.range ??
    resolveCalendarEventRange({
      from: args.from,
      to: args.to,
    });

  const sources = resolveInventorySources(args.sources);
  const includeGoogle = sources.includes("google");
  const includeOverlays = sources.includes("overlays");

  // Resolve owned accounts before any token refresh or provider call.
  let googleEvents: CalendarEvent[] = [];
  let errors: Array<{ email: string; error: string }> = [];
  let overlaySources: Array<{
    email: string;
    status: "ok" | "error";
    error?: string;
  }> = [];
  const normalizedRequestedAccounts = normalizedEmails(args.accountEmails);
  const requestedAccounts = args.accountEmails
    ? normalizedRequestedAccounts
    : null;
  let resolvedAccounts: string[] = [];
  // Resolve/validate ownership before `isConnected` or token refreshes. A
  // rejected filter is therefore atomic even when every token is expired.
  const [ownedAccounts, connected] = await Promise.all([
    options.ownedAccounts ?? googleCalendar.getOwnedAccountEmails(email),
    googleCalendar.isConnected(email),
  ]);
  if (normalizedRequestedAccounts.length > 0) {
    const unowned = normalizedRequestedAccounts.filter(
      (account) =>
        !ownedAccounts.some((owned) => owned.trim().toLowerCase() === account),
    );
    if (unowned.length > 0) {
      throw new Error(
        `Google Calendar account not connected for this user: ${unowned.join(", ")}`,
      );
    }
    resolvedAccounts = ownedAccounts.filter((account) =>
      normalizedRequestedAccounts.includes(account.trim().toLowerCase()),
    );
  } else {
    resolvedAccounts = ownedAccounts;
  }
  const requestedOverlayEmails = normalizedOverlayEmails(
    args.overlayEmails,
  ).slice(0, 10);
  if (includeOverlays && requestedOverlayEmails.length > 0 && !connected) {
    overlaySources = requestedOverlayEmails.map((overlayEmail) => ({
      email: overlayEmail,
      status: "error",
      error: "Google Calendar is not connected",
    }));
  }
  // Once account ownership is validated, independent providers and local SQL
  // can run together. The slowest source should set latency, not their sum.
  const googleRead =
    connected && includeGoogle
      ? googleCalendar.listEvents(range.from, range.to, email, {
          accountEmails: args.accountEmails,
          maxResults: args.providerPageSize,
        })
      : Promise.resolve({ events: [], errors: [] });
  const overlayRead =
    connected && includeOverlays && requestedOverlayEmails.length > 0
      ? googleCalendar.listOverlayEvents(
          range.from,
          range.to,
          requestedOverlayEmails,
          email,
          { accountEmails: args.accountEmails },
        )
      : Promise.resolve({ events: [], errors: [], accountErrors: [] });
  const icalRead = sources.includes("ics")
    ? Promise.resolve(getUserSetting(email, "external-calendars")).then(
        async (setting) => {
          const calendars =
            (setting as unknown as ExternalCalendar[] | null) ?? [];
          return {
            calendars,
            results: await Promise.allSettled(
              calendars.map((calendar) =>
                fetchICalEventsCached(calendar, range.from, range.to),
              ),
            ),
          };
        },
      )
    : Promise.resolve({ calendars: [], results: [] });
  const bookingRead = sources.includes("bookings")
    ? listLocalBookingEvents(range.from, range.to)
    : Promise.resolve([]);

  const [googleResult, overlayResult, icalResult, rawBookingEvents] =
    await Promise.all([googleRead, overlayRead, icalRead, bookingRead]);
  googleEvents = [...googleResult.events, ...overlayResult.events];
  errors = mergeAccountErrors(googleResult.errors, overlayResult.accountErrors);
  if (connected && includeOverlays && requestedOverlayEmails.length > 0) {
    overlaySources = requestedOverlayEmails.map((overlayEmail) => {
      const error = overlayResult.errors.find(
        (entry) => entry.email.toLowerCase() === overlayEmail.toLowerCase(),
      );
      return error
        ? {
            email: overlayEmail,
            status: "error" as const,
            error: error.error,
          }
        : { email: overlayEmail, status: "ok" as const };
    });
  }

  const externalCalendars = icalResult.calendars;
  const icalResults = icalResult.results;

  const icalEvents: CalendarEvent[] = icalResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );
  const icalErrors = icalResults.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            id: externalCalendars[index]!.id,
            name: externalCalendars[index]!.name,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Unable to load ICS feed",
          },
        ]
      : [],
  );
  const icalSources = externalCalendars.map((calendar, index) => {
    const result = icalResults[index]!;
    return result.status === "fulfilled"
      ? { id: calendar.id, name: calendar.name, status: "ok" as const }
      : {
          id: calendar.id,
          name: calendar.name,
          status: "error" as const,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unable to load ICS feed",
        };
  });

  const googleEventIds = new Set(
    googleEvents
      .map((event) => event.googleEventId)
      .filter((id): id is string => Boolean(id)),
  );
  const googleReadAuthoritative =
    includeGoogle && connected && errors.length === 0;
  const bookingEvents = rawBookingEvents.filter((event) =>
    shouldShowLocalBookingEvent({
      event,
      googleEventIds,
      googleReadAuthoritative,
    }),
  );

  let events = [...googleEvents, ...icalEvents, ...bookingEvents];
  if (args.query) {
    events = events.filter((event) =>
      calendarEventMatchesQuery(event, args.query!),
    );
  }
  const fromDate = new Date(range.from);
  events = events.filter((e) => new Date(e.end) >= fromDate);
  const toDate = new Date(range.to);
  events = events.filter((e) => new Date(e.start) <= toDate);

  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  return {
    events,
    errors,
    googleConnected: connected,
    range,
    icalErrors,
    icalSources,
    overlaySources,
    requestedAccounts,
    resolvedAccounts,
    queriedAccounts:
      includeGoogle || (includeOverlays && requestedOverlayEmails.length > 0)
        ? resolvedAccounts
        : [],
    sources,
  };
}

export default defineAction({
  description:
    "List calendar events from Google Calendar, subscribed ICS feeds, and local bookings for a date range. Defaults to today's local calendar day when no range is provided.",
  schema: z.object({
    from: z.string().optional().describe("Start date (ISO string)"),
    to: z.string().optional().describe("End date (ISO string)"),
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Case-insensitive title/attendee/organizer search term"),
    overlayEmails: z
      .union([z.string().max(3_200), z.array(z.string().email()).max(10)])
      .optional()
      .describe(
        "Overlay calendar emails (an array, or legacy comma-separated string)",
      ),
    accountEmails: z
      .array(z.string().email())
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Connected Google accounts to read; omitted reads every connected account",
      ),
    sources: z
      .array(z.enum(["google", "bookings", "ics", "overlays"]))
      .max(4)
      .optional()
      .describe("Calendar sources to query; omitted reads every source"),
    format: z
      .enum(["legacy", "inventory"])
      .optional()
      .describe("Use inventory for compact, coverage-aware external reads"),
    cursor: z
      .string()
      .max(4096)
      .optional()
      .describe("Opaque cursor from an inventory response"),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(INVENTORY_MAX_PAGE_SIZE)
      .optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx) => {
    const inventory =
      args.format === "inventory" || (ctx?.caller === "mcp" && !args.format);
    const owner = inventory ? getRequestUserEmail() : undefined;
    if (inventory && !owner) throw new Error("no authenticated user");

    // Reject invalid, expired, owner-bound, and query-bound cursors before any
    // provider call. Omitted account filters require the cheap owned-account
    // lookup to reproduce the exact query key, but token refreshes and calendar
    // reads remain behind this gate.
    let preparedCursor: InventoryCursor | undefined;
    let preparedQuery: string | undefined;
    let preparedRange: CalendarEventRange | undefined;
    let preparedOwnedAccounts: string[] | undefined;
    if (inventory && args.cursor) {
      preparedRange = resolveCalendarEventRange({
        from: args.from,
        to: args.to,
      });
      preparedOwnedAccounts = args.accountEmails
        ? undefined
        : await googleCalendar.getOwnedAccountEmails(owner!);
      preparedQuery = inventoryQueryKey({
        from: preparedRange.from,
        to: preparedRange.to,
        query: args.query,
        accountEmails: args.accountEmails ?? preparedOwnedAccounts ?? [],
        overlayEmails: args.overlayEmails,
        sources: resolveInventorySources(args.sources),
      });
      preparedCursor = decodeInventoryCursor(
        args.cursor,
        owner!,
        preparedQuery,
      );
    }

    const result = await listCalendarEvents(
      {
        ...args,
      },
      {
        ownedAccounts: preparedOwnedAccounts,
        range: preparedRange,
      },
    );

    if (inventory) {
      const query =
        preparedQuery ??
        inventoryQueryKey({
          from: result.range.from,
          to: result.range.to,
          query: args.query,
          accountEmails: result.requestedAccounts ?? result.resolvedAccounts,
          overlayEmails: args.overlayEmails,
          sources: result.sources,
        });
      const compact = result.events.map(compactInventoryEvent);
      // Provider ids are only unique within an account. Prefer the owned Google
      // occurrence to a duplicate local booking; otherwise keep first after a
      // stable source/key sort.
      const unique = Array.from(
        new Map(
          compact
            .sort(
              (a, b) =>
                a.start.localeCompare(b.start) || a.key.localeCompare(b.key),
            )
            .map((item) => [item.key, item]),
        ).values(),
      );
      const cursor = preparedCursor;
      const afterCursor = cursor
        ? unique.filter(
            (item) =>
              item.start > cursor.start ||
              (item.start === cursor.start && item.key > cursor.key),
          )
        : unique;
      const pageSize = args.pageSize ?? INVENTORY_PAGE_SIZE;
      const items: CalendarInventoryItem[] = [];
      for (const item of afterCursor) {
        if (items.length >= pageSize) break;
        const nextSize = Buffer.byteLength(
          JSON.stringify([...items, item]),
          "utf8",
        );
        if (items.length > 0 && nextSize > INVENTORY_ITEM_BUDGET_BYTES) break;
        items.push(item);
      }
      const last = items[items.length - 1];
      const hasMore = afterCursor.length > items.length;
      const nextCursor =
        hasMore && last
          ? encodeInventoryCursor({
              owner: owner!,
              query,
              start: last.start,
              key: last.key,
            })
          : undefined;
      const accounts = result.queriedAccounts.map((accountEmail) => {
        const error = result.errors.find(
          (entry) =>
            entry.email.trim().toLowerCase() ===
            accountEmail.trim().toLowerCase(),
        );
        return {
          accountEmail,
          status: error ? ("error" as const) : ("ok" as const),
          count: compact.filter(
            (item) => item.accountEmail?.trim().toLowerCase() === accountEmail,
          ).length,
          exhausted: !error,
          ...(error
            ? {
                error: {
                  code: "PROVIDER_READ_FAILED",
                  message: sanitizeError(error.error, "Calendar read failed"),
                  retryable: true,
                },
              }
            : {}),
        };
      });
      const sourceCoverage = [
        ...(result.sources.includes("google") && !result.googleConnected
          ? [
              {
                source: "google" as const,
                id: "owned-accounts",
                status: "error" as const,
                error: {
                  code: "NOT_CONNECTED",
                  message: "Google Calendar is not connected",
                  retryable: false,
                },
              },
            ]
          : []),
        ...result.icalSources.map((feed) => ({
          source: "ics" as const,
          id: feed.id,
          status: feed.status,
          ...(feed.error
            ? {
                error: {
                  ...sourceCoverageError(feed.error, "ICS read failed"),
                },
              }
            : {}),
        })),
        ...result.overlaySources.map((overlay) => ({
          source: "overlay" as const,
          id: overlay.email,
          status: overlay.status,
          ...(overlay.error
            ? {
                error: {
                  ...sourceCoverageError(overlay.error, "Overlay read failed"),
                },
              }
            : {}),
        })),
        ...(result.sources.includes("bookings")
          ? [
              {
                source: "booking" as const,
                id: "bookings",
                status: "ok" as const,
              },
            ]
          : []),
      ];
      const coverageComplete =
        accounts.every((account) => account.status === "ok") &&
        sourceCoverage.every((entry) => entry.status === "ok");
      return {
        version: INVENTORY_VERSION,
        query: {
          ...result.range,
          ...(args.query ? { text: args.query } : {}),
          sources: result.sources,
          overlayEmails: normalizedOverlayEmails(args.overlayEmails),
        },
        requestedAccounts: result.requestedAccounts,
        resolvedAccounts: result.resolvedAccounts,
        queriedAccounts: result.queriedAccounts,
        accounts,
        sourceCoverage,
        coverageComplete,
        complete: !hasMore && coverageComplete,
        items,
        page: { returned: items.length, nextCursor, hasMore },
      };
    }

    if (result.events.length === 0 && result.errors.length > 0) {
      throw new Error(
        result.errors.map((e) => `${e.email}: ${e.error}`).join("; "),
      );
    }

    if (!result.googleConnected && !args.from && !args.to) {
      return "Google Calendar is not connected. Connect via the Settings page first.";
    }

    return result.events;
  },
});
