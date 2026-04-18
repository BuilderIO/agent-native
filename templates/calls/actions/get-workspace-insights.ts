/**
 * Rollup analytics across all calls in a workspace: total calls, minutes
 * recorded this week/month, total views, top-5 most-viewed calls, and
 * tracker-hit trends per tracker over the last 30 days.
 *
 * Usage:
 *   pnpm action get-workspace-insights
 *   pnpm action get-workspace-insights --workspaceId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

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
    "Workspace-wide insights — total calls, minutes recorded this week/month, total counted views, top-5 most-viewed calls, and per-tracker hit trends over the last 30 days.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Workspace id — defaults to current-workspace app state, then user's first workspace.",
      ),
    days: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days for tracker trends"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    let workspaceId = args.workspaceId ?? null;
    if (!workspaceId) {
      const current = (await readAppState("current-workspace")) as {
        id?: string;
      } | null;
      workspaceId = current?.id ?? null;
    }
    if (!workspaceId) {
      try {
        workspaceId = await resolveDefaultWorkspaceId();
      } catch {
        workspaceId = null;
      }
    }
    if (!workspaceId) {
      return {
        workspaceId: null,
        totalCalls: 0,
        minutesThisWeek: 0,
        minutesThisMonth: 0,
        totalViews: 0,
        topCalls: [],
        trackerTrends: [],
      };
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const trendStart = startOfDay(
      new Date(now.getTime() - (args.days - 1) * 24 * 60 * 60 * 1000),
    );
    const trendStartIso = trendStart.toISOString();

    const calls = await db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.workspaceId, workspaceId));
    const callIds = calls.map((c) => c.id);
    const titleById = new Map(calls.map((c) => [c.id, c.title] as const));

    let minutesThisWeek = 0;
    let minutesThisMonth = 0;
    const weekCutoff = weekAgo.toISOString();
    const monthCutoff = monthAgo.toISOString();
    for (const c of calls) {
      if (c.trashedAt) continue;
      const anchor = c.recordedAt ?? c.createdAt;
      if (anchor >= weekCutoff) minutesThisWeek += c.durationMs / 60000;
      if (anchor >= monthCutoff) minutesThisMonth += c.durationMs / 60000;
    }

    const viewerRows = callIds.length
      ? await db
          .select()
          .from(schema.callViewers)
          .where(
            and(
              inArray(schema.callViewers.callId, callIds),
              eq(schema.callViewers.countedView, true),
            ),
          )
      : [];
    const totalViews = viewerRows.length;

    const viewsByCall: Record<string, number> = {};
    for (const v of viewerRows) {
      viewsByCall[v.callId] = (viewsByCall[v.callId] ?? 0) + 1;
    }
    const topCalls = Object.entries(viewsByCall)
      .map(([id, count]) => ({
        id,
        title: titleById.get(id) ?? "Untitled call",
        views: count,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    const trackerDefs = await db
      .select()
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.workspaceId, workspaceId));

    const hits = callIds.length
      ? await db
          .select()
          .from(schema.trackerHits)
          .where(
            and(
              inArray(schema.trackerHits.callId, callIds),
              gte(schema.trackerHits.createdAt, trendStartIso),
            ),
          )
      : [];

    const trackerTrends = trackerDefs.map((t) => {
      const series = new Map<string, { date: string; count: number }>();
      for (let i = 0; i < args.days; i++) {
        const d = new Date(trendStart.getTime() + i * 24 * 60 * 60 * 1000);
        const key = isoDate(d);
        series.set(key, { date: key, count: 0 });
      }
      for (const h of hits) {
        if (h.trackerId !== t.id) continue;
        const key = h.createdAt.slice(0, 10);
        const entry = series.get(key);
        if (entry) entry.count += 1;
      }
      return {
        trackerId: t.id,
        trackerName: t.name,
        trackerColor: t.color,
        series: Array.from(series.values()),
      };
    });

    return {
      workspaceId,
      totalCalls: calls.filter((c) => !c.trashedAt).length,
      minutesThisWeek: Math.round(minutesThisWeek),
      minutesThisMonth: Math.round(minutesThisMonth),
      totalViews,
      topCalls,
      trackerTrends,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void sql;
void writeAppState;
void accessFilter;
void assertAccess;
