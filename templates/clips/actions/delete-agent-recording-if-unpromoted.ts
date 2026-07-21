import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import deleteRecordingPermanent from "./delete-recording-permanent.js";

export default defineAction({
  description:
    "Delete an expired agent-created Clip only if it is still private and has not been renamed, shared, commented on, reacted to, tagged, archived, or trashed.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await assertAccess("recording", id, "editor");
    const db = getDb();
    const [recording] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, id));
    if (!recording) return { id, deleted: true, reason: "already-missing" };

    const [share, comment, reaction, tag] = await Promise.all([
      db
        .select({ id: schema.recordingShares.id })
        .from(schema.recordingShares)
        .where(eq(schema.recordingShares.resourceId, id))
        .limit(1),
      db
        .select({ id: schema.recordingComments.id })
        .from(schema.recordingComments)
        .where(eq(schema.recordingComments.recordingId, id))
        .limit(1),
      db
        .select({ id: schema.recordingReactions.id })
        .from(schema.recordingReactions)
        .where(eq(schema.recordingReactions.recordingId, id))
        .limit(1),
      db
        .select({ id: schema.recordingTags.id })
        .from(schema.recordingTags)
        .where(eq(schema.recordingTags.recordingId, id))
        .limit(1),
    ]);

    const promoted =
      recording.visibility !== "private" ||
      recording.titleSource === "manual" ||
      Boolean(recording.archivedAt || recording.trashedAt) ||
      share.length > 0 ||
      comment.length > 0 ||
      reaction.length > 0 ||
      tag.length > 0;
    if (promoted) {
      await db
        .update(schema.recordings)
        .set({ expiresAt: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.recordings.id, id));
      return { id, deleted: false, reason: "promoted" };
    }

    await deleteRecordingPermanent.run({ id });
    return { id, deleted: true, reason: "retention-expired" };
  },
});
