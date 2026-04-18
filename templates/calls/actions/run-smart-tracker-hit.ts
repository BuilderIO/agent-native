/**
 * Record a smart-tracker match. Called by the agent after it classifies a
 * paragraph as a hit.
 *
 * Usage (agent-only):
 *   pnpm action run-smart-tracker-hit --callId=<id> --trackerId=<tid> \
 *     --speakerLabel="Speaker 1" --segmentStartMs=12000 --segmentEndMs=14500 \
 *     --quote="We're concerned about pricing" --confidence=90
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Record a single smart-tracker hit. Called by the agent per match after run-trackers queues a smart-tracker delegation.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    trackerId: z.string().describe("Tracker ID"),
    speakerLabel: z.string().optional().describe("e.g. 'Speaker 1'"),
    segmentStartMs: z.coerce.number().int().min(0),
    segmentEndMs: z.coerce.number().int().min(0),
    quote: z.string().min(1).describe("Verbatim substring from the transcript"),
    confidence: z.coerce.number().min(0).max(100).default(80).describe("0-100"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();

    const [tracker] = await db
      .select({
        id: schema.trackerDefinitions.id,
        workspaceId: schema.trackerDefinitions.workspaceId,
      })
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.id, args.trackerId))
      .limit(1);
    if (!tracker) throw new Error(`Tracker not found: ${args.trackerId}`);

    const [call] = await db
      .select({ workspaceId: schema.calls.workspaceId })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);
    if (call.workspaceId !== tracker.workspaceId) {
      throw new Error("Tracker and call belong to different workspaces");
    }

    const id = nanoid();
    const nowIso = new Date().toISOString();
    const endMs = Math.max(args.segmentStartMs, args.segmentEndMs);

    await db.insert(schema.trackerHits).values({
      id,
      callId: args.callId,
      trackerId: args.trackerId,
      speakerLabel: args.speakerLabel ?? null,
      segmentStartMs: Math.max(0, args.segmentStartMs),
      segmentEndMs: endMs,
      quote: args.quote.trim(),
      confidence: Math.round(args.confidence),
      createdAt: nowIso,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id,
      callId: args.callId,
      trackerId: args.trackerId,
      quote: args.quote.trim(),
    };
  },
});

// reference to silence unused-import warnings if `and` isn't used yet
void and;
