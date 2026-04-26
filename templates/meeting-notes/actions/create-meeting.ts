/**
 * Create a new meeting — from a calendar event or ad-hoc.
 *
 * Usage:
 *   pnpm action create-meeting --title="Weekly standup"
 *   pnpm action create-meeting --title="1:1 with Alice" --startTime="2026-04-28T10:00:00Z"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireActiveOrganizationId,
} from "../server/lib/meetings.js";

export default defineAction({
  description:
    "Create a new meeting (from a calendar event or ad-hoc). Returns the new meeting id.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated meeting ID (for optimistic UI)"),
    title: z
      .string()
      .optional()
      .describe("Meeting title (defaults to 'Untitled meeting')"),
    startTime: z
      .string()
      .optional()
      .describe("ISO date — when the meeting starts"),
    endTime: z
      .string()
      .optional()
      .describe("ISO date — when the meeting ends"),
    calendarEventId: z
      .string()
      .optional()
      .describe("Calendar event ID (if synced from a calendar)"),
    calendarProvider: z
      .enum(["google", "microsoft"])
      .optional()
      .describe("Calendar provider"),
    folderId: z.string().nullish().describe("Optional folder ID"),
    organizationId: z
      .string()
      .optional()
      .describe("Organization (defaults to the caller's active org)"),
    attendees: z
      .array(
        z.object({
          name: z.string(),
          email: z.string().optional(),
          role: z
            .enum(["organizer", "required", "optional"])
            .optional()
            .default("required"),
        }),
      )
      .optional()
      .describe("Attendees to add to the meeting"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    const organizationId =
      args.organizationId || (await requireActiveOrganizationId());

    await db.insert(schema.meetings).values({
      id,
      organizationId,
      title: args.title?.trim() || "Untitled meeting",
      startTime: args.startTime ?? null,
      endTime: args.endTime ?? null,
      calendarEventId: args.calendarEventId ?? null,
      calendarProvider: args.calendarProvider ?? null,
      folderId: args.folderId ?? null,
      status: "scheduled",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Create initial notes row
    await db.insert(schema.meetingNotes).values({
      id: nanoid(),
      meetingId: id,
      rawContent: "{}",
      createdAt: now,
      updatedAt: now,
    });

    // Add attendees if provided
    if (args.attendees?.length) {
      for (const attendee of args.attendees) {
        await db.insert(schema.meetingAttendees).values({
          id: nanoid(),
          meetingId: id,
          name: attendee.name,
          email: attendee.email ?? null,
          role: attendee.role ?? "required",
        });
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Created meeting "${args.title ?? "Untitled meeting"}" (${id})`,
    );

    return {
      id,
      organizationId,
      status: "scheduled" as const,
    };
  },
});
