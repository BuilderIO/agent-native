import { defineAction } from "@agent-native/core/action";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
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
  schema: z
    .object({
      excludeIds: z
        .array(z.string().min(1))
        .max(EXCLUDE_IDS_LIMIT)
        .optional()
        .describe(
          "Item ids to leave out, sent as repeated excludeIds[] query parameters.",
        ),
      deviceId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "This desktop's device id, sent as the deviceId query parameter. Items another device captured are left out; items with no device are returned to every device.",
        ),
      afterCreatedAt: z.string().min(1).max(40).optional(),
      afterId: z.string().min(1).max(200).optional(),
    })
    .superRefine((input, context) => {
      if (
        (input.afterCreatedAt === undefined) !==
        (input.afterId === undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "Both cursor fields must be provided together.",
        });
      }
    }),
  http: { method: "GET" },
  run: async ({ excludeIds, deviceId, afterCreatedAt, afterId }) => {
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
          afterCreatedAt && afterId
            ? or(
                gt(schema.recordingContextItems.createdAt, afterCreatedAt),
                and(
                  eq(schema.recordingContextItems.createdAt, afterCreatedAt),
                  gt(schema.recordingContextItems.id, afterId),
                ),
              )
            : undefined,
          excludeIds?.length
            ? notInArray(schema.recordingContextItems.id, excludeIds)
            : undefined,
          deviceId
            ? or(
                isNull(schema.recordingContextItems.capturedDeviceId),
                eq(schema.recordingContextItems.capturedDeviceId, deviceId),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(schema.recordingContextItems.createdAt),
        asc(schema.recordingContextItems.id),
      )
      .limit(PENDING_BATCH_LIMIT + 1);
    const hasMore = items.length > PENDING_BATCH_LIMIT;
    const page = items.slice(0, PENDING_BATCH_LIMIT);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? { afterCreatedAt: last.createdAt, afterId: last.id }
          : null,
    };
  },
});
