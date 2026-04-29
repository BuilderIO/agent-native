/**
 * Save a browser-generated transcript (Web Speech API) for a recording.
 *
 * Called by the client immediately when recording stops — the Web Speech
 * API transcript is available instantly with zero API-key requirement.
 * Higher-quality backends (Groq Whisper, OpenAI Whisper) can refine this
 * later via `request-transcript`, silently replacing the browser draft.
 *
 * After saving, if the recording still has the default title we queue a
 * title-generation delegation so the agent can produce a real title from
 * the transcript even before Whisper runs (or when Whisper isn't configured).
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
    "Save a browser-generated (Web Speech API) transcript for a recording. Provides an instant transcript with no API key required. Whisper can refine it later.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    fullText: z.string().describe("Full transcript text from Web Speech API"),
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
      `[clips] Browser transcript saved for ${args.recordingId} (${args.fullText.trim().length} chars)`,
    );

    // Queue a title-generation delegation if the clip still has the default
    // title. This fires even when no Whisper provider is configured so that
    // browser-only recordings always get a real title.
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
      provider: "browser",
      chars: args.fullText.trim().length,
    };
  },
});
