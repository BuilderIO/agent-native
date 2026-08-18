/**
 * Search meetings by title, AI summary, user notes, attendee, or the linked
 * recording's transcript.
 *
 * `list-meetings` is a lifecycle list — it answers "what happened around this
 * date". This answers "which call was the one where we talked about X", which
 * is the only way to reach a meeting older than the visible history window.
 *
 * Scope: every source is joined through `accessFilter(meetings, meetingShares)`
 * in the query itself, so a transcript match can never surface a meeting the
 * caller cannot already open.
 */

import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { booleanParam } from "./lib/cli-params.js";
import { buildCaseInsensitiveSearchPattern } from "./search-recordings-utils.js";

const SNIPPET_RADIUS = 90;

/** Columns every match source selects, so results have one uniform shape. */
const MEETING_COLUMNS = {
  id: schema.meetings.id,
  title: schema.meetings.title,
  scheduledStart: schema.meetings.scheduledStart,
  scheduledEnd: schema.meetings.scheduledEnd,
  actualStart: schema.meetings.actualStart,
  actualEnd: schema.meetings.actualEnd,
  createdAt: schema.meetings.createdAt,
  recordingId: schema.meetings.recordingId,
  transcriptStatus: schema.meetings.transcriptStatus,
  summaryMd: schema.meetings.summaryMd,
  userNotesMd: schema.meetings.userNotesMd,
  source: schema.meetings.source,
  platform: schema.meetings.platform,
  trashedAt: schema.meetings.trashedAt,
} as const;

type MeetingRow = Pick<
  typeof schema.meetings.$inferSelect,
  keyof typeof MEETING_COLUMNS
>;

type MeetingMatchType =
  | "title"
  | "summary"
  | "notes"
  | "participant"
  | "transcript";

/** Most specific match wins when one meeting matches several ways. */
const MATCH_PRECEDENCE: MeetingMatchType[] = [
  "transcript",
  "summary",
  "notes",
  "participant",
  "title",
];

function buildSnippet(
  text: string | null | undefined,
  query: string,
): string | null {
  if (!text || !query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

export default defineAction({
  description:
    "Search meetings by title, AI summary, user notes, attendee name/email, or the transcript of the linked recording. Returns each match with a snippet showing why it matched. Use this to find an older call by what was said in it — list-meetings only filters by date.",
  schema: z.object({
    query: z.string().min(1).describe("Search text"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    includeTrashed: booleanParam
      .default(false)
      .describe("Include meetings that have been moved to trash."),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const pattern = buildCaseInsensitiveSearchPattern(args.query);

    const visible = () => {
      const clauses = [accessFilter(schema.meetings, schema.meetingShares)];
      if (!args.includeTrashed) {
        clauses.push(isNull(schema.meetings.trashedAt));
      }
      return and(...clauses);
    };

    // Shared with list-meetings' non-forward-looking sort: most-recent-first,
    // falling back through actualStart -> scheduledStart -> createdAt. Applied
    // as an ORDER BY before every LIMIT below, so a source with more matches
    // than `limit` truncates to its most recent rows instead of an arbitrary
    // DB-chosen subset that could skip the meeting the user is actually after.
    const recencyExpr = sql`COALESCE(${schema.meetings.actualStart}, ${schema.meetings.scheduledStart}, ${schema.meetings.createdAt})`;
    const recencyOrder = desc(recencyExpr);

    const [ownRows, participantMeetingIds, transcriptRows] = await Promise.all([
      db
        .select(MEETING_COLUMNS)
        .from(schema.meetings)
        .where(
          and(
            visible(),
            sql`(lower(${schema.meetings.title}) LIKE ${pattern} ESCAPE '\\' OR lower(${schema.meetings.summaryMd}) LIKE ${pattern} ESCAPE '\\' OR lower(${schema.meetings.userNotesMd}) LIKE ${pattern} ESCAPE '\\')`,
          ),
        )
        .orderBy(recencyOrder)
        .limit(args.limit),
      // meeting_participants has one row per attendee, so limiting attendee
      // rows directly could let one large meeting's matching attendees fill
      // the whole quota and hide every other matching meeting. Limit distinct
      // meeting ids instead, then fetch their participant rows unbounded.
      //
      // PostgreSQL requires every ORDER BY expression on a SELECT DISTINCT to
      // also appear in the select list (SQLite has no such rule, which is why
      // this passed locally against SQLite but fails on Postgres in prod) —
      // so `recency` is selected here as its own column, not just ordered by.
      // It's safe to include: every row for a given meetingId shares the same
      // recency value (it comes from the joined meetings row), so adding it
      // to the DISTINCT projection can't create spurious per-meeting duplicates.
      db
        .selectDistinct({
          meetingId: schema.meetingParticipants.meetingId,
          recency: recencyExpr,
        })
        .from(schema.meetingParticipants)
        .innerJoin(
          schema.meetings,
          eq(schema.meetingParticipants.meetingId, schema.meetings.id),
        )
        .where(
          and(
            visible(),
            sql`(lower(${schema.meetingParticipants.email}) LIKE ${pattern} ESCAPE '\\' OR lower(${schema.meetingParticipants.name}) LIKE ${pattern} ESCAPE '\\')`,
          ),
        )
        .orderBy(recencyOrder)
        .limit(args.limit),
      db
        .select({
          ...MEETING_COLUMNS,
          fullText: schema.recordingTranscripts.fullText,
        })
        .from(schema.meetings)
        .innerJoin(
          schema.recordingTranscripts,
          eq(
            schema.meetings.recordingId,
            schema.recordingTranscripts.recordingId,
          ),
        )
        .where(
          and(
            visible(),
            sql`lower(${schema.recordingTranscripts.fullText}) LIKE ${pattern} ESCAPE '\\'`,
          ),
        )
        .orderBy(recencyOrder)
        .limit(args.limit),
    ]);

    const participantMeetingIdList = participantMeetingIds.map(
      (row) => row.meetingId,
    );
    const participantRows = participantMeetingIdList.length
      ? await db
          .select({
            ...MEETING_COLUMNS,
            participantName: schema.meetingParticipants.name,
            participantEmail: schema.meetingParticipants.email,
          })
          .from(schema.meetingParticipants)
          .innerJoin(
            schema.meetings,
            eq(schema.meetingParticipants.meetingId, schema.meetings.id),
          )
          .where(
            and(
              inArray(
                schema.meetingParticipants.meetingId,
                participantMeetingIdList,
              ),
              sql`(lower(${schema.meetingParticipants.email}) LIKE ${pattern} ESCAPE '\\' OR lower(${schema.meetingParticipants.name}) LIKE ${pattern} ESCAPE '\\')`,
            ),
          )
      : [];

    const merged = new Map<
      string,
      MeetingRow & { matchType: MeetingMatchType; snippet: string | null }
    >();

    const record = (
      meeting: MeetingRow,
      matchType: MeetingMatchType,
      snippet: string | null,
    ) => {
      const existing = merged.get(meeting.id);
      if (
        existing &&
        MATCH_PRECEDENCE.indexOf(existing.matchType) <=
          MATCH_PRECEDENCE.indexOf(matchType)
      ) {
        return;
      }
      merged.set(meeting.id, { ...meeting, matchType, snippet });
    };

    for (const { fullText, ...meeting } of transcriptRows) {
      record(meeting, "transcript", buildSnippet(fullText, args.query));
    }
    for (const row of ownRows) {
      const summarySnippet = buildSnippet(row.summaryMd, args.query);
      if (summarySnippet) {
        record(row, "summary", summarySnippet);
        continue;
      }
      const notesSnippet = buildSnippet(row.userNotesMd, args.query);
      if (notesSnippet) {
        record(row, "notes", notesSnippet);
        continue;
      }
      record(row, "title", null);
    }
    for (const row of participantRows) {
      const { participantName, participantEmail, ...meeting } = row;
      record(
        meeting,
        "participant",
        participantName?.trim() || participantEmail,
      );
    }

    const ids = Array.from(merged.keys());
    const participants = ids.length
      ? await db
          .select()
          .from(schema.meetingParticipants)
          .where(inArray(schema.meetingParticipants.meetingId, ids))
      : [];
    const participantsByMeeting = new Map<string, typeof participants>();
    for (const participant of participants) {
      const list = participantsByMeeting.get(participant.meetingId) ?? [];
      list.push(participant);
      participantsByMeeting.set(participant.meetingId, list);
    }

    const meetings = Array.from(merged.values())
      .map((meeting) => ({
        ...meeting,
        participants: participantsByMeeting.get(meeting.id) ?? [],
      }))
      .sort((a, b) => {
        const aStart = Date.parse(a.actualStart ?? a.scheduledStart ?? "");
        const bStart = Date.parse(b.actualStart ?? b.scheduledStart ?? "");
        return (
          (Number.isNaN(bStart) ? 0 : bStart) -
          (Number.isNaN(aStart) ? 0 : aStart)
        );
      })
      .slice(0, args.limit);

    return { meetings, query: args.query };
  },
});
