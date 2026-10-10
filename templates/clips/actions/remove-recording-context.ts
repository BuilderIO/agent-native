import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadOwnedRecordingContextItem } from "../server/lib/recording-context.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import trashRecording from "./trash-recording.js";

// Trashes each footage recording the owner can still see. Footage that
// retention already deleted is no longer visible to the owner, so there is
// nothing left to trash.
export async function trashRecordingContextFootage(
  mediaRecordingIds: ReadonlyArray<string | null>,
): Promise<void> {
  const ids = new Set(
    mediaRecordingIds.filter((id): id is string => id !== null),
  );
  for (const id of ids) {
    const [media] = await getDb()
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, id),
          ownerEmailMatches(
            schema.recordings.ownerEmail,
            getCurrentOwnerEmail(),
          ),
        ),
      );
    if (media) await trashRecording.run({ id: media.id });
  }
}

// Trashes footage that a transition released from a reservation. Call it only
// after that transition's conditional update has succeeded, so a rejected
// transition trashes nothing. Footage a live item still names, as its media or
// its reservation, is kept. A failure is logged, not thrown: the release has
// already happened, and a retry could not undo it.
export async function trashReleasedFootage(
  mediaRecordingId: string,
): Promise<void> {
  try {
    const [inUse] = await getDb()
      .select({ id: schema.recordingContextItems.id })
      .from(schema.recordingContextItems)
      .where(
        and(
          ne(schema.recordingContextItems.status, "removed"),
          or(
            eq(schema.recordingContextItems.mediaRecordingId, mediaRecordingId),
            eq(
              schema.recordingContextItems.pendingMediaRecordingId,
              mediaRecordingId,
            ),
          ),
        ),
      )
      .limit(1);
    if (inUse) return;
    await trashRecordingContextFootage([mediaRecordingId]);
  } catch (err) {
    console.warn(
      `[recording-context] could not trash released footage ${mediaRecordingId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export default defineAction({
  description:
    "Remove an owned screen history item and trash its footage recordings, including footage an export is still reserving. Removing an item that is already removed returns it unchanged.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const item = await loadOwnedRecordingContextItem(id);
    if (item.status === "removed") return item;

    // Trash the footage first. If that throws, the item stays active and the
    // same call can be retried; marking it removed first would strand footage.
    await trashRecordingContextFootage([
      item.mediaRecordingId,
      item.pendingMediaRecordingId,
    ]);

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
