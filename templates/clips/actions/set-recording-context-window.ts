import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadOwnedRecordingContextItem } from "../server/lib/recording-context.js";
import {
  isWindowWithin,
  type ScreenHistoryWindow,
} from "../shared/screen-history-context.js";
import { trashReleasedFootage } from "./remove-recording-context.js";

const REMOVED = {
  errorCode: "recording_context_removed",
  statusCode: 409,
} as const;

export default defineAction({
  description:
    "Trim an owned screen history item to a window inside its original window. The item returns to pending so the desktop re-exports the narrower footage. Only the window changes; the Clip's video does not.",
  schema: z.object({
    id: z.string(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
  }),
  run: async ({ id, startedAt, endedAt }) => {
    const item = await loadOwnedRecordingContextItem(id);
    if (item.status === "removed")
      fail("This screen history was removed.", REMOVED);

    const next: ScreenHistoryWindow = {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
    };
    const original: ScreenHistoryWindow = {
      startedAt: item.originalStartedAt,
      endedAt: item.originalEndedAt,
    };
    if (!isWindowWithin(original, next)) {
      fail(
        "The window must stay inside the original screen history and be at least 1 second long.",
        {
          errorCode: "recording_context_invalid_window",
          statusCode: 400,
        },
      );
    }

    const requestedSeconds = Math.round(
      (Date.parse(next.endedAt) - Date.parse(next.startedAt)) / 1000,
    );
    // The row is locked with the same predicate the update uses, so a removed
    // item locks nothing. Under the lock the trash runs before the reservation
    // is cleared, and a trash failure rolls the transaction back.
    const transitionWhere = and(
      eq(schema.recordingContextItems.id, id),
      ne(schema.recordingContextItems.status, "removed"),
    );
    const updated = await getDb().transaction(async (tx) => {
      const [locked] = await tx
        .select({
          pendingMediaRecordingId:
            schema.recordingContextItems.pendingMediaRecordingId,
        })
        .from(schema.recordingContextItems)
        .where(transitionWhere)
        .for("update");
      if (!locked) return undefined;

      if (locked.pendingMediaRecordingId) {
        await trashReleasedFootage(tx, locked.pendingMediaRecordingId, id);
      }

      const [updated] = await tx
        .update(schema.recordingContextItems)
        .set({
          startedAt: next.startedAt,
          endedAt: next.endedAt,
          requestedSeconds,
          status: "pending",
          error: null,
          // A reservation names the window it was claimed for. A new window
          // releases it, so the export that held it cannot land.
          pendingMediaRecordingId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(transitionWhere)
        .returning();
      // Unreachable: the row is locked, so the predicate that matched it still holds.
      if (!updated) {
        // guard:allow-bare-error — invariant: the row is locked by this transaction, so the predicate that matched it still holds
        throw new Error(
          `Screen history ${id} changed while its row was locked`,
        );
      }
      return updated;
    });
    // The only way a loaded, non-removed item fails the match is a concurrent remove.
    if (!updated) fail("This screen history was removed.", REMOVED);
    return updated;
  },
});
