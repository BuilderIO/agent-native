import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";
import {
  isTranscriptReady,
  resolveTranscriptPresentation,
} from "../shared/transcript-status.js";
import {
  queueBackgroundAiRequest,
  withAiRequestStatusInstructions,
} from "./lib/ai-request-status.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

export default defineAction({
  description:
    "Ask the agent to identify filler words (um, uh, like, etc.) in the transcript and delegate trimming them out via the Editor's trim-recording action.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    assertRecordingNotExpired(
      await assertAccess("recording", args.recordingId, "editor"),
    );

    const db = getDb();
    const [recording] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!recording) {
      fail(`Recording not found: ${args.recordingId}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    assertNativeRecordingMedia(recording);

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const transcriptPresentation = resolveTranscriptPresentation(transcript);
    if (!isTranscriptReady(transcriptPresentation.status)) {
      const transcriptPending = transcriptPresentation.status === "pending";
      fail(
        transcriptPending
          ? "Transcript is still being generated. Try removing filler words after it finishes."
          : "Transcript must be ready before removing filler words. Call request-transcript first.",
        {
          errorCode: transcriptPending
            ? "transcript_pending"
            : "transcript_not_ready",
          statusCode: 409,
        },
      );
    }

    const requestedAt = new Date().toISOString();
    const message =
      `Identify filler words in recording ${args.recordingId} and trim them out. ` +
      `Read the transcript segments from this request's context. Filler words include: ` +
      `"um", "uh", "er", "ah", "like" (when used as filler), "you know", "I mean", ` +
      `"basically", "actually" (repeated). For each filler, estimate its startMs/endMs ` +
      `within the segment. Then call \`trim-recording --recordingId=${args.recordingId} --startMs=<start> --endMs=<end>\` once for each filler. ` +
      `Be conservative — only trim unambiguous fillers; do NOT cut meaningful speech.`;
    const request = {
      kind: "remove-filler-words" as const,
      recordingId: args.recordingId,
      requestedAt,
      segmentsJson: transcript.segmentsJson,
      message: withAiRequestStatusInstructions({
        message,
        recordingId: args.recordingId,
        kind: "remove-filler-words",
        requestedAt,
      }),
    };

    await queueBackgroundAiRequest({
      recordingId: args.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      request,
    });

    console.log(
      `Delegation queued: remove-filler-words for ${args.recordingId}`,
    );
    return {
      queued: true,
      kind: "remove-filler-words",
      requestedAt,
      recordingId: args.recordingId,
    };
  },
});
