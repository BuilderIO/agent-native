/**
 * Regenerate the recording's title using its transcript.
 *
 * Title generation is delegated to the agent chat. Server actions do not call
 * LLMs directly; instead, this action writes a structured request to
 * application_state and the app's UI bridge dispatches it to the agent.
 *
 * Usage:
 *   pnpm action regenerate-title --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Ask the agent to regenerate this recording's title based on its transcript. The agent reads the transcript from the delegation context and calls update-recording with the new title.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [rec] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const transcriptText = transcript?.fullText?.trim() ?? "";
    const request = {
      kind: "regenerate-title" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      currentTitle: rec.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText,
      message:
        `Regenerate the title for recording ${args.recordingId}. ` +
        `Read the transcript in this request's context and call ` +
        `\`update-recording --id=${args.recordingId} --title="..."\` with a concise ` +
        `4-9 word descriptive title. Current title: "${rec.title}".`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: regenerate-title for ${args.recordingId}`);
    return {
      queued: true,
      recordingId: args.recordingId,
    };
  },
});
