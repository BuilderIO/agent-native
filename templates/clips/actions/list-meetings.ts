/**
 * List meetings visible to the current user.
 *
 * Filtering:
 *   - view='upcoming' — scheduled_start in the future, not trashed
 *   - view='past'     — actual_end OR scheduled_end in the past, not trashed
 *   - view='all'      — every visible meeting (excluding trashed)
 *   - view='trash'    — trashed_at is not null
 *
 * Calendar behavior:
 *   Connected Google Calendar accounts are read live on every call. We only
 *   materialize a calendar event into `clips_meetings` when the user records
 *   or edits it; the list itself is not an import/sync cache.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  isNull,
  isNotNull,
  lt,
  gte,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { listEvents } from "../server/lib/google-calendar-client.js";
import {
  calendarEventToMeetingView,
  eventEndIso,
  eventStartIso,
  isTimedCalendarEvent,
  recordCalendarFetchError,
  recordCalendarFetchSuccess,
  resolveCalendarAccessToken,
  type CalendarFetchError,
} from "../server/lib/calendar-event-meetings.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default defineAction({
  description:
    "List meetings (Granola-style) the current user has access to. Connected calendars are read live; use view='upcoming' / 'past' / 'all' / 'trash' to filter by lifecycle.",
  schema: z.object({
    view: z
      .enum(["upcoming", "past", "all", "trash"])
      .default("upcoming")
      .describe("Which list to show"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    upcomingWithinMin: z.coerce
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 30)
      .optional()
      .describe(
        "If set, only return upcoming meetings starting within this many minutes. Used by the desktop reminder watcher.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const upcomingWindowMaxIso = args.upcomingWithinMin
      ? new Date(
          now.getTime() + args.upcomingWithinMin * 60 * 1000,
        ).toISOString()
      : null;

    const whereClauses = [accessFilter(schema.meetings, schema.meetingShares)];

    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.meetings.trashedAt));
    } else {
      whereClauses.push(isNull(schema.meetings.trashedAt));
    }

    if (args.view === "upcoming") {
      // Scheduled in the future and not yet finished.
      whereClauses.push(
        and(
          isNotNull(schema.meetings.scheduledStart),
          gte(schema.meetings.scheduledStart, nowIso),
          isNull(schema.meetings.actualEnd),
          upcomingWindowMaxIso
            ? lte(schema.meetings.scheduledStart, upcomingWindowMaxIso)
            : undefined,
        )!,
      );
    } else if (args.view === "past") {
      // Either completed (actualEnd set) or scheduled-end in the past.
      whereClauses.push(
        or(
          isNotNull(schema.meetings.actualEnd),
          and(
            isNotNull(schema.meetings.scheduledEnd),
            lt(schema.meetings.scheduledEnd, nowIso),
          )!,
        )!,
      );
    }

    const orderBy =
      args.view === "upcoming"
        ? [asc(schema.meetings.scheduledStart)]
        : [
            desc(
              sql`COALESCE(${schema.meetings.actualStart}, ${schema.meetings.scheduledStart}, ${schema.meetings.createdAt})`,
            ),
          ];

    const rows = await db
      .select()
      .from(schema.meetings)
      .where(and(...whereClauses))
      .orderBy(...orderBy)
      .limit(Math.min(500, Math.max(args.limit + args.offset, args.limit)))
      .offset(0);

    // Add a derived `summaryPreview` (first ~100 chars of summaryMd) so the
    // Granola-style cards can render a one-liner without re-parsing markdown.
    const persistedMeetings = rows.map((m) => {
      const summary = (m.summaryMd ?? "").trim();
      const preview = summary
        ? summary.replace(/\s+/g, " ").slice(0, 100)
        : null;
      return { ...m, summaryPreview: preview };
    });

    const liveMeetings: any[] = [];
    const calendarErrors: CalendarFetchError[] = [];
    let readLiveCalendars = false;

    if (args.view !== "trash") {
      const accountWhere = [
        accessFilter(schema.calendarAccounts, schema.calendarAccountShares),
        eq(schema.calendarAccounts.status, "connected"),
      ];
      const accounts = await db
        .select()
        .from(schema.calendarAccounts)
        .where(and(...accountWhere));

      const persistedById = new Map(
        persistedMeetings.map((meeting) => [meeting.id, meeting]),
      );

      for (const account of accounts) {
        if (account.provider !== "google") continue;
        readLiveCalendars = true;

        try {
          const accessToken = await resolveCalendarAccessToken(account);
          if (!accessToken) {
            calendarErrors.push(
              await recordCalendarFetchError(
                account.id,
                new Error("Token refresh failed"),
              ),
            );
            continue;
          }

          const timeMin =
            args.view === "past"
              ? new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
              : args.view === "all"
                ? new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
                : new Date(now.getTime() - 60 * 1000).toISOString();
          const timeMax =
            args.view === "past"
              ? nowIso
              : (upcomingWindowMaxIso ??
                new Date(now.getTime() + THIRTY_DAYS_MS).toISOString());

          const [{ items }, cachedEvents] = await Promise.all([
            listEvents({
              accessToken,
              calendarId: "primary",
              timeMin,
              timeMax,
              maxResults: Math.min(250, Math.max(args.limit + args.offset, 50)),
            }),
            db
              .select()
              .from(schema.calendarEvents)
              .where(eq(schema.calendarEvents.calendarAccountId, account.id)),
          ]);

          const cachedByExternalId = new Map(
            cachedEvents.map((event) => [event.externalId, event]),
          );

          for (const event of items) {
            if (!event.id || event.status === "cancelled") continue;
            if (!isTimedCalendarEvent(event)) continue;
            const startIso = eventStartIso(event);
            const endIso = eventEndIso(event);
            if (!startIso || !endIso) continue;

            const startMs = Date.parse(startIso);
            const endMs = Date.parse(endIso);
            if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
            if (args.view === "upcoming" && endMs < now.getTime()) continue;
            if (args.view === "past" && endMs >= now.getTime()) continue;
            if (
              upcomingWindowMaxIso &&
              startMs > Date.parse(upcomingWindowMaxIso)
            ) {
              continue;
            }

            const cached = cachedByExternalId.get(event.id);
            const persisted = cached?.meetingId
              ? persistedById.get(cached.meetingId)
              : null;
            const liveMeeting = calendarEventToMeetingView({
              account,
              event,
              meeting: persisted,
            });
            if (liveMeeting) liveMeetings.push(liveMeeting);
          }

          await recordCalendarFetchSuccess(account.id).catch(() => {});
        } catch (err) {
          calendarErrors.push(await recordCalendarFetchError(account.id, err));
        }
      }
    }

    const seenIds = new Set<string>();
    const combined: any[] = [];
    for (const meeting of liveMeetings) {
      if (seenIds.has(meeting.id)) continue;
      seenIds.add(meeting.id);
      combined.push(meeting);
    }

    const liveHasCalendarData =
      readLiveCalendars || liveMeetings.length > 0 || calendarErrors.length > 0;
    for (const meeting of persistedMeetings) {
      if (seenIds.has(meeting.id)) continue;
      if (
        liveHasCalendarData &&
        meeting.source === "calendar" &&
        !meeting.recordingId &&
        !meeting.actualStart &&
        !meeting.actualEnd &&
        !(meeting.summaryMd ?? "").trim() &&
        !(meeting.userNotesMd ?? "").trim() &&
        (meeting.bulletsJson ?? "[]") === "[]" &&
        (meeting.actionItemsJson ?? "[]") === "[]"
      ) {
        continue;
      }
      seenIds.add(meeting.id);
      combined.push(meeting);
    }

    combined.sort((a, b) => {
      const aStart = Date.parse(a.scheduledStart ?? a.createdAt ?? "");
      const bStart = Date.parse(b.scheduledStart ?? b.createdAt ?? "");
      const safeA = Number.isNaN(aStart) ? 0 : aStart;
      const safeB = Number.isNaN(bStart) ? 0 : bStart;
      return args.view === "past" ? safeB - safeA : safeA - safeB;
    });

    const meetings = combined.slice(args.offset, args.offset + args.limit);

    return { meetings, calendarErrors };
  },
});
