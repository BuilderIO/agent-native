import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  countRecordingAgentViews,
  listRecordingAgentViewers,
} from "../server/lib/agent-views.js";
import { hydrateViewerNames } from "../server/lib/user-identities.js";
import {
  clampCompletionPct,
  isCountedViewerRow,
} from "../shared/view-analytics.js";

export default defineAction({
  description:
    "Aggregate analytics for a recording — views, unique viewers, reactions, completion rate, drop-off curve, CTA conversion.",
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

    const [[viewLogRow], agentViews, agentViewers, [reactionCountRow]] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(schema.recordingViews)
          .where(eq(schema.recordingViews.recordingId, args.recordingId)),
        countRecordingAgentViews(args.recordingId),
        listRecordingAgentViewers(args.recordingId),
        db
          .select({ value: count() })
          .from(schema.recordingReactions)
          .where(eq(schema.recordingReactions.recordingId, args.recordingId)),
      ]);

    const countedViewerRows = viewerRows.filter(isCountedViewerRow);
    const countedViewers = countedViewerRows.length;
    const uniqueViewers = new Set(
      countedViewerRows.map((v) => v.viewerEmail ?? `anon:${v.id}`),
    ).size;

    // Mirrors `countRecordingViews`: `recording_views` only exists from
    // migration v46, so clips recorded before it have zero log rows. Floor the
    // total at the counted-viewer count so those clips keep reporting a real
    // number instead of 0, and so total can never read below uniqueViewers.
    const views = Math.max(Number(viewLogRow?.value ?? 0), countedViewers);

    const completionRate =
      countedViewers === 0
        ? null
        : countedViewerRows.reduce(
            (acc, v) => acc + clampCompletionPct(v.completedPct),
            0,
          ) / countedViewers;

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
      const pct = clampCompletionPct(v.completedPct);
      for (let i = 0; i < pct; i++) {
        buckets[i].watching += 1;
      }
    }

    const ctaClicks = events.filter((e) => e.kind === "cta-click").length;
    const ctaConversionRate =
      countedViewers === 0
        ? null
        : Math.min(100, (ctaClicks / countedViewers) * 100);
    const reactions = Number(reactionCountRow?.value ?? 0);

    const topViewers = (
      await hydrateViewerNames(
        viewerRows
          .slice()
          .sort((a, b) => (b.totalWatchMs ?? 0) - (a.totalWatchMs ?? 0))
          .slice(0, 20),
      )
    ).map((v) => ({
      viewerEmail: v.viewerEmail,
      viewerName: v.viewerName,
      totalWatchMs: v.totalWatchMs ?? 0,
      completedPct: clampCompletionPct(v.completedPct),
    }));

    return {
      views,
      agentViews,
      agentViewers,
      uniqueViewers,
      reactions,
      completionRate,
      ctaConversionRate,
      dropOff: buckets,
      topViewers,
      durationMs,
    };
  },
});
