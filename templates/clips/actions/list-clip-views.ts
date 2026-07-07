/**
 * List individual view records for a recording — who viewed it and when,
 * most recent first. Owner-only. This is the per-viewer timeline that backs
 * the "Viewed by" popover on the aggregate view count shown in the library
 * and clip detail insights panel.
 *
 * Distinct from `list-viewers` (aggregate per-viewer watch stats, one row per
 * viewer) — `list-clip-views` is an append-only log of counted-view moments,
 * so a returning viewer's second visit shows up as its own row with its own
 * timestamp.
 *
 * Usage:
 *   pnpm action list-clip-views --recordingId=<id> [--limit=50]
 */

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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

    return {
      views: rows.map((v) => ({
        id: v.id,
        viewerEmail: v.viewerEmail,
        // Anonymous rows store the `anon:<sessionId>` dedup key in
        // viewer_name (same convention as recording_viewers). Return null so
        // callers render "Someone" instead of the raw session key.
        viewerName: v.viewerName?.startsWith("anon:") ? null : v.viewerName,
        viewedAt: v.viewedAt,
      })),
    };
  },
});
