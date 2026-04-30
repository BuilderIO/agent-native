/**
 * Delegate: remove long silences from the recording.
 *
 * The agent analyzes the transcript segments to find gaps > N ms (default
 * 1200ms) and calls the Editor-team-owned `trim-recording` action with the
 * ranges to exclude.
 *
 * Usage:
 *   pnpm action remove-silences --recordingId=<id> [--thresholdMs=1200]
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Ask the agent to find long silences in the recording and delegate trimming them out via the Editor's trim-recording action.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    thresholdMs: z
      .number()
      .int()
      .min(300)
      .default(1200)
      .describe("Minimum gap (ms) to be considered a silence"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    if (!transcript || transcript.status !== "ready") {
      throw new Error(
        "Transcript must be ready before removing silences. Call request-transcript first.",
      );
    }

    const request = {
      kind: "remove-silences" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      thresholdMs: args.thresholdMs,
      segmentsJson: transcript.segmentsJson,
      message:
        `Find silences longer than ${args.thresholdMs}ms in recording ${args.recordingId} ` +
        `by analyzing the transcript segments (gaps between segment.endMs and the next segment.startMs). ` +
        `For each gap > ${args.thresholdMs}ms, add a trim range covering the silence minus a 200ms ` +
        `buffer on each side so speech isn't clipped. Then call ` +
        `\`trim-recording --recordingId=${args.recordingId} --startMs=<start> --endMs=<end>\` once for each silence.`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: remove-silences for ${args.recordingId}`);
    return { queued: true, recordingId: args.recordingId };
  },
});
