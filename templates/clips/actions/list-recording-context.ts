import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List the earlier screen-time context attached to a Clip, excluding removed items. The context is passive metadata; the Clip's video is never changed.",
  schema: z.object({ recordingId: z.string() }),
  http: { method: "GET" },
  run: async ({ recordingId }) => {
    // Must run before assertAccess: it answers 403 for a missing row too, and the
    // desktop needs 404 to trash footage for a permanently deleted Clip.
    const [recording] = await getDb()
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);
    if (!recording) {
      fail("Recording not found.", {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    await assertAccess("recording", recordingId, "viewer");
    const items = await getDb()
      .select()
      .from(schema.recordingContextItems)
      .where(
        and(
          eq(schema.recordingContextItems.recordingId, recordingId),
          ne(schema.recordingContextItems.status, "removed"),
        ),
      )
      .orderBy(desc(schema.recordingContextItems.createdAt));
    return { items };
  },
});
