/**
 * Regenerate the recording's title using its transcript.
 *
 * Default title generation is intentionally small and direct: once a native
 * macOS/Web transcript exists, this action asks Builder's Gemini Flash-Lite
 * model for a concise title and writes it immediately. If Builder is not
 * connected, we leave a request for the UI bridge so the user can be asked to
 * connect Builder before retrying.
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
import { generateTitleFromTranscript } from "../server/lib/ai-title.js";

export default defineAction({
  description:
    "Regenerate this recording's title from its transcript using Builder.io Gemini Flash-Lite. If Builder is not connected, queue a UI request asking the user to connect Builder.",
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
    const generated = await generateTitleFromTranscript(transcriptText);

    if (generated.status === "ready") {
      const now = new Date().toISOString();
      await db
        .update(schema.recordings)
        .set({ title: generated.title, updatedAt: now })
        .where(eq(schema.recordings.id, args.recordingId));
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.log(
        `Generated title for ${args.recordingId} via ${generated.model}: ${generated.title}`,
      );
      return {
        updated: true,
        recordingId: args.recordingId,
        title: generated.title,
        provider: generated.provider,
        model: generated.model,
      };
    }

    const request = {
      kind: "regenerate-title" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      currentTitle: rec.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText,
      requiresBuilderConnection:
        generated.reason === "builder_not_connected" ? true : undefined,
      message:
        generated.reason === "builder_not_connected"
          ? `Automatic titles for recording ${args.recordingId} need Builder.io connected. Ask the user to connect Builder.io in Settings, then retry title generation.`
          : `Regenerate the title for recording ${args.recordingId}. Read the transcript in this request's context and call \`update-recording --id=${args.recordingId} --title="..."\` with a concise 4-9 word descriptive title. Current title: "${rec.title}".`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Title generation queued for ${args.recordingId}: ${generated.reason}`,
    );
    return {
      queued: true,
      recordingId: args.recordingId,
      reason: generated.reason,
      model: generated.model,
    };
  },
});
