/**
 * Create a meeting — manually or from a calendar event.
 *
 * Two flows:
 *   1. From a calendar event — pass `calendarEventId`, we copy fields from
 *      the event row.
 *   2. Manual / ad-hoc — pass title and optional scheduledStart/End.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  getActiveOrganizationId,
  nanoid,
} from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";

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
    let source: "calendar" | "adhoc" | "manual" = args.title
      ? "manual"
      : "adhoc";

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

    if (calendarEventIdLink) {
      await db
        .update(schema.calendarEvents)
        .set({ meetingId: id, updatedAt: new Date().toISOString() })
        .where(eq(schema.calendarEvents.id, calendarEventIdLink));
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
