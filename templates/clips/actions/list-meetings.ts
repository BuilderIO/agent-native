import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  lt,
  gte,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isDeclinedCalendarEvent,
  isSoloCalendarEvent,
} from "../server/lib/calendar-event-classification.js";
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
import { meetingRowHasContent } from "./lib/meeting-content.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_ROWS_PER_QUERY = 1000;

function meetingHasContentFilter() {
  return or(
    isNotNull(schema.meetings.recordingId),
    isNotNull(schema.meetings.actualStart),
    isNotNull(schema.meetings.actualEnd),
    sql`trim(${schema.meetings.summaryMd}) <> ''`,
    sql`trim(${schema.meetings.userNotesMd}) <> ''`,
    ne(schema.meetings.bulletsJson, "[]"),
    ne(schema.meetings.actionItemsJson, "[]"),
  )!;
}

export default defineAction({
  description:
    "List meetings (Granola-style) the current user has access to. Connected calendars are read live; use view='upcoming' / 'past' / 'all' / 'trash' to filter by lifecycle.",
  schema: z.object({
    view: z
      .enum(["upcoming", "agenda", "past", "all", "trash"])
      .default("upcoming")
      .describe(
        "Which list to show. 'agenda' is the Meetings tab's rolling window — everything scheduled from `agendaLookbackMin` ago onward, so calls that already happened today stay on the agenda; 'upcoming' is strictly not-yet-started and is what desktop reminders poll.",
      ),
    agendaLookbackMin: z.coerce
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 7)
      .default(60 * 24)
      .describe(
        "How far back view='agenda' reaches, in minutes. Default 1440 (24h): a meeting from earlier today is still part of today.",
      ),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    recordedOnly: booleanParam
      .default(false)
      .describe("Only return persisted meetings that have a linked recording."),
    hasContent: booleanParam
      .default(false)
      .describe(
        "Only return persisted meetings that hold something worth reopening — a linked recording, an actual start/end, notes, a summary, bullets, or action items. Prefer this over recordedOnly for history: live notes taken without a linked recording still count.",
      ),
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
    includeStartedWithinMin: z.coerce
      .number()
      .int()
      .min(0)
      .max(60)
      .optional()
      .describe(
        "Also include meetings that started within this many minutes (desktop reminder hold window). Default 0.",
      ),
    excludePersonalSoloEvents: booleanParam
      .default(false)
      .describe(
        "Exclude calendar events with no active attendee besides the current user. Used by desktop meeting reminders.",
      ),
    excludeDeclinedEvents: booleanParam
      .default(false)
      .describe(
        "Exclude calendar events where the current user has declined. Used by desktop meeting reminders.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const currentUserEmail = getRequestUserEmail();
    const now = new Date();
    const nowIso = now.toISOString();

    const windowCount = args.offset + args.limit;
    const upcomingWindowMaxIso = args.upcomingWithinMin
      ? new Date(
          now.getTime() + args.upcomingWithinMin * 60 * 1000,
        ).toISOString()
      : null;
    const startedWithinMin = args.includeStartedWithinMin ?? 0;
    const upcomingWindowMinIso =
      startedWithinMin > 0
        ? new Date(now.getTime() - startedWithinMin * 60 * 1000).toISOString()
        : nowIso;
    const agendaFloorIso = new Date(
      now.getTime() - args.agendaLookbackMin * 60 * 1000,
    ).toISOString();
    const agendaCeilingIso = new Date(
      now.getTime() + THIRTY_DAYS_MS,
    ).toISOString();
    const isForwardLooking = args.view === "upcoming" || args.view === "agenda";
    const willMergeLiveCalendar =
      args.includeLiveCalendar && !args.recordedOnly && args.view !== "trash";

    const whereClauses = [accessFilter(schema.meetings, schema.meetingShares)];

    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.meetings.trashedAt));
    } else {
      whereClauses.push(isNull(schema.meetings.trashedAt));
    }

    if (args.view === "upcoming") {
      whereClauses.push(
        and(
          isNotNull(schema.meetings.scheduledStart),
          gte(schema.meetings.scheduledStart, upcomingWindowMinIso),
          isNull(schema.meetings.actualStart),
          isNull(schema.meetings.actualEnd),
          upcomingWindowMaxIso
            ? lte(schema.meetings.scheduledStart, upcomingWindowMaxIso)
            : undefined,
        )!,
      );
    } else if (args.view === "agenda") {
      whereClauses.push(
        and(
          isNotNull(schema.meetings.scheduledStart),
          gte(schema.meetings.scheduledStart, agendaFloorIso),
          lte(schema.meetings.scheduledStart, agendaCeilingIso),
        )!,
      );
    } else if (args.view === "past") {
      whereClauses.push(
        or(
          isNotNull(schema.meetings.actualEnd),
          and(
            isNotNull(schema.meetings.scheduledEnd),
            lt(schema.meetings.scheduledEnd, nowIso),
            isNull(schema.meetings.actualStart),
          )!,
          and(
            isNull(schema.meetings.scheduledStart),
            isNull(schema.meetings.actualStart),
          )!,
        )!,
      );
    }
    if (args.recordedOnly) {
      whereClauses.push(isNotNull(schema.meetings.recordingId));
    }
    if (args.hasContent) {
      whereClauses.push(meetingHasContentFilter());
    }

    const orderBy = isForwardLooking
      ? [asc(schema.meetings.scheduledStart)]
      : [
          desc(
            sql`COALESCE(${schema.meetings.actualStart}, ${schema.meetings.scheduledStart}, ${schema.meetings.createdAt})`,
          ),
        ];

    let persistedHasMore = false;
    let rows: Array<typeof schema.meetings.$inferSelect>;
    if (willMergeLiveCalendar) {
      rows = await db
        .select()
        .from(schema.meetings)
        .where(and(...whereClauses))
        .orderBy(...orderBy)
        .limit(Math.min(MAX_PERSISTED_ROWS_PER_QUERY, windowCount + 1))
        .offset(0);
    } else {
      const page = await db
        .select()
        .from(schema.meetings)
        .where(and(...whereClauses))
        .orderBy(...orderBy)
        .limit(Math.min(MAX_PERSISTED_ROWS_PER_QUERY, args.limit + 1))
        .offset(args.offset);
      persistedHasMore = page.length > args.limit;
      rows = page.slice(0, args.limit);
    }

    const persistedIds = rows.map((m) => m.id);
    const participantRows = persistedIds.length
      ? await db
          .select()
          .from(schema.meetingParticipants)
          .where(inArray(schema.meetingParticipants.meetingId, persistedIds))
      : [];
    const participantsByMeeting = new Map<string, typeof participantRows>();
    for (const participant of participantRows) {
      const list = participantsByMeeting.get(participant.meetingId) ?? [];
      list.push(participant);
      participantsByMeeting.set(participant.meetingId, list);
    }

    const persistedMeetings = rows.map((m) => {
      const summary = (m.summaryMd ?? "").trim();
      const preview = summary
        ? summary.replace(/\s+/g, " ").slice(0, 100)
        : null;
      return {
        ...m,
        summaryPreview: preview,
        participants: participantsByMeeting.get(m.id) ?? [],
      };
    });

    const liveMeetings: any[] = [];
    const calendarErrors: CalendarFetchError[] = [];

    const emittedLiveEventKeys = new Set<string>();
    const excludedLiveEventKeys = new Set<string>();
    const calendarEventIdToExternalId = new Map<string, string>();

    if (willMergeLiveCalendar) {
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
                { needsReauth: true },
              ),
            );
            continue;
          }

          const timeMin =
            args.view === "past"
              ? new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
              : args.view === "all"
                ? new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
                : args.view === "agenda"
                  ? agendaFloorIso
                  : startedWithinMin > 0
                    ? upcomingWindowMinIso
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
            const cached = cachedByExternalId.get(event.id);
            if (
              args.excludeDeclinedEvents &&
              isDeclinedCalendarEvent({ account, event, currentUserEmail })
            ) {
              excludedLiveEventKeys.add(event.id);
              if (cached?.meetingId) {
                excludedLiveEventKeys.add(cached.meetingId);
              }
              continue;
            }
            if (
              args.excludePersonalSoloEvents &&
              isSoloCalendarEvent({ account, event, currentUserEmail })
            ) {
              excludedLiveEventKeys.add(event.id);
              if (cached?.meetingId) {
                excludedLiveEventKeys.add(cached.meetingId);
              }
              continue;
            }
            const startIso = eventStartIso(event);
            const endIso = eventEndIso(event);
            if (!startIso || !endIso) continue;

            const startMs = Date.parse(startIso);
            const endMs = Date.parse(endIso);
            if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
            if (args.view === "upcoming" && endMs < now.getTime()) continue;
            if (
              args.view === "upcoming" &&
              startedWithinMin > 0 &&
              startMs < Date.parse(upcomingWindowMinIso)
            ) {
              continue;
            }
            if (args.view === "past" && endMs >= now.getTime()) continue;
            if (
              args.view === "agenda" &&
              startMs < Date.parse(agendaFloorIso)
            ) {
              continue;
            }
            if (
              upcomingWindowMaxIso &&
              startMs > Date.parse(upcomingWindowMaxIso)
            ) {
              continue;
            }

            const persisted = cached?.meetingId
              ? persistedById.get(cached.meetingId)
              : null;
            const liveMeeting = calendarEventToMeetingView({
              account,
              event,
              meeting: persisted,
            });
            if (liveMeeting) {
              emittedLiveEventKeys.add(liveMeeting.id);
              if (liveMeeting.calendarExternalId) {
                emittedLiveEventKeys.add(liveMeeting.calendarExternalId);
              }
              if (!args.hasContent || meetingRowHasContent(liveMeeting)) {
                liveMeetings.push(liveMeeting);
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
      const liveExternalId = meeting.calendarEventId
        ? calendarEventIdToExternalId.get(meeting.calendarEventId)
        : undefined;
      const liveEventExcluded =
        excludedLiveEventKeys.has(meeting.id) ||
        (liveExternalId ? excludedLiveEventKeys.has(liveExternalId) : false);
      if (liveEventExcluded) continue;
      const liveEventEmitted =
        emittedLiveEventKeys.has(meeting.id) ||
        (liveExternalId ? emittedLiveEventKeys.has(liveExternalId) : false);
      if (
        liveEventEmitted &&
        meeting.source === "calendar" &&
        !meetingRowHasContent(meeting)
      ) {
        continue;
      }
      seenIds.add(meeting.id);
      combined.push(meeting);
    }

    if (!willMergeLiveCalendar) {
      return {
        meetings: combined,
        calendarErrors,
        hasMore: persistedHasMore,
      };
    }

    combined.sort((a, b) => {
      const aStart = Date.parse(a.scheduledStart ?? a.createdAt ?? "");
      const bStart = Date.parse(b.scheduledStart ?? b.createdAt ?? "");
      const safeA = Number.isNaN(aStart) ? 0 : aStart;
      const safeB = Number.isNaN(bStart) ? 0 : bStart;
      return args.view === "past" ? safeB - safeA : safeA - safeB;
    });

    const meetings = combined.slice(args.offset, args.offset + args.limit);
    const hasMore = combined.length > args.offset + args.limit;

    return { meetings, calendarErrors, hasMore };
  },
});
