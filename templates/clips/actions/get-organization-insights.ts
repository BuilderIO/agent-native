/**
 * Aggregate analytics across an entire organization.
 *
 * Produces:
 *   - totals for the period (views, reactions, comments, recordings)
 *   - top videos by counted views / reactions / comments
 *   - top creators (by recordings, views, engagement)
 *   - day-by-day engagement trend (views + reactions + comments per day)
 *
 * Usage:
 *   pnpm action get-organization-insights
 *   pnpm action get-organization-insights --organizationId=<id> --days=14
 */

import { defineAction } from "@agent-native/core";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/recordings.js";

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default defineAction({
  description:
    "Organization-wide insights for the Insights Hub. Returns totals for the period, top videos by views / reactions / comments, top creators, and a day-by-day engagement trend time series. Default period is the last 30 days.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe(
        "Organization id — falls back to the caller's active organization when omitted.",
      ),
    days: z.coerce.number().int().min(1).max(365).default(30),
    topN: z.coerce.number().int().min(1).max(50).default(10),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const organizationId =
      args.organizationId || (await getActiveOrganizationId());
    if (!organizationId) {
      return {
        organizationId: null,
        period: { days: args.days, start: null, end: null },
        totals: { views: 0, reactions: 0, comments: 0, recordings: 0 },
        topVideos: { byViews: [], byReactions: [], byComments: [] },
        topCreators: [],
        trend: [],
      };
    }

    const now = new Date();
    const start = startOfDay(
      new Date(now.getTime() - (args.days - 1) * 24 * 60 * 60 * 1000),
    );
    const startIso = start.toISOString();
    const endIso = now.toISOString();

    // All recordings in this organization. Filter engagement down to this set.
    const recordings = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.organizationId, organizationId));
    const recordingIds = recordings.map((r) => r.id);
    const titleById = new Map(recordings.map((r) => [r.id, r.title] as const));
    const ownerById = new Map(
      recordings.map((r) => [r.id, r.ownerEmail] as const),
    );

    // Totals for the period.
    const totals = {
      views: 0,
      reactions: 0,
      comments: 0,
      recordings: recordings.filter(
        (r) => r.createdAt >= startIso && !r.trashedAt,
      ).length,
    };

    // Views: counted viewers first-viewed within the period.
    const viewerRows = recordingIds.length
      ? await db
          .select()
          .from(schema.recordingViewers)
          .where(
            and(
              inArray(schema.recordingViewers.recordingId, recordingIds),
              eq(schema.recordingViewers.countedView, true),
              gte(schema.recordingViewers.firstViewedAt, startIso),
            ),
          )
      : [];
    totals.views = viewerRows.length;

    const reactionRows = recordingIds.length
      ? await db
          .select()
          .from(schema.recordingReactions)
          .where(
            and(
              inArray(schema.recordingReactions.recordingId, recordingIds),
              gte(schema.recordingReactions.createdAt, startIso),
            ),
          )
      : [];
    totals.reactions = reactionRows.length;

    const commentRows = recordingIds.length
      ? await db
          .select()
          .from(schema.recordingComments)
          .where(
            and(
              inArray(schema.recordingComments.recordingId, recordingIds),
              gte(schema.recordingComments.createdAt, startIso),
            ),
          )
      : [];
    totals.comments = commentRows.length;

    // Top videos.
    const viewsByRec: Record<string, number> = {};
    for (const v of viewerRows) {
      viewsByRec[v.recordingId] = (viewsByRec[v.recordingId] ?? 0) + 1;
    }
    const reactionsByRec: Record<string, number> = {};
    for (const r of reactionRows) {
      reactionsByRec[r.recordingId] = (reactionsByRec[r.recordingId] ?? 0) + 1;
    }
    const commentsByRec: Record<string, number> = {};
    for (const c of commentRows) {
      commentsByRec[c.recordingId] = (commentsByRec[c.recordingId] ?? 0) + 1;
    }

    const mk = (counts: Record<string, number>) =>
      Object.entries(counts)
        .map(([id, count]) => ({
          id,
          title: titleById.get(id) ?? "Untitled",
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, args.topN);

    const topVideos = {
      byViews: mk(viewsByRec),
      byReactions: mk(reactionsByRec),
      byComments: mk(commentsByRec),
    };

    // Top creators — combine views + reactions + comments per owner, over the period.
    const creatorStats: Record<
      string,
      { email: string; recordings: number; views: number; engagement: number }
    > = {};
    for (const r of recordings) {
      const email = r.ownerEmail;
      creatorStats[email] ??= {
        email,
        recordings: 0,
        views: 0,
        engagement: 0,
      };
      creatorStats[email].recordings += 1;
    }
    for (const v of viewerRows) {
      const email = ownerById.get(v.recordingId);
      if (email && creatorStats[email]) creatorStats[email].views += 1;
    }
    for (const r of reactionRows) {
      const email = ownerById.get(r.recordingId);
      if (email && creatorStats[email]) creatorStats[email].engagement += 1;
    }
    for (const c of commentRows) {
      const email = ownerById.get(c.recordingId);
      if (email && creatorStats[email]) creatorStats[email].engagement += 1;
    }
    const topCreators = Object.values(creatorStats)
      .sort((a, b) => b.views + b.engagement - (a.views + a.engagement))
      .slice(0, args.topN);

    // Trend: per-day tallies for the period.
    const trendMap = new Map<
      string,
      { date: string; views: number; reactions: number; comments: number }
    >();
    for (let i = 0; i < args.days; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = isoDate(d);
      trendMap.set(key, { date: key, views: 0, reactions: 0, comments: 0 });
    }
    function bumpTrend(kind: "views" | "reactions" | "comments", iso: string) {
      const day = iso.slice(0, 10);
      const entry = trendMap.get(day);
      if (entry) entry[kind] += 1;
    }
    for (const v of viewerRows) bumpTrend("views", v.firstViewedAt);
    for (const r of reactionRows) bumpTrend("reactions", r.createdAt);
    for (const c of commentRows) bumpTrend("comments", c.createdAt);
    const trend = Array.from(trendMap.values());

    return {
      organizationId,
      period: { days: args.days, start: startIso, end: endIso },
      totals,
      topVideos,
      topCreators,
      trend,
    };
  },
});
