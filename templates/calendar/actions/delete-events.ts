import { defineAction } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  eventWeekday,
  matchesWeekdays,
  normalizeWeekdays,
  requireValidTimezone,
} from "../server/lib/event-weekday.js";
import { isGoogleEventAbsentError } from "../server/lib/google-api.js";
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
  rawCliBoolean,
  requireActionUserEmail,
  requireExplicitBound,
  resolveBulkGoogleEventAccountEmail,
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
  needsApproval: ({ dryRun }) => !rawCliBoolean(dryRun),
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
    const from = args.from
      ? requireExplicitBound(args.from, "from")
      : undefined;
    const to = args.to ? requireExplicitBound(args.to, "to") : undefined;
    if (!hasIds && !(from && to)) {
      throw new Error("A bulk delete needs both from and to, or explicit ids.");
    }
    if (args.removeOnly && args.scope === "thisAndFollowing") {
      throw new Error(
        'removeOnly cannot honor scope "thisAndFollowing" — Google only lets a non-organizer drop one occurrence at a time. Use scope single per occurrence, or scope all to remove the whole series from your calendar.',
      );
    }
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
      display: BulkEventResult;
    }> = [];
    const results: BulkEventResult[] = [];
    const unreadableSources: Array<{ name: string; error: string }> = [];

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
      const booked = await findBookedGoogleEvents(requested.map(([id]) => id));
      for (const [googleEventId, displayId] of requested) {
        const display: BulkEventResult = {
          id: googleEventResultId(displayId, googleEventId, accountEmail),
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
      const listed = await listCalendarEvents(
        { query: args.query, accountEmails: args.accountEmails },
        { range },
      );
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
        const display: BulkEventResult = {
          id: event.id,
          title: event.title,
          start: event.start,
          weekday: eventWeekday(event.start, range.timezone),
          accountEmail: event.accountEmail,
          outcome: "matched",
        };
        const reason = undeletableEventReason(event, booked);
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
      coverageComplete: unreadableSources.length === 0,
      ...(unreadableSources.length > 0 ? { unreadableSources } : {}),
    };

    if (args.dryRun) {
      return {
        ...summaryBase,
        dryRun: true,
        deleted: 0,
        alreadyAbsent: 0,
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
      BULK_EVENT_CONCURRENCY,
      async (target): Promise<BulkEventResult> => {
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
          if (isGoogleEventAbsentError(error)) {
            return {
              ...target.display,
              outcome: "already_absent",
              reason: "Already absent from Google Calendar",
            };
          }
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
      alreadyAbsent: deleteResults.filter(
        (entry) => entry.outcome === "already_absent",
      ).length,
      failed: deleteResults.filter((entry) => entry.outcome === "failed")
        .length,
      skipped: results.length,
      removedOnly: args.removeOnly ?? false,
      events,
    };
  },
});
