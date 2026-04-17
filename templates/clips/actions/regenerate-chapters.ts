/**
 * Delegate: generate chapters for the recording from its transcript.
 *
 * The agent reads the transcript, identifies topic transitions, and calls the
 * Editor-team-owned `set-chapters` action with a chaptersJson array.
 *
 * Usage:
 *   pnpm action regenerate-chapters --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Ask the agent to generate chapters for this recording based on its transcript. The agent identifies topic transitions and calls set-chapters.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
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

    const request = {
      kind: "regenerate-chapters" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      durationMs: rec.durationMs,
      transcriptStatus: transcript?.status ?? "pending",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      transcriptText: transcript?.fullText ?? "",
      message:
        `Generate chapters for recording ${args.recordingId} (duration ${rec.durationMs}ms). ` +
        `Read the transcript segments in this request's context, identify topic transitions, ` +
        `and call \`set-chapters --recordingId=${args.recordingId} --chapters='[{ "startMs": 0, "title": "Intro" }, ...]'\`. ` +
        `Aim for 3–8 chapters. Each chapter title should be 3–6 words and capture the essence of that section.`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Delegation queued: regenerate-chapters for ${args.recordingId}`,
    );
    return { queued: true, recordingId: args.recordingId };
  },
});
