/**
 * Delegate: regenerate the recording's description from its transcript.
 *
 * See regenerate-title.ts for the delegation pattern.
 *
 * Usage:
 *   pnpm action regenerate-summary --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Ask the agent to regenerate this recording's description/summary based on its transcript.",
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
        description: schema.recordings.description,
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

    const request = {
      kind: "regenerate-summary" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      currentTitle: rec.title,
      currentDescription: rec.description,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText: transcript?.fullText ?? "",
      message:
        `Regenerate the description for recording ${args.recordingId}. ` +
        `Read the transcript in this request's context and call ` +
        `\`update-recording --id=${args.recordingId} --description="..."\` with a 2–4 ` +
        `sentence summary of what the recording covers. Title: "${rec.title}".`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Delegation queued: regenerate-summary for ${args.recordingId}`,
    );
    return { queued: true, recordingId: args.recordingId };
  },
});
