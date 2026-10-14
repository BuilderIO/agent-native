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

// The handle a transition's transaction callback receives. Reads made inside
// that callback must use it: on PGlite, a query outside the open transaction
// waits for the transaction and never returns.
type RecordingContextDb = Pick<ReturnType<typeof getDb>, "select">;

// Trashes each footage recording the owner can still see. Footage that
// retention already deleted is no longer visible to the owner, so there is
// nothing left to trash.
export async function trashRecordingContextFootage(
  mediaRecordingIds: ReadonlyArray<string | null>,
  db: RecordingContextDb = getDb(),
): Promise<void> {
  const ids = new Set(
    mediaRecordingIds.filter((id): id is string => id !== null),
  );
  for (const id of ids) {
    const [media] = await db
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

// Trashes footage that a transition is about to release from its reservation.
// Call it inside that transition's transaction, after the item's row is locked
// and before the conditional update clears the reservation. A trash failure
// throws, which rolls the transaction back and leaves the reservation set.
//
// The released reservation still names `releasingItemId` until the update
// lands, so that one reservation is not counted as a reference. The item's own
// media is counted: a re-export that reserved the footage it already shows
// must keep that footage.
//
// Residual risk: getDb() routes the trash's writes onto this transaction, so a
// later failure should roll them back too. The vitest harness mocks both, so
// that is not tested. If the trash were not rolled back and the update then
// failed, the footage would stay trashed while the item still named it pending.
export async function trashReleasedFootage(
  tx: RecordingContextDb,
  mediaRecordingId: string,
  releasingItemId: string,
): Promise<void> {
  const [inUse] = await tx
    .select({ id: schema.recordingContextItems.id })
    .from(schema.recordingContextItems)
    .where(
      and(
        ne(schema.recordingContextItems.status, "removed"),
        or(
          eq(schema.recordingContextItems.mediaRecordingId, mediaRecordingId),
          and(
            eq(
              schema.recordingContextItems.pendingMediaRecordingId,
              mediaRecordingId,
            ),
            ne(schema.recordingContextItems.id, releasingItemId),
          ),
        ),
      ),
    )
    .limit(1);
  if (inUse) return;
  await trashRecordingContextFootage([mediaRecordingId], tx);
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
