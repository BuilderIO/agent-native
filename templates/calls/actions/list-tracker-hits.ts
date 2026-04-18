/**
 * List tracker hits for a call, optionally filtered by trackerId.
 *
 * Usage:
 *   pnpm action list-tracker-hits --callId=<id> [--trackerId=<tid>]
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List tracker hits for a call, joined with tracker metadata (name, color, kind). Optionally filter by trackerId.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    trackerId: z.string().optional().describe("Filter by tracker id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "viewer");

    const db = getDb();

    const where = args.trackerId
      ? and(
          eq(schema.trackerHits.callId, args.callId),
          eq(schema.trackerHits.trackerId, args.trackerId),
        )
      : eq(schema.trackerHits.callId, args.callId);

    const rows = await db
      .select({
        hitId: schema.trackerHits.id,
        trackerId: schema.trackerHits.trackerId,
        speakerLabel: schema.trackerHits.speakerLabel,
        segmentStartMs: schema.trackerHits.segmentStartMs,
        segmentEndMs: schema.trackerHits.segmentEndMs,
        quote: schema.trackerHits.quote,
        confidence: schema.trackerHits.confidence,
        createdAt: schema.trackerHits.createdAt,
        trackerName: schema.trackerDefinitions.name,
        trackerColor: schema.trackerDefinitions.color,
        trackerKind: schema.trackerDefinitions.kind,
      })
      .from(schema.trackerHits)
      .leftJoin(
        schema.trackerDefinitions,
        eq(schema.trackerDefinitions.id, schema.trackerHits.trackerId),
      )
      .where(where)
      .orderBy(asc(schema.trackerHits.segmentStartMs));

    const hits = rows.map((r) => ({
      id: r.hitId,
      trackerId: r.trackerId,
      trackerName: r.trackerName ?? "Deleted tracker",
      trackerColor: r.trackerColor ?? "#111111",
      trackerKind: r.trackerKind ?? "keyword",
      speakerLabel: r.speakerLabel,
      segmentStartMs: r.segmentStartMs,
      segmentEndMs: r.segmentEndMs,
      quote: r.quote,
      confidence: r.confidence,
      createdAt: r.createdAt,
    }));

    return { callId: args.callId, hits };
  },
});
