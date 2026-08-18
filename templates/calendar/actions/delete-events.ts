import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  eventWeekday,
  matchesWeekdays,
  normalizeWeekdays,
  type WeekdayName,
} from "../server/lib/event-weekday.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type { CalendarEvent } from "../shared/api.js";
import {
  cliBoolean,
  normalizeGoogleEventId,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
} from "./event-action-helpers.js";
import {
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

/** Why this app cannot delete an event, or undefined when it can. */
function undeletableReason(event: CalendarEvent): string | undefined {
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
        "IANA timezone that defines the day boundaries; defaults to the calendar's",
      ),
    scope: z
      .enum(["single", "all", "thisAndFollowing"])
      .optional()
      .default("single")
      .describe(
        "Recurring-event delete scope. Keep single to remove only the matched occurrences.",
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
    if (!hasIds && !args.from && !args.to) {
      throw new Error(
        "A bulk delete needs an explicit from/to range, or explicit ids.",
      );
    }

    const range = resolveCalendarEventRange({
      from: args.from,
      to: args.to,
      timezone: args.timezone,
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
      targets = args.ids!.map((id) => {
        const googleEventId = normalizeGoogleEventId(id);
        return {
          googleEventId,
          accountEmail,
          display: {
            id: `google-${googleEventId}`,
            accountEmail,
            outcome: "matched" as Outcome,
          },
        };
      });
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

      const matched = listed.events.filter((event) =>
        matchesWeekdays(event.start, range.timezone, weekdays),
      );
      if (matched.length > MAX_MATCHED_EVENTS) {
        throw new Error(
          `${matched.length} events match, over the ${MAX_MATCHED_EVENTS} limit for one bulk delete. Narrow the range or filter and run again.`,
        );
      }

      for (const event of matched) {
        const display: EventResult = {
          id: event.googleEventId ? `google-${event.googleEventId}` : event.id,
          title: event.title,
          start: event.start,
          weekday: eventWeekday(event.start, range.timezone),
          accountEmail: event.accountEmail,
          outcome: "matched",
        };
        const reason = undeletableReason(event);
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
