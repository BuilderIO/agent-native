import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadOwnedRecordingContextItem } from "../server/lib/recording-context.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import trashRecording from "./trash-recording.js";

export default defineAction({
  description:
    "Remove an owned screen history item and trash its footage recording. Removing an item that is already removed returns it unchanged.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const item = await loadOwnedRecordingContextItem(id);
    if (item.status === "removed") return item;

    // Trash the footage first. If that throws, the item stays active and the
    // same call can be retried; marking it removed first would strand footage.
    if (item.mediaRecordingId) {
      const [media] = await getDb()
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, item.mediaRecordingId),
            ownerEmailMatches(
              schema.recordings.ownerEmail,
              getCurrentOwnerEmail(),
            ),
          ),
        );
      // Footage that retention already deleted is no longer visible to the owner, so there is nothing left to trash.
      if (media) await trashRecording.run({ id: media.id });
    }

    const [removed] = await getDb()
      .update(schema.recordingContextItems)
      .set({ status: "removed", updatedAt: new Date().toISOString() })
      .where(eq(schema.recordingContextItems.id, id))
      .returning();
    if (!removed) {
      fail("This screen history context was not found.", {
        errorCode: "recording_context_not_found",
        statusCode: 404,
      });
    }
    return removed;
  },
});
