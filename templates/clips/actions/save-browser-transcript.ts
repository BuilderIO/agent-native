/**
 * Save a native transcript for a recording.
 *
 * Called by the web client (Web Speech API) and desktop client (macOS Speech)
 * immediately when recording stops. Native transcripts are available
 * instantly with no API-key requirement and are the primary transcript source.
 *
 * Usage:
 *   pnpm action save-browser-transcript --recordingId=<id> --fullText="..."
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import regenerateTitle, {
  queueTitleRegenerationRequest,
} from "./regenerate-title.js";
import { isAutoTitleReplaceable } from "./lib/title-source.js";
import { buildCaptionSegmentsFromText } from "../shared/transcript-segments.js";

function nativeSegmentsJson(fullText: string): string {
  return JSON.stringify(buildCaptionSegmentsFromText(fullText));
}

export default defineAction({
  description:
    "Save a native transcript (Web Speech API or macOS Speech) for a recording. Provides an instant transcript with no API key required.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    fullText: z
      .string()
      .optional()
      .default("")
      .describe("Full transcript text from native speech recognition"),
    source: z
      .enum(["web-speech", "macos-native"])
      .optional()
      .describe("Native transcription source"),
    failureReason: z
      .string()
      .optional()
      .describe("Why native speech recognition could not save text"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();
    const fullText = args.fullText.trim();
    const failureReason = args.failureReason?.trim() || "";
    const segmentsJson = nativeSegmentsJson(fullText);

    const [current] = await db
      .select({
        recordingId: schema.recordingTranscripts.recordingId,
        status: schema.recordingTranscripts.status,
        fullText: schema.recordingTranscripts.fullText,
        segmentsJson: schema.recordingTranscripts.segmentsJson,
      })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const hasReadySegments =
      current?.status === "ready" &&
      current?.segmentsJson &&
      current.segmentsJson !== "[]";
    const hasReadyTranscript =
      current?.status === "ready" &&
      (Boolean(current.fullText?.trim()) || Boolean(hasReadySegments));

    if (!fullText) {
      if (!failureReason) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "Empty transcript",
        };
      }
      if (hasReadyTranscript) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "Transcript already exists",
        };
      }
      if (current) {
        await db
          .update(schema.recordingTranscripts)
          .set({
            ownerEmail,
            fullText: "",
            segmentsJson: "[]",
            status: "failed",
            failureReason,
            updatedAt: now,
          })
          .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));
      } else {
        await db.insert(schema.recordingTranscripts).values({
          recordingId: args.recordingId,
          ownerEmail,
          language: "en",
          segmentsJson: "[]",
          fullText: "",
          status: "failed",
          failureReason,
          createdAt: now,
          updatedAt: now,
        });
      }
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.warn(
        `[clips] Native transcript failed for ${args.recordingId} via ${args.source ?? "web-speech"}: ${failureReason}`,
      );
      return {
        recordingId: args.recordingId,
        status: "failed" as const,
        provider: args.source ?? "web-speech",
        failureReason,
      };
    }

    if (current) {
      // Don't overwrite an already-segmented cloud/native transcript with a
      // later lower-confidence native pass.
      if (hasReadySegments) {
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "Transcript already exists",
        };
      }

      await db
        .update(schema.recordingTranscripts)
        .set({
          ownerEmail,
          fullText,
          segmentsJson,
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
        segmentsJson,
        fullText,
        status: "ready",
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[clips] Native transcript saved for ${args.recordingId} via ${args.source ?? "web-speech"} (${fullText.length} chars)`,
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [rec] = await db
      .select({
        title: schema.recordings.title,
        titleSource: schema.recordings.titleSource,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);

    const titleQueued = !!(
      rec && isAutoTitleReplaceable(rec.title, rec.titleSource)
    );
    if (titleQueued) {
      await queueTitleRegenerationRequest({
        recordingId: args.recordingId,
        currentTitle: rec.title,
        transcriptText: fullText,
        transcriptStatus: "ready",
        segmentsJson,
        ownerEmail,
      }).catch((err) => {
        console.warn(
          `[clips] native transcript title request queue failed for ${args.recordingId}:`,
          (err as Error)?.message ?? String(err),
        );
      });

      void regenerateTitle
        .run({
          recordingId: args.recordingId,
          transcriptText: fullText,
        })
        .catch((err) => {
          console.warn(
            `[clips] native transcript title generation skipped for ${args.recordingId}:`,
            (err as Error)?.message ?? String(err),
          );
        });
    }

    return {
      recordingId: args.recordingId,
      status: "ready" as const,
      provider: args.source ?? "web-speech",
      chars: fullText.length,
      titleQueued,
    };
  },
});
