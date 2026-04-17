/**
 * List top viewers of a recording by watch time.
 *
 * Usage:
 *   pnpm action list-viewers --recordingId=<id> [--limit=12]
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List top viewers of a recording, sorted by total watch time. Owner-only.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    limit: z.number().int().min(1).max(100).default(12).describe("Max rows"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.recordingViewers)
      .where(eq(schema.recordingViewers.recordingId, args.recordingId));

    const viewers = rows
      .slice()
      .sort((a, b) => (b.totalWatchMs ?? 0) - (a.totalWatchMs ?? 0))
      .slice(0, args.limit)
      .map((v) => ({
        id: v.id,
        viewerEmail: v.viewerEmail,
        viewerName: v.viewerName,
        totalWatchMs: v.totalWatchMs ?? 0,
        completedPct: v.completedPct ?? 0,
        countedView: Boolean(v.countedView),
        ctaClicked: Boolean(v.ctaClicked),
        firstViewedAt: v.firstViewedAt,
        lastViewedAt: v.lastViewedAt,
      }));

    return { viewers };
  },
});
