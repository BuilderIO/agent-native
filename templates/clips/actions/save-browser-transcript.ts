/**
 * Save a native transcript for a recording.
 *
 * Called by the web client (Web Speech API) and desktop client (macOS Speech)
 * immediately when recording stops. Native transcripts are available
 * instantly with no API-key requirement and are the primary transcript source.
 *
 * After saving, if the recording still has the default title we queue an
 * agent title-generation request so the clip gets a useful title.
 *
 * Usage:
 *   pnpm action save-browser-transcript --recordingId=<id> --fullText="..."
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import regenerateTitle from "./regenerate-title.js";

const DEFAULT_TITLE = "Untitled recording";

function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return !trimmed || trimmed === DEFAULT_TITLE;
}

export default defineAction({
  description:
    "Save a native transcript (Web Speech API or macOS Speech) for a recording. Provides an instant transcript with no API key required.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    fullText: z
      .string()
      .describe("Full transcript text from native speech recognition"),
    source: z
      .enum(["web-speech", "macos-native"])
      .optional()
      .describe("Native transcription source"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    if (!args.fullText.trim()) {
      return {
        recordingId: args.recordingId,
        status: "skipped" as const,
        reason: "Empty transcript",
      };
    }

    const [existing] = await db
      .select({ recordingId: schema.recordingTranscripts.recordingId })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    if (existing) {
      const [current] = await db
        .select({
          status: schema.recordingTranscripts.status,
          segmentsJson: schema.recordingTranscripts.segmentsJson,
        })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .limit(1);

      // Don't overwrite a completed Whisper transcript with lower-quality browser output
      const hasWhisperSegments =
        current?.status === "ready" &&
        current?.segmentsJson &&
        current.segmentsJson !== "[]";
      if (hasWhisperSegments) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "Whisper transcript already exists",
        };
      }

      await db
        .update(schema.recordingTranscripts)
        .set({
          ownerEmail,
          fullText: args.fullText.trim(),
          segmentsJson: "[]",
          status: "ready",
          failureReason: null,
          updatedAt: now,
        })
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));
    } else {
      await db.insert(schema.recordingTranscripts).values({
        recordingId: args.recordingId,
        ownerEmail,
        language: "en",
        segmentsJson: "[]",
        fullText: args.fullText.trim(),
        status: "ready",
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[clips] Native transcript saved for ${args.recordingId} via ${args.source ?? "web-speech"} (${args.fullText.trim().length} chars)`,
    );

    // Trigger title generation if the clip still has the default title. This
    // fires even when no cloud transcript provider is configured so native-only
    // recordings always get a real title once Builder is connected.
    const [rec] = await db
      .select({ title: schema.recordings.title })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);

    if (rec && isDefaultTitle(rec.title)) {
      try {
        await regenerateTitle.run({ recordingId: args.recordingId });
      } catch (err) {
        console.warn(
          `[clips] auto-title delegation failed for ${args.recordingId}:`,
          (err as Error).message,
        );
      }
    }

    return {
      recordingId: args.recordingId,
      status: "ready" as const,
      provider: args.source ?? "web-speech",
      chars: args.fullText.trim().length,
    };
  },
});
