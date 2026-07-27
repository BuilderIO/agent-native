/**
 * Soft-delete a meeting by moving it out of the visible Meetings list.
 *
 * This intentionally does not delete linked recordings, calendar events, or
 * transcripts. Calendar-synced meetings keep their calendar_events.meeting_id
 * link so a future sync does not recreate the same row immediately.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { closeOutStaleMeeting } from "../server/jobs/stale-meeting-sweeper.js";

export default defineAction({
  description:
    "Remove a meeting from the visible Meetings list by setting trashedAt. Does not delete linked recordings or calendar events.",
  schema: z.object({
    id: z.string().describe("Meeting id"),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.id, "editor");
    const db = getDb();
    const now = new Date().toISOString();

    const [meeting] = await db
      .select({
        actualStart: schema.meetings.actualStart,
        actualEnd: schema.meetings.actualEnd,
        recordingId: schema.meetings.recordingId,
        ownerEmail: schema.meetings.ownerEmail,
        orgId: schema.meetings.orgId,
      })
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id))
      .limit(1);

    // Trashing a still-live meeting also closes out capture state (stamp
    // actualEnd, flip transcriptStatus, un-stick the linked recording) —
    // otherwise a live desktop session keeps writing to a now-hidden row.
    if (meeting && meeting.actualStart && !meeting.actualEnd) {
      await closeOutStaleMeeting({
        meetingId: args.id,
        recordingId: meeting.recordingId,
        ownerEmail: meeting.ownerEmail,
        orgId: meeting.orgId,
      });
    }

    await db
      .update(schema.meetings)
      .set({ trashedAt: now, updatedAt: now })
      .where(eq(schema.meetings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, trashedAt: now };
  },
});
