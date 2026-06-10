/**
 * Save a native transcript for a recording.
 *
 * Called by the web client (Web Speech API) and desktop client (whispher).
 * Native transcripts are available instantly with no API-key requirement
 * and are the primary transcript source. Always replaces the stored transcript with `fullText`. If `segments` are
 * supplied (real timestamps, e.g. from the desktop Whisper engine) they're
 * stored verbatim; otherwise evenly-paced segments are synthesized from the
 * text. Live capture that OWNS the transcript (meeting flushes re-sending the
 * cumulative text + segments) passes `overwriteReady: true` to keep updating
 * its own already-"ready" transcript past the first flush.
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
import { booleanParam } from "./lib/cli-params.js";
import { buildCaptionSegmentsFromText } from "../shared/transcript-segments.js";

function nativeSegmentsJson(fullText: string): string {
  return JSON.stringify(buildCaptionSegmentsFromText(fullText));
}

// Real transcript segments supplied by a caller that already has accurate
// timestamps (e.g. the desktop Whisper engine). When present these are stored
// verbatim instead of synthesizing timings from the text.
const segmentSchema = z
  .object({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    text: z.string(),
    // Stream the segment came from; the transcript UI maps mic→"Me", system→"Them".
    source: z.enum(["mic", "system"]).optional(),
  })
  .refine((s) => s.startMs <= s.endMs, {
    message: "startMs must be <= endMs",
  });

export default defineAction({
  description:
    "Save a native transcript (Web Speech API, macOS Speech, or Whisper) for a recording. Replaces the stored transcript with fullText; stores real `segments` timestamps verbatim when given, else synthesizes them. Pass overwriteReady=true for live capture that owns the transcript and re-sends cumulative text/segments (e.g. meeting flushes).",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    fullText: z
      .string()
      .optional()
      .default("")
      .describe("Full transcript text from native speech recognition"),
    source: z
      .enum(["web-speech", "macos-native", "whisper"])
      .optional()
      .describe("Native transcription source"),
    segments: z
      .array(segmentSchema)
      .optional()
      .describe(
        "Real transcript segments with accurate timestamps (ms). When provided, stored verbatim instead of synthesizing timings from fullText.",
      ),
    overwriteReady: booleanParam
      .default(false)
      .describe(
        "Replace even an already-segmented 'ready' transcript. Used by live capture that owns the transcript and re-sends the cumulative text/segments on every flush (e.g. meeting transcription). Default false protects a finished transcript from a later lower-confidence native pass.",
      ),
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
    // Prefer real caller-supplied segment timestamps; otherwise
    // synthesize evenly-paced segments from the text.
    const segmentsJson =
      args.segments && args.segments.length > 0
        ? JSON.stringify(args.segments)
        : nativeSegmentsJson(fullText);

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
      // later lower-confidence native pass — UNLESS the caller owns this
      // transcript and is intentionally re-sending its cumulative text +
      // segments (overwriteReady, e.g. live meeting flushes).
      if (hasReadySegments && !args.overwriteReady) {
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

      void Promise.resolve(
        regenerateTitle.run({
          recordingId: args.recordingId,
          transcriptText: fullText,
        }),
      ).catch((err: unknown) => {
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
