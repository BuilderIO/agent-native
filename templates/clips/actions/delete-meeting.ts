import { defineAction } from "@agent-native/core/action";
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
