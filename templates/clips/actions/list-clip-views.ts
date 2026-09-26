
import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hydrateViewerNames } from "../server/lib/user-identities.js";

export default defineAction({
  description:
    "List individual view records for a recording (who viewed it and when), most recent first. Owner-only.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Max rows, most recent first"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.recordingViews)
      .where(eq(schema.recordingViews.recordingId, args.recordingId))
      .orderBy(desc(schema.recordingViews.viewedAt))
      .limit(args.limit);

    const viewRows = await hydrateViewerNames(rows);
    return {
      views: viewRows.map((v) => ({
        id: v.id,
        viewerEmail: v.viewerEmail,
        viewerName: v.viewerName,
        viewedAt: v.viewedAt,
      })),
    };
  },
});
