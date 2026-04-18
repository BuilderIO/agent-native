/**
 * List viewers for a call, joined with a per-viewer event count. Editor-only.
 *
 * Usage:
 *   pnpm action list-viewers --callId=<id> [--limit=50]
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
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "List viewers for a call, sorted by total watch time, joined with a per-viewer event count. Editor-only.",
  schema: z.object({
    callId: z.string().describe("Call id"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Max rows to return"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const [viewerRows, eventRows] = await Promise.all([
      db
        .select()
        .from(schema.callViewers)
        .where(eq(schema.callViewers.callId, args.callId)),
      db
        .select({
          viewerId: schema.callEvents.viewerId,
        })
        .from(schema.callEvents)
        .where(eq(schema.callEvents.callId, args.callId)),
    ]);

    const eventsByViewer = new Map<string, number>();
    for (const e of eventRows) {
      if (!e.viewerId) continue;
      eventsByViewer.set(e.viewerId, (eventsByViewer.get(e.viewerId) ?? 0) + 1);
    }

    const viewers = viewerRows
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
        eventsCount: eventsByViewer.get(v.id) ?? 0,
        firstViewedAt: v.firstViewedAt,
        lastViewedAt: v.lastViewedAt,
      }));

    return { viewers, count: viewers.length };
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
