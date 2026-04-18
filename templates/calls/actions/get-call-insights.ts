/**
 * Aggregate metrics for a single call: total counted views, unique viewers,
 * average completion %, drop-off curve (20 buckets per 5% of durationMs),
 * total comments, and tracker hit counts.
 *
 * Usage:
 *   pnpm action get-call-insights --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Aggregate metrics for a call: total counted views, unique viewers, avg completion %, drop-off curve (20 buckets of 5%), total comments, and tracker hit counts. Editor-only.",
  schema: z.object({
    callId: z.string().describe("Call id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const [call] = await db
      .select({
        durationMs: schema.calls.durationMs,
        title: schema.calls.title,
      })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);

    const [viewers, comments, trackerHits, trackerDefs] = await Promise.all([
      db
        .select()
        .from(schema.callViewers)
        .where(eq(schema.callViewers.callId, args.callId)),
      db
        .select({ id: schema.callComments.id })
        .from(schema.callComments)
        .where(eq(schema.callComments.callId, args.callId)),
      db
        .select()
        .from(schema.trackerHits)
        .where(eq(schema.trackerHits.callId, args.callId)),
      db.select().from(schema.trackerDefinitions),
    ]);

    const totalViews = viewers.filter((v) => v.countedView).length;
    const uniqueViewers = new Set(
      viewers.map((v) => v.viewerEmail ?? `anon:${v.id}`),
    ).size;
    const avgCompletionPct =
      viewers.length === 0
        ? 0
        : viewers.reduce((acc, v) => acc + (v.completedPct ?? 0), 0) /
          viewers.length;

    const buckets = Array.from({ length: 20 }, (_, i) => ({
      bucket: i,
      startPct: i * 5,
      endPct: (i + 1) * 5,
      watching: 0,
    }));
    for (const v of viewers) {
      const pct = Math.min(100, Math.max(0, v.completedPct ?? 0));
      const reached = Math.min(20, Math.floor(pct / 5));
      for (let i = 0; i < reached; i++) {
        buckets[i].watching += 1;
      }
    }

    const trackerDefById = new Map(trackerDefs.map((t) => [t.id, t] as const));
    const hitCounts: Record<string, number> = {};
    for (const h of trackerHits) {
      hitCounts[h.trackerId] = (hitCounts[h.trackerId] ?? 0) + 1;
    }
    const trackerCounts = Object.entries(hitCounts).map(
      ([trackerId, count]) => ({
        trackerId,
        trackerName: trackerDefById.get(trackerId)?.name ?? "Unknown",
        trackerColor: trackerDefById.get(trackerId)?.color ?? "#111111",
        count,
      }),
    );
    trackerCounts.sort((a, b) => b.count - a.count);

    return {
      callId: args.callId,
      title: call.title,
      durationMs: call.durationMs,
      totalViews,
      uniqueViewers,
      avgCompletionPct,
      dropOff: buckets,
      totalComments: comments.length,
      trackerCounts,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
