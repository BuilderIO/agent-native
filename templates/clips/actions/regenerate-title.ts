/**
 * Regenerate the recording's title using its transcript.
 *
 * Title generation uses the same Gemini 3.1 Flash-Lite media-pipeline path as
 * transcript cleanup so a freshly recorded clip can get a useful title without
 * waiting for the agent chat bridge. If the fast path is unavailable, we still
 * queue the older agent-chat request as a fallback.
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
import cleanupTranscript from "./cleanup-transcript.js";

const DEFAULT_TITLE = "Untitled recording";

function transcriptTextFromSegments(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((segment) =>
        typeof segment?.text === "string" ? segment.text.trim() : "",
      )
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return !trimmed || trimmed === DEFAULT_TITLE;
}

function cleanGeneratedTitle(raw: string | null | undefined): string | null {
  const title = (raw ?? "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  return title.slice(0, 80);
}

export default defineAction({
  description:
    "Regenerate this recording's title from its transcript using the Gemini 3.1 Flash-Lite cleanup/title path, falling back to the agent chat bridge when unavailable.",
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

    const transcriptText =
      transcript?.fullText?.trim() ||
      transcriptTextFromSegments(transcript?.segmentsJson);
    if (transcript?.status !== "ready" || !transcriptText) {
      throw new Error(
        "Transcript is not ready yet. Try again after transcription finishes.",
      );
    }

    try {
      const result = await cleanupTranscript.run({
        transcript: transcriptText,
        task: "title",
        context:
          rec.title && !isDefaultTitle(rec.title)
            ? `Current title: ${rec.title}`
            : undefined,
      });
      const generatedTitle = cleanGeneratedTitle(result.title);

      if (generatedTitle) {
        const [fresh] = await db
          .select({ title: schema.recordings.title })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);

        if (!fresh) throw new Error(`Recording not found: ${args.recordingId}`);

        if (isDefaultTitle(fresh.title) || fresh.title === rec.title) {
          await db
            .update(schema.recordings)
            .set({
              title: generatedTitle,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.recordings.id, args.recordingId));
          await writeAppState("refresh-signal", { ts: Date.now() });

          console.log(
            `Regenerated title for ${args.recordingId} via ${result.provider}: ${generatedTitle}`,
          );
          return {
            updated: true,
            recordingId: args.recordingId,
            title: generatedTitle,
            provider: result.provider,
          };
        }

        return {
          updated: false,
          skipped: true,
          reason: "Recording title changed before generation completed",
          recordingId: args.recordingId,
        };
      }
    } catch (err) {
      console.warn(
        `[clips] Gemini title generation failed for ${args.recordingId}; falling back to agent bridge:`,
        (err as Error).message,
      );
    }

    const request = {
      kind: "regenerate-title" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      currentTitle: rec.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText,
      segmentsJson: transcript?.segmentsJson ?? "[]",
      message:
        `Regenerate the title for recording ${args.recordingId}. ` +
        `Read the transcript in this request's context and call ` +
        `\`update-recording --id=${args.recordingId} --title="..."\` with a concise ` +
        `4-9 word descriptive title. Current title: "${rec.title}". ` +
        "Do not prompt the user.",
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
