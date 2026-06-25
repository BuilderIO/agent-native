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
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  isNotNull,
  lt,
  gte,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
import { listEvents } from "../server/lib/google-calendar-client.js";
import { booleanParam } from "./lib/cli-params.js";

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
    recordedOnly: booleanParam
      .default(false)
      .describe("Only return persisted meetings that have a linked recording."),
    includeLiveCalendar: booleanParam
      .default(true)
      .describe(
        "Read connected calendars live and merge virtual calendar events into the list.",
      ),
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

    // We merge persisted rows with live calendar events, then sort once and
    // slice(offset, offset + limit) at the end. To make that final slice
    // correct we must fetch enough rows from BOTH sources to cover the whole
    // offset + limit window before merging — fetching only `limit` would drop
    // events once offset > 0 or the calendar is large. Keep the hard caps
    // (500 persisted, 250 live) so a huge calendar can't blow up the request.
    const windowCount = args.offset + args.limit;
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
          isNull(schema.meetings.actualStart),
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
    if (args.recordedOnly) {
      whereClauses.push(isNotNull(schema.meetings.recordingId));
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
      .limit(Math.min(500, windowCount))
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

    // Identities of calendar events actually emitted by the live loop this
    // call. We record both the live meeting `id` (which equals the persisted
    // meeting id when correlated) and the Google event id (`calendarExternalId`).
    // A persisted empty calendar meeting is only suppressed when its own live
    // event was emitted here — not merely because some other account returned
    // data or errored.
    const emittedLiveEventKeys = new Set<string>();
    // Map a persisted meeting's `calendarEventId` (calendar_events.id) to the
    // Google event externalId so we can match it against the emitted set.
    const calendarEventIdToExternalId = new Map<string, string>();

    if (
      args.includeLiveCalendar &&
      !args.recordedOnly &&
      args.view !== "trash"
    ) {
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

        try {
          const accessToken = await resolveCalendarAccessToken(account);
          if (!accessToken) {
            calendarErrors.push(
              await recordCalendarFetchError(
                account,
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
              maxResults: Math.min(250, Math.max(windowCount, 50)),
            }),
            db
              .select()
              .from(schema.calendarEvents)
              .where(eq(schema.calendarEvents.calendarAccountId, account.id)),
          ]);

          const cachedByExternalId = new Map(
            cachedEvents.map((event) => [event.externalId, event]),
          );
          for (const cachedEvent of cachedEvents) {
            if (cachedEvent.externalId) {
              calendarEventIdToExternalId.set(
                cachedEvent.id,
                cachedEvent.externalId,
              );
            }
          }

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
            if (liveMeeting) {
              liveMeetings.push(liveMeeting);
              emittedLiveEventKeys.add(liveMeeting.id);
              if (liveMeeting.calendarExternalId) {
                emittedLiveEventKeys.add(liveMeeting.calendarExternalId);
              }
            }
          }

          await recordCalendarFetchSuccess(account).catch(() => {});
        } catch (err) {
          calendarErrors.push(await recordCalendarFetchError(account, err));
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

    for (const meeting of persistedMeetings) {
      if (seenIds.has(meeting.id)) continue;
      // Only suppress an empty persisted calendar meeting when its OWN live
      // event was actually emitted this call (matched by meeting id or by the
      // Google event externalId behind its calendarEventId). This avoids hiding
      // a real persisted calendar meeting whose live event didn't come back —
      // e.g. because another account errored.
      const liveExternalId = meeting.calendarEventId
        ? calendarEventIdToExternalId.get(meeting.calendarEventId)
        : undefined;
      const liveEventEmitted =
        emittedLiveEventKeys.has(meeting.id) ||
        (liveExternalId ? emittedLiveEventKeys.has(liveExternalId) : false);
      if (
        liveEventEmitted &&
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
