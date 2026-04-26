/**
 * Save a browser-generated transcript (Web Speech API) for a recording.
 *
 * Called by the client immediately when recording stops — the Web Speech
 * API transcript is available instantly with zero API-key requirement.
 * Higher-quality backends (Groq Whisper, OpenAI Whisper) can refine this
 * later via `request-transcript`, silently replacing the browser draft.
 *
 * Usage:
 *   pnpm action save-browser-transcript --recordingId=<id> --fullText="..."
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

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

    return {
      recordingId: args.recordingId,
      status: "ready" as const,
      provider: "browser",
      chars: args.fullText.trim().length,
    };
  },
});
