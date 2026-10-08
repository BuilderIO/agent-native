import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { computeSilenceTrimRanges } from "../shared/silence-ranges.js";
import { parseTranscriptSegments } from "../shared/transcript-segments.js";
import { applyTrims } from "./lib/apply-trims.js";

export default defineAction({
  description:
    "Trim long silences out of a recording. Finds gaps between transcript segments longer than thresholdMs and excludes each gap (keeping 200ms of padding beside speech) in one edit. Call this directly; do not compute gaps or call trim-recording per silence yourself.",
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

    const ranges = computeSilenceTrimRanges(
      parseTranscriptSegments(transcript.segmentsJson),
      args.thresholdMs,
    );
    if (ranges.length === 0) {
      return {
        recordingId: args.recordingId,
        updated: false,
        silencesRemoved: 0,
        removedMs: 0,
      };
    }

    const { editsJson, trimCount } = await applyTrims(args.recordingId, ranges);
    const removedMs = ranges.reduce(
      (total, range) => total + range.endMs - range.startMs,
      0,
    );
    console.log(
      `Removed ${ranges.length} silences (${removedMs} ms) from ${args.recordingId}`,
    );
    return {
      recordingId: args.recordingId,
      updated: true,
      silencesRemoved: ranges.length,
      removedMs,
      trimCount,
      editsJson,
    };
  },
});
