import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withFullVideoAiInstructions } from "../shared/clips-ai-prefs.js";
import { CHAPTERS_BUSY, CHAPTERS_CHANGED } from "../shared/stored-chapters.js";
import {
  queueAiRequest,
  withAiRequestStatusInstructions,
} from "./lib/ai-request-status.js";
import { chaptersVersionOf } from "./lib/chapters-version.js";
import { readIncludeFullVideoInAi } from "./lib/clips-ai-prefs.js";

export default defineAction({
  description:
    "Ask the agent to generate chapters for this recording based on its transcript (and the full video when Include full video is enabled). The agent identifies topic transitions and calls set-chapters, guarded by the chapters as they were when asked.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    openInChat: z
      .boolean()
      .optional()
      .describe(
        "When true, focus the queued generation request in the agent chat instead of keeping it hidden.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [rec] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const includeFullVideoInAi = await readIncludeFullVideoInAi();
    // The new chapters replace these, and only these: an edit made while the
    // agent works makes set-chapters refuse rather than overwrite it.
    const expectedVersion = chaptersVersionOf(rec.chaptersJson);
    const baseMessage =
      `Generate chapters for recording ${args.recordingId} (duration ${rec.durationMs}ms). ` +
      `Read the transcript segments in this request's context, identify topic transitions, ` +
      `and call \`set-chapters --recordingId=${args.recordingId} --chapters='[{ "startMs": 0, "title": "Intro" }, ...]'\`. ` +
      `Aim for 3–8 chapters. Each chapter title should be 3–6 words and capture the essence of that section. ` +
      `Also pass --expectedVersion=${expectedVersion}. ` +
      `If set-chapters fails with errorCode ${CHAPTERS_CHANGED}, someone edited the chapters meanwhile: do not retry, and say the new chapters were not saved. On ${CHAPTERS_BUSY}, call it again with the same arguments. ` +
      `Never call set-chapters for this request without expectedVersion.`;

    const requestedAt = new Date().toISOString();
    const request = {
      kind: "regenerate-chapters" as const,
      recordingId: args.recordingId,
      requestedAt,
      durationMs: rec.durationMs,
      transcriptStatus: transcript?.status ?? "pending",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      transcriptText: transcript?.fullText ?? "",
      expectedVersion,
      includeFullVideoInAi,
      openInChat: args.openInChat === true,
      message: withAiRequestStatusInstructions({
        message: withFullVideoAiInstructions(
          baseMessage,
          args.recordingId,
          includeFullVideoInAi,
        ),
        recordingId: args.recordingId,
        kind: "regenerate-chapters",
        requestedAt,
      }),
    };

    await queueAiRequest({
      recordingId: args.recordingId,
      kind: "regenerate-chapters",
      requestedAt,
      request,
    });

    console.log(
      `Delegation queued: regenerate-chapters for ${args.recordingId}`,
    );
    return {
      queued: true,
      kind: "regenerate-chapters",
      requestedAt,
      recordingId: args.recordingId,
      includeFullVideoInAi,
    };
  },
});
