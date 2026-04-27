/**
 * Save a browser-generated transcript (Web Speech API) for a call.
 *
 * Called by the client immediately when recording stops — the Web Speech
 * API transcript is available instantly with zero API-key requirement.
 * Higher-quality backends (Deepgram) can refine this later via
 * `request-transcript`, silently replacing the browser draft.
 *
 * Usage:
 *   pnpm action save-browser-transcript --callId=<id> --fullText="..."
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";

export default defineAction({
  description:
    "Save a browser-generated (Web Speech API) transcript for a call. Provides an instant transcript with no API key required. Deepgram can refine it later.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    fullText: z.string().describe("Full transcript text from Web Speech API"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    if (!args.fullText.trim()) {
      return {
        callId: args.callId,
        status: "skipped" as const,
        reason: "Empty transcript",
      };
    }

    const [existing] = await db
      .select({ callId: schema.callTranscripts.callId })
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, args.callId))
      .limit(1);

    if (existing) {
      const [current] = await db
        .select({
          status: schema.callTranscripts.status,
          segmentsJson: schema.callTranscripts.segmentsJson,
        })
        .from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.callId, args.callId))
        .limit(1);

      // Don't overwrite a completed Deepgram transcript with lower-quality browser output
      const hasDeepgramSegments =
        current?.status === "ready" &&
        current?.segmentsJson &&
        current.segmentsJson !== "[]";
      if (hasDeepgramSegments) {
        return {
          callId: args.callId,
          status: "skipped" as const,
          reason: "Deepgram transcript already exists",
        };
      }

      await db
        .update(schema.callTranscripts)
        .set({
          ownerEmail,
          fullText: args.fullText.trim(),
          segmentsJson: "[]",
          status: "ready",
          failureReason: null,
          updatedAt: now,
        })
        .where(eq(schema.callTranscripts.callId, args.callId));
    } else {
      await db.insert(schema.callTranscripts).values({
        callId: args.callId,
        ownerEmail,
        language: "en",
        provider: "deepgram",
        segmentsJson: "[]",
        fullText: args.fullText.trim(),
        status: "ready",
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[calls] Browser transcript saved for ${args.callId} (${args.fullText.trim().length} chars)`,
    );

    return {
      callId: args.callId,
      status: "ready" as const,
      provider: "browser",
      chars: args.fullText.trim().length,
    };
  },
});
