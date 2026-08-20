import { defineAction } from "@agent-native/core";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  eventWeekday,
  matchesWeekdays,
  normalizeWeekdays,
  requireValidTimezone,
  type WeekdayName,
} from "../server/lib/event-weekday.js";
import { zonedDateTimeToUtcIso } from "../server/lib/find-time.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type { CalendarEvent } from "../shared/api.js";
import {
  cliBoolean,
  isValidDateOnly,
  normalizeGoogleEventId,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
} from "./event-action-helpers.js";
import {
  findBookedGoogleEvents,
  listCalendarEvents,
  resolveCalendarEventRange,
} from "./list-events.js";

/**
 * A bulk delete is the one calendar write where a wrong filter is unrecoverable,
 * so the match set is capped rather than paged: over the cap the action refuses
 * and asks the caller to narrow, instead of deleting the first N of an unknown
 * number and reporting success.
 */
const MAX_MATCHED_EVENTS = 200;
/** Google Calendar rate-limits per user, so fan out modestly rather than
 *  firing every delete at once and turning a clean batch into retries. */
const DELETE_CONCURRENCY = 4;

type Outcome = "deleted" | "matched" | "skipped" | "failed";

interface EventResult {
  id: string;
  title?: string;
  start?: string;
  weekday?: WeekdayName;
  accountEmail?: string;
  outcome: Outcome;
  reason?: string;
}

type BookedEvent = { googleEventId: string; calendarAccountId: string | null };

/**
 * Google event ids are scoped to a calendar, so a booking only protects the
 * event on its own account. A booking whose account was never recorded still
 * protects every match: reading that null as "some other account" would delete a
 * booked event, which is the failure this guard exists to prevent.
 */
function isBookedOnAccount(
  booked: readonly BookedEvent[],
  googleEventId: string,
  accountEmail: string | undefined,
): boolean {
  return booked.some(
    (row) =>
      row.googleEventId === googleEventId &&
      (!row.calendarAccountId ||
        !accountEmail ||
        row.calendarAccountId.trim().toLowerCase() ===
          accountEmail.trim().toLowerCase()),
  );
}

const BOOKED_EVENT_REASON =
  "Is the Google event for an active booking; cancel the booking instead";

/** Why this app cannot delete an event, or undefined when it can. */
function undeletableReason(
  event: CalendarEvent,
  booked: readonly BookedEvent[],
): string | undefined {
  // The shared read hides a booking whose linked Google event is present, so
  // deleting that Google event here would leave the booking row confirmed and
  // the event would reappear on the calendar as a local booking.
  if (
    event.googleEventId &&
    isBookedOnAccount(booked, event.googleEventId, event.accountEmail)
  ) {
    return BOOKED_EVENT_REASON;
  }
  if (event.source === "ical") {
    return "Comes from a subscribed ICS feed, which is read-only";
  }
  if (event.source === "local") {
    return "Is a booking; cancel it from the booking instead";
  }
  if (!event.googleEventId) {
    return "Has no Google event id to delete";
  }
  return undefined;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether an event *starts* inside the requested range: `from` inclusive, `to`
 * exclusive.
 *
 * The shared calendar read deliberately returns anything that overlaps the range
 * so the UI can draw a multi-day event and an event beginning on the boundary.
 * Neither is what a caller naming a range for a delete means, and the reported
 * `weekday` comes from the start, so an event starting outside the range would be
 * previewed under a day the caller never queried. Re-checking both bounds here
 * keeps the delete inside the dates the caller actually named.
 *
 * An all-day start carries no instant, so it is anchored to local midnight in the
 * range's own timezone: parsing it as a UTC date would sort it before the zone's
 * midnight, and comparing it as a date string would drop a same-day all-day event
 * from a range ending at midday.
 */
function startsWithinRange(
  start: string,
  range: { from: string; to: string; timezone: string },
): boolean {
  const startMs = DATE_ONLY_RE.test(start)
    ? new Date(zonedDateTimeToUtcIso(start, "00:00", range.timezone)).getTime()
    : new Date(start).getTime();
  return (
    startMs >= new Date(range.from).getTime() &&
    startMs < new Date(range.to).getTime()
  );
}

/**
 * Reject a bound the shared resolver would silently reinterpret. An impossible
 * day rolls forward instead of failing on both paths a bound can take —
 * `Date.UTC` for a date-only value and `new Date` for a datetime, where V8
 * turns `2026-02-30T00:00:00-08:00` into March 2 — so a destructive range would
 * silently cover dates the caller never stated. Validated on the leading date
 * for that reason; an out-of-range month or an unparseable value already fails
 * in `normalizeDateBound`.
 */
function requireExplicitBound(value: string, label: "from" | "to"): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be blank.`);
  const datePart = trimmed.slice(0, 10);
  if (DATE_ONLY_RE.test(datePart) && !isValidDateOnly(datePart)) {
    throw new Error(`${label} is not a real calendar date: ${datePart}`);
  }
  return trimmed;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Which timezone decides an event's weekday, in the order the rest of the app
 * uses it: an explicit argument, then the timezone the calendar is pinned to,
 * then the browser's. Every layer is validated rather than normalized, because
 * `normalizeTimezone`'s silent UTC fallback would move day boundaries under a
 * delete without anyone being able to tell.
 */
async function resolveFilterTimezone(
  requested: string | undefined,
  ownerEmail: string,
): Promise<string | undefined> {
  if (requested) return requireValidTimezone(requested);
  const settings = (await getUserSetting(ownerEmail, "calendar-settings")) as {
    timezone?: unknown;
  } | null;
  const saved = settings?.timezone;
  if (typeof saved !== "string" || !saved.trim()) return undefined;
  try {
    return requireValidTimezone(saved.trim());
  } catch {
    throw new Error(
      `The saved calendar timezone (${saved}) is not a valid IANA timezone, so weekday filtering cannot be trusted. Fix it in Settings or pass timezone explicitly.`,
    );
  }
}

export default defineAction({
  description:
    "Delete many calendar events in one call — the only supported way to satisfy a bulk request like 'remove all Saturday and Sunday meetings' or 'clear next week'. Never loop delete-event per event. Filter by date range plus daysOfWeek and/or a title query, or pass explicit ids. Call once with dryRun true to show the user exactly what matches, then once more without dryRun to delete. Weekdays are resolved in the calendar's timezone.",
  schema: z.object({
    ids: z
      .array(z.string())
      .max(MAX_MATCHED_EVENTS)
      .optional()
      .describe(
        'Explicit Google event ids, with or without the "google-" prefix. Omit to select by filter instead.',
      ),
    from: z
      .string()
      .optional()
      .describe("Filter range start (ISO date or datetime)"),
    to: z
      .string()
      .optional()
      .describe("Filter range end, exclusive (ISO date or datetime)"),
    daysOfWeek: z
      .union([z.string(), z.array(z.string()).max(7)])
      .optional()
      .describe(
        'Days to match, e.g. ["saturday","sunday"], "sat,sun", or "weekend"',
      ),
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Case-insensitive title/attendee/organizer filter"),
    accountEmails: z
      .array(z.string().email())
      .min(1)
      .max(20)
      .optional()
      .describe("Connected Google accounts to search; omitted searches all"),
    accountEmail: z
      .string()
      .optional()
      .describe("Account owning the events when passing explicit ids"),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone that defines the day boundaries; defaults to the saved calendar timezone",
      ),
    scope: z
      .enum(["single", "all", "thisAndFollowing"])
      .optional()
      .default("single")
      .describe(
        "Recurring-event delete scope. Filtered selection allows single only; all and thisAndFollowing require explicit ids because they act on the whole series.",
      ),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .default("none")
      .describe("Whether Google should notify attendees of each cancellation"),
    removeOnly: cliBoolean
      .optional()
      .describe(
        "Use true when the user is not the organizer and wants the events removed from their own calendar only.",
      ),
    dryRun: cliBoolean
      .optional()
      .describe("Return the matched events without deleting anything"),
  }),
  toolCallable: false,
  run: async (args) => {
    const ownerEmail = requireActionUserEmail();
    if (!(await googleCalendar.isConnected(ownerEmail))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    const weekdays = normalizeWeekdays(args.daysOfWeek);
    const hasIds = !!args.ids?.length;
    if (hasIds && (args.from || args.to || weekdays.length > 0 || args.query)) {
      throw new Error(
        "Pass either explicit ids or a filter (from/to, daysOfWeek, query), not both.",
      );
    }
    // Both bounds, not one: a lone `to` would silently start the range at today
    // and a lone `from` would silently shrink it to a single day, so an
    // incomplete destructive request would delete a range nobody asked for.
    // Trim and validate first, because the shared resolver trims its own inputs
    // and a whitespace-only bound would pass a truthiness check here and then
    // resolve to today's range.
    const from = args.from
      ? requireExplicitBound(args.from, "from")
      : undefined;
    const to = args.to ? requireExplicitBound(args.to, "to") : undefined;
    if (!hasIds && !(from && to)) {
      throw new Error("A bulk delete needs both from and to, or explicit ids.");
    }
    // Google expands a recurring series into instances, so a weekend filter can
    // match several occurrences of one daily series. Deleting with scope "all"
    // would remove the whole series including the weekdays the user kept, and
    // "thisAndFollowing" would have those occurrences race to rewrite the same
    // master RRULE. Either way the dry-run preview would understate what
    // happens, so a filtered selection is restricted to the matched occurrences.
    // `removeEventFromCalendar` can only drop the named occurrence for
    // "thisAndFollowing" — its own comment says so — so accepting the pair would
    // report a series-wide removal while later occurrences stayed on the
    // calendar. "all" resolves the master and is honored, so only this pair is
    // rejected.
    if (args.removeOnly && args.scope === "thisAndFollowing") {
      throw new Error(
        'removeOnly cannot honor scope "thisAndFollowing" — Google only lets a non-organizer drop one occurrence at a time. Use scope single per occurrence, or scope all to remove the whole series from your calendar.',
      );
    }
    // A series scope acts on the series master, so batching several ids under it
    // is incoherent: two occurrences of one series would either race to rewrite
    // the same RRULE cutoff or have the second call 404 on an already-deleted
    // master, and the per-event report would be wrong either way. One id per
    // series operation removes the race by construction.
    if (hasIds && args.scope !== "single" && args.ids!.length > 1) {
      throw new Error(
        `scope "${args.scope}" acts on a whole recurring series, so it takes exactly one id. Call it once per series, or use scope single to remove specific occurrences.`,
      );
    }
    if (!hasIds && args.scope !== "single") {
      throw new Error(
        `scope "${args.scope}" acts on a whole recurring series, which a filtered bulk delete cannot preview. Use scope single here, or pass the specific event as ids (or call delete-event) to change a series.`,
      );
    }

    const range = resolveCalendarEventRange({
      from,
      to,
      timezone: await resolveFilterTimezone(args.timezone, ownerEmail),
    });

    let targets: Array<{
      googleEventId: string;
      accountEmail: string;
      display: EventResult;
    }> = [];
    const results: EventResult[] = [];
    // A feed that would only have contributed a skipped row still means the
    // report does not cover everything on screen; say so rather than imply it.
    const unreadableSources: Array<{ name: string; error: string }> = [];

    if (hasIds) {
      const accountEmail = await resolveOwnedAccountEmail(
        args.accountEmail,
        ownerEmail,
      );
      // Two spellings of one id ("google-a" and "a") would otherwise enqueue two
      // writes for the same event: one succeeds, the other 404s, and the report
      // claims a failure that never happened.
      const requested = Array.from(
        new Set(args.ids!.map(normalizeGoogleEventId)),
      );
      // Explicit ids get the same booking protection as a filtered selection:
      // naming the event directly does not make leaving its booking confirmed
      // any less of a silent inconsistency.
      const booked = await findBookedGoogleEvents(requested);
      for (const googleEventId of requested) {
        const display: EventResult = {
          id: `google-${googleEventId}`,
          accountEmail,
          outcome: "matched",
        };
        if (isBookedOnAccount(booked, googleEventId, accountEmail)) {
          results.push({
            ...display,
            outcome: "skipped",
            reason: BOOKED_EVENT_REASON,
          });
          continue;
        }
        targets.push({ googleEventId, accountEmail, display });
      }
    } else {
      // Read every source the user can see, not just Google. A weekend event
      // from an ICS feed or a standalone booking is not deletable here, and
      // narrowing the read to Google would drop it from the report entirely --
      // so "deleted 3 of 3" comes back while the user still sees a fourth.
      const listed = await listCalendarEvents(
        { query: args.query, accountEmails: args.accountEmails },
        { range },
      );
      // A provider read that partially failed is not an empty weekend. Deleting
      // "everything that matched" out of an incomplete inventory would report a
      // finished cleanup over events it never saw.
      if (listed.errors.length > 0) {
        throw new Error(
          `Cannot bulk delete from an incomplete calendar read: ${listed.errors
            .map((entry) => `${entry.email}: ${entry.error}`)
            .join("; ")}`,
        );
      }

      for (const feed of listed.icalErrors) {
        unreadableSources.push({ name: feed.name, error: feed.error });
      }

      const matched = listed.events.filter(
        (event) =>
          startsWithinRange(event.start, range) &&
          matchesWeekdays(event.start, range.timezone, weekdays),
      );
      if (matched.length > MAX_MATCHED_EVENTS) {
        throw new Error(
          `${matched.length} events match, over the ${MAX_MATCHED_EVENTS} limit for one bulk delete. Narrow the range or filter and run again.`,
        );
      }

      const booked = await findBookedGoogleEvents(
        matched
          .map((event) => event.googleEventId)
          .filter((id): id is string => Boolean(id)),
      );

      for (const event of matched) {
        const display: EventResult = {
          id: event.googleEventId ? `google-${event.googleEventId}` : event.id,
          title: event.title,
          start: event.start,
          weekday: eventWeekday(event.start, range.timezone),
          accountEmail: event.accountEmail,
          outcome: "matched",
        };
        const reason = undeletableReason(event, booked);
        if (reason) {
          results.push({ ...display, outcome: "skipped", reason });
          continue;
        }
        targets.push({
          googleEventId: event.googleEventId!,
          accountEmail: event.accountEmail ?? ownerEmail,
          display,
        });
      }
    }

    const summaryBase = {
      range: { from: range.from, to: range.to, timezone: range.timezone },
      daysOfWeek: weekdays,
      matched: targets.length + results.length,
      scope: args.scope,
      // Same contract as list-events: a source that could not be read means this
      // sweep does not account for everything the user can see, and that must be
      // impossible to mistake for a clean full pass.
      coverageComplete: unreadableSources.length === 0,
      ...(unreadableSources.length > 0 ? { unreadableSources } : {}),
    };

    if (args.dryRun) {
      return {
        ...summaryBase,
        dryRun: true,
        deleted: 0,
        failed: 0,
        skipped: results.length,
        events: [...targets.map((target) => target.display), ...results],
      };
    }

    const options = {
      scope: args.scope,
      sendUpdates: args.removeOnly ? ("none" as const) : args.sendUpdates,
    };
    const deleteResults = await mapWithConcurrency(
      targets,
      DELETE_CONCURRENCY,
      async (target): Promise<EventResult> => {
        const account = {
          ownerEmail,
          accountEmail: target.accountEmail,
        };
        try {
          if (args.removeOnly) {
            await googleCalendar.removeEventFromCalendar(
              target.googleEventId,
              account,
              options,
            );
          } else {
            await googleCalendar.deleteEvent(
              target.googleEventId,
              account,
              options,
            );
          }
          return { ...target.display, outcome: "deleted" };
        } catch (error) {
          return {
            ...target.display,
            outcome: "failed",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    const events = [...deleteResults, ...results];
    return {
      ...summaryBase,
      dryRun: false,
      deleted: deleteResults.filter((entry) => entry.outcome === "deleted")
        .length,
      failed: deleteResults.filter((entry) => entry.outcome === "failed")
        .length,
      skipped: results.length,
      removedOnly: args.removeOnly ?? false,
      events,
    };
  },
});
