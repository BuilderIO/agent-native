/**
 * Delegate: remove filler words (um, uh, like, you know, etc.) from the
 * recording.
 *
 * The agent analyzes the transcript segments, identifies filler-word
 * timestamps, and calls the Editor-team-owned `trim-recording` action with
 * the ranges to exclude. The edits are non-destructive (stored in editsJson).
 *
 * Usage:
 *   pnpm action remove-filler-words --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Ask the agent to identify filler words (um, uh, like, etc.) in the transcript and delegate trimming them out via the Editor's trim-recording action.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
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
        "Transcript must be ready before removing filler words. Call request-transcript first.",
      );
    }

    const request = {
      kind: "remove-filler-words" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      segmentsJson: transcript.segmentsJson,
      message:
        `Identify filler words in recording ${args.recordingId} and trim them out. ` +
        `Read the transcript segments from this request's context. Filler words include: ` +
        `"um", "uh", "er", "ah", "like" (when used as filler), "you know", "I mean", ` +
        `"basically", "actually" (repeated). For each filler, estimate its startMs/endMs ` +
        `within the segment. Then call \`trim-recording --recordingId=${args.recordingId} --startMs=<start> --endMs=<end>\` once for each filler. ` +
        `Be conservative — only trim unambiguous fillers; do NOT cut meaningful speech.`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Delegation queued: remove-filler-words for ${args.recordingId}`,
    );
    return { queued: true, recordingId: args.recordingId };
  },
});
