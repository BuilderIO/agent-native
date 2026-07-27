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
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withFullVideoAiInstructions } from "../shared/clips-ai-prefs.js";
import { readIncludeFullVideoInAi } from "./lib/clips-ai-prefs.js";

export default defineAction({
  description:
    "Ask the agent to generate chapters for this recording based on its transcript (and the full video when Include full video is enabled). The agent identifies topic transitions and calls set-chapters.",
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
    const baseMessage =
      `Generate chapters for recording ${args.recordingId} (duration ${rec.durationMs}ms). ` +
      `Read the transcript segments in this request's context, identify topic transitions, ` +
      `and call \`set-chapters --recordingId=${args.recordingId} --chapters='[{ "startMs": 0, "title": "Intro" }, ...]'\`. ` +
      `Aim for 3–8 chapters. Each chapter title should be 3–6 words and capture the essence of that section.`;

    const request = {
      kind: "regenerate-chapters" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      durationMs: rec.durationMs,
      transcriptStatus: transcript?.status ?? "pending",
      segmentsJson: transcript?.segmentsJson ?? "[]",
      transcriptText: transcript?.fullText ?? "",
      includeFullVideoInAi,
      openInChat: args.openInChat === true,
      message: withFullVideoAiInstructions(
        baseMessage,
        args.recordingId,
        includeFullVideoInAi,
      ),
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Delegation queued: regenerate-chapters for ${args.recordingId}`,
    );
    return {
      queued: true,
      recordingId: args.recordingId,
      includeFullVideoInAi,
    };
  },
});
