/**
 * Get a single meeting with its transcript, notes, and attendees.
 *
 * Usage:
 *   pnpm action get-meeting --meetingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Get a single meeting with its transcript, notes, and attendees. Returns all data needed to render the meeting detail page.",
  schema: z.object({
    meetingId: z.string().describe("Meeting ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    // Fetch meeting
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.id, args.meetingId),
          accessFilter(schema.meetings, schema.meetingShares),
        ),
      );

    if (!meeting) {
      throw new Error(`Meeting not found: ${args.meetingId}`);
    }

    // Fetch transcript, notes, and attendees in parallel
    const [transcripts, notes, attendees] = await Promise.all([
      db
        .select()
        .from(schema.meetingTranscripts)
        .where(eq(schema.meetingTranscripts.meetingId, args.meetingId)),
      db
        .select()
        .from(schema.meetingNotes)
        .where(eq(schema.meetingNotes.meetingId, args.meetingId)),
      db
        .select()
        .from(schema.meetingAttendees)
        .where(eq(schema.meetingAttendees.meetingId, args.meetingId)),
    ]);

    const transcript = transcripts[0] ?? null;
    const note = notes[0] ?? null;

    // Parse JSON fields safely
    let segments: unknown = [];
    let speakerLabels: unknown = {};
    let rawContent: unknown = {};
    try {
      segments = transcript ? JSON.parse(transcript.segmentsJson) : [];
    } catch {
      segments = [];
    }
    try {
      speakerLabels = transcript ? JSON.parse(transcript.speakerLabels) : {};
    } catch {
      speakerLabels = {};
    }
    try {
      rawContent = note ? JSON.parse(note.rawContent) : {};
    } catch {
      rawContent = {};
    }

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        status: meeting.status,
        folderId: meeting.folderId,
        calendarEventId: meeting.calendarEventId,
        calendarProvider: meeting.calendarProvider,
        ownerEmail: meeting.ownerEmail,
        visibility: meeting.visibility,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      },
      transcript: transcript
        ? {
            id: transcript.id,
            status: transcript.status,
            fullText: transcript.fullText,
            segments,
            speakerLabels,
            failureReason: transcript.failureReason,
          }
        : null,
      notes: note
        ? {
            id: note.id,
            rawContent,
            enhancedContent: note.enhancedContent,
            templateId: note.templateId,
            updatedAt: note.updatedAt,
          }
        : null,
      attendees: attendees.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        personId: a.personId,
      })),
    };
  },
});
