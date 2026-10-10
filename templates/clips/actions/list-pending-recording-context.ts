import { defineAction } from "@agent-native/core/action";
import { and, asc, eq, getTableColumns, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { staleProcessingCutoff } from "../server/lib/recording-context.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

// The desktop worker polls this. Oldest first, and bounded so a worker that
// was offline for a long time drains in batches instead of one huge response.
const PENDING_BATCH_LIMIT = 25;
const EXCLUDE_IDS_LIMIT = 100;

export default defineAction({
  description:
    "List pending earlier-screen-time requests on Clips the signed-in user owns, including processing claims stale enough that their worker is presumed gone. Pass excludeIds for items this device cannot process, so they do not hold up the batch. Used by the desktop worker that exports the footage.",
  schema: z.object({
    excludeIds: z
      .array(z.string().min(1))
      .max(EXCLUDE_IDS_LIMIT)
      .optional()
      .describe(
        "Item ids to leave out, sent as repeated excludeIds[] query parameters.",
      ),
  }),
  http: { method: "GET" },
  run: async ({ excludeIds }) => {
    const ownerEmail = getCurrentOwnerEmail();
    const items = await getDb()
      .select({ ...getTableColumns(schema.recordingContextItems) })
      .from(schema.recordingContextItems)
      .innerJoin(
        schema.recordings,
        eq(schema.recordings.id, schema.recordingContextItems.recordingId),
      )
      .where(
        and(
          or(
            eq(schema.recordingContextItems.status, "pending"),
            and(
              eq(schema.recordingContextItems.status, "processing"),
              lt(
                schema.recordingContextItems.updatedAt,
                staleProcessingCutoff(),
              ),
            ),
          ),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          excludeIds?.length
            ? notInArray(schema.recordingContextItems.id, excludeIds)
            : undefined,
        ),
      )
      .orderBy(asc(schema.recordingContextItems.createdAt))
      .limit(PENDING_BATCH_LIMIT);
    return { items };
  },
});
