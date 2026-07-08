/**
 * Create a meeting — manually or from a calendar event.
 *
 * Two flows:
 *   1. From a calendar event — pass `calendarEventId`, we copy fields from
 *      the event row.
 *   2. Manual / ad-hoc — pass title and optional scheduledStart/End.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  getActiveOrganizationId,
  nanoid,
} from "../server/lib/recordings.js";

const PLATFORMS = [
  "zoom",
  "meet",
  "teams",
  "webex",
  "phone",
  "adhoc",
  "other",
] as const;

export default defineAction({
  description:
    "Create a meeting row. Pass `calendarEventId` to seed from a connected calendar event, or pass `title` (plus optional schedule) to create an ad-hoc meeting.",
  schema: z
    .object({
      title: z.string().optional().describe("Meeting title"),
      scheduledStart: z
        .string()
        .optional()
        .describe("ISO timestamp of scheduled start"),
      scheduledEnd: z
        .string()
        .optional()
        .describe("ISO timestamp of scheduled end"),
      platform: z.enum(PLATFORMS).optional(),
      joinUrl: z.string().url().optional(),
      calendarEventId: z
        .string()
        .optional()
        .describe(
          "Seed the meeting from this calendar event (must be in a connected account the user owns)",
        ),
      participants: z
        .array(
          z.object({
            email: z.string().email(),
            name: z.string().optional(),
            isOrganizer: z.boolean().optional(),
          }),
        )
        .optional(),
      visibility: z
        .enum(["private", "org", "public"])
        .optional()
        .describe("Initial visibility — defaults to private"),
      source: z
        .enum(["calendar", "adhoc", "manual"])
        .optional()
        .describe(
          "How the meeting was created. Desktop adhoc Zoom/Teams detection passes `adhoc`; omit to infer from title/calendarEventId.",
        ),
    })
    .refine((v) => v.title || v.calendarEventId, {
      message: "Provide either title or calendarEventId",
    }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const orgId = await getActiveOrganizationId();
    const id = nanoid();

    let title = args.title?.trim() ?? "";
    let scheduledStart = args.scheduledStart ?? null;
    let scheduledEnd = args.scheduledEnd ?? null;
    let platform: (typeof PLATFORMS)[number] = args.platform ?? "adhoc";
    let joinUrl = args.joinUrl ?? null;
    let participantsToInsert: Array<{
      email: string;
      name?: string;
      isOrganizer?: boolean;
    }> = args.participants ?? [];
    let calendarEventIdLink: string | null = null;
    let source: "calendar" | "adhoc" | "manual" =
      args.source ?? (args.title ? "manual" : "adhoc");

    if (args.calendarEventId) {
      // Verify the user owns the calendar account that hosts this event.
      const [event] = await db
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, args.calendarEventId))
        .limit(1);
      if (!event) {
        throw new Error(`Calendar event not found: ${args.calendarEventId}`);
      }
      const access = await resolveAccess(
        "calendar-account",
        event.calendarAccountId,
      );
      if (!access) {
        throw new Error(
          "You don't have access to the calendar account for this event",
        );
      }
      // Re-use existing meeting if we already linked one.
      if (event.meetingId) {
        const [existing] = await db
          .select()
          .from(schema.meetings)
          .where(eq(schema.meetings.id, event.meetingId))
          .limit(1);
        if (existing) return { meeting: existing, created: false };
      }

      // Claim the event row atomically before inserting a meetings row below
      // — mirrors materializeCalendarMeetingFromVirtualId's TOCTOU fix, so
      // two concurrent create-meeting calls for the same calendarEventId
      // can't both insert a duplicate meeting.
      const claimed = await db
        .update(schema.calendarEvents)
        .set({ meetingId: id, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.calendarEvents.id, args.calendarEventId),
            isNull(schema.calendarEvents.meetingId),
          ),
        )
        .returning({ id: schema.calendarEvents.id });

      if (!claimed.length) {
        // Someone else claimed it first — re-read and return their meeting.
        const [winnerEvent] = await db
          .select({ meetingId: schema.calendarEvents.meetingId })
          .from(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, args.calendarEventId))
          .limit(1);
        if (winnerEvent?.meetingId) {
          const [winnerMeeting] = await db
            .select()
            .from(schema.meetings)
            .where(eq(schema.meetings.id, winnerEvent.meetingId))
            .limit(1);
          if (winnerMeeting) return { meeting: winnerMeeting, created: false };
        }
        throw new Error(
          `Calendar event ${args.calendarEventId} was claimed by another meeting concurrently.`,
        );
      }

      title = title || event.title || "Untitled meeting";
      scheduledStart = scheduledStart || event.start;
      scheduledEnd = scheduledEnd || event.end;
      joinUrl = joinUrl || event.joinUrl || null;
      platform = args.platform ?? inferPlatformFromUrl(event.joinUrl ?? "");
      calendarEventIdLink = event.id;
      source = "calendar";

      try {
        const parsed = JSON.parse(event.attendeesJson) as Array<{
          email?: string;
          name?: string;
          responseStatus?: string;
        }>;
        if (Array.isArray(parsed) && participantsToInsert.length === 0) {
          participantsToInsert = parsed
            .filter((p) => typeof p.email === "string" && p.email)
            .map((p) => ({
              email: p.email!,
              name: p.name,
              isOrganizer: p.email === event.organizerEmail,
            }));
        }
      } catch {
        // Ignore malformed attendees JSON.
      }
    }

    const visibility = args.visibility ?? "private";

    try {
      await db.insert(schema.meetings).values({
        id,
        organizationId: orgId ?? null,
        title: title || "Untitled meeting",
        scheduledStart,
        scheduledEnd,
        actualStart: null,
        actualEnd: null,
        platform,
        joinUrl,
        calendarEventId: calendarEventIdLink,
        recordingId: null,
        transcriptStatus: "idle",
        summaryMd: "",
        bulletsJson: "[]",
        actionItemsJson: "[]",
        source,
        ownerEmail,
        orgId: orgId ?? null,
        visibility,
      });

      if (participantsToInsert.length) {
        await db.insert(schema.meetingParticipants).values(
          participantsToInsert.map((p) => ({
            id: nanoid(),
            meetingId: id,
            email: p.email,
            name: p.name ?? null,
            isOrganizer: !!p.isOrganizer,
            attendedAt: null,
          })),
        );
      }
    } catch (err) {
      // Roll back the calendar_events claim (only if it still points at our
      // own id) so a future call can retry instead of leaving the event
      // permanently pointed at a meeting that was never created.
      if (calendarEventIdLink) {
        await db
          .update(schema.calendarEvents)
          .set({ meetingId: null, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(schema.calendarEvents.id, calendarEventIdLink),
              eq(schema.calendarEvents.meetingId, id),
            ),
          )
          .catch(() => {});
      }
      throw err;
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, id))
      .limit(1);

    return { meeting, created: true };
  },
});

function inferPlatformFromUrl(url: string): (typeof PLATFORMS)[number] {
  const lower = url.toLowerCase();
  if (lower.includes("zoom.us")) return "zoom";
  if (lower.includes("meet.google.com")) return "meet";
  if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com"))
    return "teams";
  if (lower.includes("webex")) return "webex";
  if (!url) return "adhoc";
  return "other";
}
