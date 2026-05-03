/**
 * Stop a meeting recording — stamps `actualEnd` and signals the UI.
 *
 * The actual MediaRecorder stop and chunked-upload finalize are UI gestures —
 * this action just marks the meeting as ended and bumps the refresh signal.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Stop a meeting recording. Stamps actualEnd on the meeting and signals the UI to finalize the underlying recording.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.meetingId, "editor");
    const db = getDb();
    const nowIso = new Date().toISOString();

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId))
      .limit(1);
    if (!meeting) throw new Error(`Meeting not found: ${args.meetingId}`);

    await db
      .update(schema.meetings)
      .set({
        actualEnd: meeting.actualEnd ?? nowIso,
        updatedAt: nowIso,
      })
      .where(eq(schema.meetings.id, args.meetingId));

    if (meeting.recordingId) {
      await writeAppState(`recording-stop-${meeting.recordingId}`, {
        recordingId: meeting.recordingId,
        meetingId: args.meetingId,
        requestedAt: nowIso,
      });
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { meetingId: args.meetingId, recordingId: meeting.recordingId };
  },
});
