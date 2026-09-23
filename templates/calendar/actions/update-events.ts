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
  googleEventResultId,
  isBookedOnAccount,
  mapWithConcurrency,
  normalizeWritableGoogleEventId,
  requireActionUserEmail,
  requireExplicitBound,
  resolveBulkGoogleEventAccountEmail,
  validateEventTimeOrder,
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

function dateOnly(value: string): string {
  return value.split("T")[0] ?? value;
}

/**
 * The range actually written for one event. All-day targets take date-only
 * bounds, so a timed range is truncated here and can collapse to a zero-day
 * span even when the original timestamps were ordered.
 */
function effectiveRange(
  event: { start: string; end: string; allDay?: boolean },
  args: { start?: string; end?: string; shiftMinutes?: number },
): { start: string; end: string } {
  if (args.shiftMinutes !== undefined) {
    return {
      start: shiftedIso(event.start, args.shiftMinutes),
      end: shiftedIso(event.end, args.shiftMinutes),
    };
  }
  return event.allDay
    ? { start: dateOnly(args.start!), end: dateOnly(args.end!) }
    : { start: args.start!, end: args.end! };
}

function assertEffectiveRangeOrdered(
  event: { start: string; end: string; allDay?: boolean; title: string },
  range: { start: string; end: string },
) {
  if (!event.allDay) {
    validateEventTimeOrder({ start: range.start, end: range.end });
    return;
  }
  if (range.end <= range.start) {
    throw new Error(
      `All-day events need an end date after the start date, but "${event.title}" would get ${range.start} to ${range.end}. Pass dates at least one day apart for all-day targets.`,
    );
  }
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
    if (args.start !== undefined && args.end !== undefined) {
      validateEventTimeOrder({ start: args.start, end: args.end });
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
        resolveBulkGoogleEventAccountEmail(args.ids!, args.accountEmail),
        ownerEmail,
      );
      const requested = Array.from(
        new Map(
          args.ids!.map((id) => [normalizeWritableGoogleEventId(id), id]),
        ).entries(),
      );
      for (const [id, displayId] of requested) {
        try {
          const event = await googleCalendar.getEvent(id, {
            ownerEmail,
            accountEmail,
          });
          events.push({ event: { ...event, id: displayId }, accountEmail });
        } catch (error) {
          skipped.push({
            id: googleEventResultId(displayId, id, accountEmail),
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
          id: event.googleEventId
            ? googleEventResultId(
                event.id,
                event.googleEventId,
                event.accountEmail ?? ownerEmail,
              )
            : event.id,
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
          id: googleEventResultId(event.id, event.googleEventId, accountEmail),
          title: event.title,
          start: event.start,
          end: event.end,
          accountEmail,
          outcome: "skipped",
          reason: BOOKED_EVENT_REASON,
        });
        return false;
      }
      if (args.shiftMinutes !== undefined && event.allDay) {
        skipped.push({
          id: googleEventResultId(event.id, event.googleEventId, accountEmail),
          title: event.title,
          start: event.start,
          end: event.end,
          accountEmail,
          outcome: "skipped",
          reason:
            "Cannot shift an all-day event by minutes; pass start and end date values instead.",
        });
        return false;
      }
      return true;
    });

    const proposed = eligible.map(({ event, accountEmail }) => {
      const range = effectiveRange(event, args);
      assertEffectiveRangeOrdered(event, range);
      return {
        id: googleEventResultId(event.id, event.googleEventId!, accountEmail),
        title: event.title,
        start: range.start,
        end: range.end,
        accountEmail,
        outcome: "matched" as const,
      };
    });
    if (args.dryRun) {
      return {
        dryRun: true,
        matched: proposed.length + skipped.length,
        updated: 0,
        skipped: skipped.length,
        failed: skipped.filter((event) => event.outcome === "failed").length,
        events: [...proposed, ...skipped],
      };
    }

    const updated = await mapWithConcurrency(
      eligible,
      BULK_EVENT_CONCURRENCY,
      async ({ event, accountEmail }): Promise<BulkEventResult> => {
        const { start, end } = effectiveRange(event, args);
        try {
          await googleCalendar.updateEvent(
            event.googleEventId!,
            {
              start,
              end,
              accountEmail,
              ...(event.allDay ? { allDay: true } : {}),
            },
            {
              account: { ownerEmail, accountEmail },
              sendUpdates: args.sendUpdates,
            },
          );
          return {
            id: googleEventResultId(
              event.id,
              event.googleEventId!,
              accountEmail,
            ),
            title: event.title,
            start,
            end,
            accountEmail,
            outcome: "updated",
          };
        } catch (error) {
          return {
            id: googleEventResultId(
              event.id,
              event.googleEventId!,
              accountEmail,
            ),
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
      failed:
        skipped.filter((event) => event.outcome === "failed").length +
        updated.filter((event) => event.outcome === "failed").length,
      events: [...updated, ...skipped],
    };
  },
});
