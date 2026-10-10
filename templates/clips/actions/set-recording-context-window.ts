import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadOwnedRecordingContextItem } from "../server/lib/recording-context.js";
import {
  isWindowWithin,
  type ScreenHistoryWindow,
} from "../shared/screen-history-context.js";

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
    const [updated] = await getDb()
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
      .where(
        and(
          eq(schema.recordingContextItems.id, id),
          ne(schema.recordingContextItems.status, "removed"),
        ),
      )
      .returning();
    // The only way a loaded, non-removed item fails this match is a concurrent remove.
    if (!updated) fail("This screen history was removed.", REMOVED);
    return updated;
  },
});
