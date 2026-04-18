/**
 * Run enabled trackers for a single call.
 *
 * - Keyword trackers run synchronously (regex over diarized segments).
 * - Smart trackers are delegated to the agent chat via an app-state request.
 *
 * `kind` filter lets request-transcript run just the keyword trackers
 * synchronously on pipeline completion.
 *
 * Usage:
 *   pnpm action run-trackers --callId=<id> [--kind=keyword|smart|all]
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, parseJson } from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { runKeywordTracker } from "../server/lib/trackers/keyword-tracker.js";
import type { TranscriptSegment } from "../shared/api.js";

export default defineAction({
  description:
    "Run all enabled trackers against one call. Keyword trackers run synchronously and record hits. Smart trackers queue a delegation for the agent.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    kind: z
      .enum(["keyword", "smart", "all"])
      .default("all")
      .describe("Filter which tracker kinds to run"),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();

    const [call] = await db
      .select({
        id: schema.calls.id,
        workspaceId: schema.calls.workspaceId,
      })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);

    const [transcript] = await db
      .select()
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    const segments = parseJson<TranscriptSegment[]>(
      transcript?.segmentsJson,
      [],
    );
    if (!transcript || transcript.status !== "ready" || segments.length === 0) {
      return { ran: 0, trackers: [], reason: "transcript-not-ready" };
    }

    const trackers = await db
      .select()
      .from(schema.trackerDefinitions)
      .where(
        and(
          eq(schema.trackerDefinitions.workspaceId, call.workspaceId),
          eq(schema.trackerDefinitions.enabled, true),
        ),
      );

    const results: Array<{
      trackerId: string;
      name: string;
      kind: string;
      hits: number;
      delegated?: boolean;
    }> = [];
    let ran = 0;

    for (const tracker of trackers) {
      if (args.kind !== "all" && tracker.kind !== args.kind) continue;

      if (tracker.kind === "keyword") {
        const candidates = runKeywordTracker({
          tracker: { keywordsJson: tracker.keywordsJson },
          segments,
        });

        await db
          .delete(schema.trackerHits)
          .where(
            and(
              eq(schema.trackerHits.callId, args.callId),
              eq(schema.trackerHits.trackerId, tracker.id),
            ),
          );

        if (candidates.length > 0) {
          const nowIso = new Date().toISOString();
          await db.insert(schema.trackerHits).values(
            candidates.map((c) => ({
              id: nanoid(),
              callId: args.callId,
              trackerId: tracker.id,
              speakerLabel: c.speakerLabel,
              segmentStartMs: c.segmentStartMs,
              segmentEndMs: c.segmentEndMs,
              quote: c.quote,
              confidence: c.confidence,
              createdAt: nowIso,
            })),
          );
        }

        results.push({
          trackerId: tracker.id,
          name: tracker.name,
          kind: "keyword",
          hits: candidates.length,
        });
        ran += 1;
      } else if (tracker.kind === "smart") {
        const requestId = nanoid();
        await writeAppState(`ai-delegation-${args.callId}-${requestId}`, {
          kind: "smart-tracker",
          callId: args.callId,
          trackerId: tracker.id,
          trackerName: tracker.name,
          trackerDescription: tracker.description,
          classifierPrompt: tracker.classifierPrompt,
          requestId,
          ts: new Date().toISOString(),
          segmentsJson: transcript.segmentsJson,
          message:
            `Run smart tracker "${tracker.name}" against call ${args.callId}. ` +
            `For each paragraph that matches the criterion, call ` +
            `\`run-smart-tracker-hit --callId=${args.callId} --trackerId=${tracker.id} ` +
            `--speakerLabel=<label> --segmentStartMs=<n> --segmentEndMs=<n> ` +
            `--quote="<verbatim>" --confidence=<0-100>\`. ` +
            `Do not invent quotes — quotes must be verbatim sub-strings of the transcript.`,
        });

        results.push({
          trackerId: tracker.id,
          name: tracker.name,
          kind: "smart",
          hits: 0,
          delegated: true,
        });
        ran += 1;
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Ran ${ran} tracker(s) on call ${args.callId} (${args.kind})`);
    return { ran, trackers: results };
  },
});
