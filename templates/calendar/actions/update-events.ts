import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  eventWeekday,
  matchesWeekdays,
  normalizeWeekdays,
} from "../server/lib/event-weekday.js";
import { isGoogleNotFoundError } from "../server/lib/google-api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import {
  BOOKED_EVENT_REASON,
  BULK_EVENT_CONCURRENCY,
  MAX_MATCHED_EVENTS,
  cliBoolean,
  isBookedOnAccount,
  mapWithConcurrency,
  normalizeGoogleEventId,
  requireActionUserEmail,
  requireExplicitBound,
  resolveOwnedAccountEmail,
  startsWithinRange,
  undeletableEventReason,
  type BulkEventResult,
} from "./event-action-helpers.js";
import {
  findBookedGoogleEvents,
  listCalendarEvents,
  resolveCalendarEventRange,
} from "./list-events.js";

function shiftedIso(value: string, shiftMinutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid event date: ${value}`);
  return new Date(date.getTime() + shiftMinutes * 60_000).toISOString();
}

export default defineAction({
  description:
    "Update many calendar events in one call. Use shiftMinutes or one shared start/end range with ids or filters; never loop update-event per event. Call once with dryRun true to preview every match, then once more without dryRun to apply the same change.",
  schema: z.object({
    ids: z
      .array(z.string())
      .max(MAX_MATCHED_EVENTS)
      .optional()
      .describe(
        "Explicit Google event ids, with or without the google- prefix",
      ),
    from: z.string().optional().describe("Filter range start"),
    to: z.string().optional().describe("Filter range end, exclusive"),
    daysOfWeek: z
      .union([z.string(), z.array(z.string()).max(7)])
      .optional()
      .describe("Days to match, such as [saturday,sunday] or weekend"),
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Event title or attendee filter"),
    accountEmails: z
      .array(z.string().email())
      .min(1)
      .max(20)
      .optional()
      .describe("Connected Google accounts to search; omitted searches all"),
    accountEmail: z
      .string()
      .optional()
      .describe("Account owning explicit ids or the target event"),
    timezone: z
      .string()
      .optional()
      .describe("IANA timezone for filter boundaries"),
    shiftMinutes: z.coerce
      .number()
      .int()
      .min(-24 * 60)
      .max(24 * 60)
      .optional()
      .describe("Minutes to shift every matched timed event"),
    start: z
      .string()
      .optional()
      .describe("Shared new start for every matched event"),
    end: z
      .string()
      .optional()
      .describe("Shared new end for every matched event"),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .default("none")
      .describe("Whether Google should notify attendees"),
    dryRun: cliBoolean
      .optional()
      .describe("Return every match and its proposed update without writing"),
  }),
  toolCallable: false,
  run: async (args) => {
    const ownerEmail = requireActionUserEmail();
    if (!(await googleCalendar.isConnected(ownerEmail))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }
    if (
      args.shiftMinutes === undefined &&
      (args.start === undefined || args.end === undefined)
    ) {
      throw new Error("Pass shiftMinutes or both start and end.");
    }
    if (
      args.shiftMinutes !== undefined &&
      (args.start !== undefined || args.end !== undefined)
    ) {
      throw new Error("Pass either shiftMinutes or start/end, not both.");
    }

    const weekdays = normalizeWeekdays(args.daysOfWeek);
    const hasIds = Boolean(args.ids?.length);
    if (hasIds && (args.from || args.to || weekdays.length > 0 || args.query)) {
      throw new Error(
        "Pass either explicit ids or a filter (from/to, daysOfWeek, query), not both.",
      );
    }
    const from = args.from
      ? requireExplicitBound(args.from, "from")
      : undefined;
    const to = args.to ? requireExplicitBound(args.to, "to") : undefined;
    if (!hasIds && !(from && to)) {
      throw new Error("A bulk update needs both from and to, or explicit ids.");
    }

    const range = resolveCalendarEventRange({
      from,
      to,
      timezone: args.timezone,
    });
    const events: Array<{
      event: Awaited<ReturnType<typeof googleCalendar.getEvent>>;
      accountEmail: string;
    }> = [];
    const skipped: BulkEventResult[] = [];

    if (hasIds) {
      const accountEmail = await resolveOwnedAccountEmail(
        args.accountEmail,
        ownerEmail,
      );
      const requested = Array.from(
        new Set(args.ids!.map(normalizeGoogleEventId)),
      );
      for (const id of requested) {
        try {
          const event = await googleCalendar.getEvent(id, {
            ownerEmail,
            accountEmail,
          });
          events.push({ event, accountEmail });
        } catch (error) {
          skipped.push({
            id: `google-${id}`,
            accountEmail,
            outcome: "failed",
            reason: isGoogleNotFoundError(error)
              ? "Already absent from Google Calendar"
              : error instanceof Error
                ? error.message
                : String(error),
          });
        }
      }
    } else {
      const listed = await listCalendarEvents(
        { query: args.query, accountEmails: args.accountEmails },
        { range },
      );
      if (listed.errors.length > 0) {
        throw new Error(
          `Cannot bulk update from an incomplete calendar read: ${listed.errors
            .map((entry) => `${entry.email}: ${entry.error}`)
            .join("; ")}`,
        );
      }
      const matched = listed.events.filter(
        (event) =>
          startsWithinRange(event.start, range) &&
          matchesWeekdays(event.start, range.timezone, weekdays),
      );
      if (matched.length > MAX_MATCHED_EVENTS) {
        throw new Error(
          `${matched.length} events match, over the ${MAX_MATCHED_EVENTS} limit for one bulk update. Narrow the range or filter and run again.`,
        );
      }
      const booked = await findBookedGoogleEvents(
        matched
          .map((event) => event.googleEventId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const event of matched) {
        const result: BulkEventResult = {
          id: event.googleEventId ? `google-${event.googleEventId}` : event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          weekday: eventWeekday(event.start, range.timezone),
          accountEmail: event.accountEmail,
          outcome: "matched",
        };
        const reason = undeletableEventReason(event, booked);
        if (reason) {
          skipped.push({ ...result, outcome: "skipped", reason });
          continue;
        }
        events.push({
          event,
          accountEmail: event.accountEmail ?? ownerEmail,
        });
      }
    }

    if (events.length + skipped.length > MAX_MATCHED_EVENTS) {
      throw new Error(
        `${events.length + skipped.length} events match, over the ${MAX_MATCHED_EVENTS} limit for one bulk update. Narrow the range or filter and run again.`,
      );
    }

    const booked = hasIds
      ? await findBookedGoogleEvents(
          events
            .map(({ event }) => event.googleEventId)
            .filter((id): id is string => Boolean(id)),
        )
      : [];
    const eligible = events.filter(({ event, accountEmail }) => {
      if (!event.googleEventId) {
        skipped.push({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          accountEmail,
          outcome: "skipped",
          reason: "Has no Google event id to update",
        });
        return false;
      }
      if (isBookedOnAccount(booked, event.googleEventId, accountEmail)) {
        skipped.push({
          id: `google-${event.googleEventId}`,
          title: event.title,
          start: event.start,
          end: event.end,
          accountEmail,
          outcome: "skipped",
          reason: BOOKED_EVENT_REASON,
        });
        return false;
      }
      return true;
    });

    const proposed = eligible.map(({ event, accountEmail }) => ({
      id: `google-${event.googleEventId}`,
      title: event.title,
      start:
        args.shiftMinutes === undefined
          ? args.start
          : shiftedIso(event.start, args.shiftMinutes),
      end:
        args.shiftMinutes === undefined
          ? args.end
          : shiftedIso(event.end, args.shiftMinutes),
      accountEmail,
      outcome: "matched" as const,
    }));
    if (args.dryRun) {
      return {
        dryRun: true,
        matched: proposed.length + skipped.length,
        updated: 0,
        skipped: skipped.length,
        failed: 0,
        events: [...proposed, ...skipped],
      };
    }

    const updated = await mapWithConcurrency(
      eligible,
      BULK_EVENT_CONCURRENCY,
      async ({ event, accountEmail }): Promise<BulkEventResult> => {
        const start =
          args.shiftMinutes === undefined
            ? args.start!
            : shiftedIso(event.start, args.shiftMinutes);
        const end =
          args.shiftMinutes === undefined
            ? args.end!
            : shiftedIso(event.end, args.shiftMinutes);
        try {
          await googleCalendar.updateEvent(
            event.googleEventId!,
            { start, end, accountEmail },
            {
              account: { ownerEmail, accountEmail },
              sendUpdates: args.sendUpdates,
            },
          );
          return {
            id: `google-${event.googleEventId}`,
            title: event.title,
            start,
            end,
            accountEmail,
            outcome: "updated",
          };
        } catch (error) {
          return {
            id: `google-${event.googleEventId}`,
            title: event.title,
            start,
            end,
            accountEmail,
            outcome: "failed",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    return {
      dryRun: false,
      matched: updated.length + skipped.length,
      updated: updated.filter((event) => event.outcome === "updated").length,
      skipped: skipped.length,
      failed: updated.filter((event) => event.outcome === "failed").length,
      events: [...updated, ...skipped],
    };
  },
});
