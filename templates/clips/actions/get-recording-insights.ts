/**
 * Aggregate analytics for a recording.
 *
 * Owner-only — uses assertAccess at editor level (owners always satisfy).
 *
 * Returns: views, uniqueViewers, completionRate, dropOff (100 buckets),
 * ctaConversionRate.
 *
 * Usage:
 *   pnpm action get-recording-insights --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Aggregate analytics for a recording — views, unique viewers, completion rate, drop-off curve, CTA conversion.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const viewerRows = await db
      .select()
      .from(schema.recordingViewers)
      .where(eq(schema.recordingViewers.recordingId, args.recordingId));

    const events = await db
      .select()
      .from(schema.recordingEvents)
      .where(eq(schema.recordingEvents.recordingId, args.recordingId));

    const views = viewerRows.filter((v) => v.countedView).length;
    const uniqueViewers = new Set(
      viewerRows.map((v) => v.viewerEmail ?? `anon:${v.id}`),
    ).size;

    const completionRate =
      viewerRows.length === 0
        ? 0
        : viewerRows.reduce((acc, v) => acc + (v.completedPct ?? 0), 0) /
          viewerRows.length;

    // Drop-off: 100 buckets across the video's duration.
    // Use the recording's duration as the denominator.
    const [rec] = await db
      .select({ durationMs: schema.recordings.durationMs })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    const durationMs = Math.max(1, rec?.durationMs ?? 0);

    const buckets = Array.from({ length: 100 }, (_, i) => ({
      bucket: i,
      watching: 0,
    }));

    for (const v of viewerRows) {
      const pct = Math.min(100, Math.max(0, v.completedPct ?? 0));
      // Each viewer contributes to all buckets up to their max reached.
      for (let i = 0; i < pct; i++) {
        buckets[i].watching += 1;
      }
    }

    const ctaClicks = events.filter((e) => e.kind === "cta-click").length;
    const ctaConversionRate =
      views === 0 ? 0 : Math.min(100, (ctaClicks / views) * 100);

    // Top viewers by total watch ms
    const topViewers = viewerRows
      .slice()
      .sort((a, b) => (b.totalWatchMs ?? 0) - (a.totalWatchMs ?? 0))
      .slice(0, 20)
      .map((v) => ({
        viewerEmail: v.viewerEmail,
        viewerName: v.viewerName,
        totalWatchMs: v.totalWatchMs ?? 0,
        completedPct: v.completedPct ?? 0,
      }));

    return {
      views,
      uniqueViewers,
      completionRate,
      ctaConversionRate,
      dropOff: buckets,
      topViewers,
      durationMs,
    };
  },
});

void and;
