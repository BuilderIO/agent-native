/**
 * Get a single meeting (with its participants and action items) — access checked.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Get a meeting by id with its participants, action items, and a reference to its recording (if any). Returns null if the user lacks access.",
  schema: z.object({
    id: z.string().describe("Meeting id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("meeting", args.id);
    if (!access) return { meeting: null };

    const db = getDb();
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id))
      .limit(1);
    if (!meeting) return { meeting: null };

    const participants = await db
      .select()
      .from(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, args.id));

    const actionItems = await db
      .select()
      .from(schema.meetingActionItems)
      .where(eq(schema.meetingActionItems.meetingId, args.id));

    let recording = null;
    let transcript = null;
    if (meeting.recordingId) {
      const [rec] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, meeting.recordingId))
        .limit(1);
      recording = rec ?? null;
      const [tr] = await db
        .select()
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, meeting.recordingId))
        .limit(1);
      transcript = tr ?? null;
    }

    return { meeting, participants, actionItems, recording, transcript };
  },
});
