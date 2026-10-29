import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  mediaCleanupSummarySchema,
  mediaCleanupStatusSchema,
} from "../shared/media-cleanup.js";

export default defineAction({
  description:
    "List your pending, blocked or shared-retained recording media cleanups. A removed recording does not imply that its stored media has been deleted.",
  schema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe(
        "Maximum cleanup intents to return, from 1 to 100; defaults to 20",
      ),
  }),
  outputSchema: z.object({ cleanups: z.array(mediaCleanupSummarySchema) }),
  http: { method: "GET" },
  run: async ({ limit }) => {
    const ownerEmail = getCurrentOwnerEmail(),
      t = schema.recordingMediaCleanups,
      o = schema.recordingMediaCleanupObjects;
    const rows = await getDb()
      .select({
        id: t.id,
        recordingId: t.id,
        status: t.status,
        reason: t.reason,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        pending: sql<number>`count(*) FILTER (WHERE ${o.phase} NOT IN ('complete','blocked','retained_shared','external'))::integer`,
        blocked: sql<number>`count(*) FILTER (WHERE ${o.phase}='blocked')::integer`,
        deleted: sql<number>`count(*) FILTER (WHERE ${o.phase}='complete')::integer`,
        retained: sql<number>`count(*) FILTER (WHERE ${o.phase}='retained_shared')::integer`,
        external: sql<number>`count(*) FILTER (WHERE ${o.phase}='external')::integer`,
      })
      .from(t)
      .leftJoin(o, and(eq(o.recordingId, t.id), eq(o.ownerEmail, ownerEmail)))
      .where(
        and(
          eq(t.ownerEmail, ownerEmail),
          inArray(t.status, ["pending", "blocked", "retained_shared"]),
        ),
      )
      .groupBy(t.id, t.status, t.reason, t.createdAt, t.updatedAt)
      .orderBy(desc(t.updatedAt))
      .limit(limit);
    return {
      cleanups: rows.map((row) => ({
        ...row,
        status: mediaCleanupStatusSchema.parse(row.status),
      })),
    };
  },
});
