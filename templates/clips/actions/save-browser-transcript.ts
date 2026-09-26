import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { buildCaptionSegmentsFromText } from "../shared/transcript-segments.js";
import { booleanParam } from "./lib/cli-params.js";
import { finalizeEndedMeetingsForRecording } from "./lib/finalize-ended-meetings.js";
import { isAutoTitleReplaceable } from "./lib/title-source.js";

function nativeSegmentsJson(
  fullText: string,
  engineSource?: "web-speech" | "macos-native" | "whisper",
): string {
  const source = engineSource && engineSource !== "whisper" ? "mic" : undefined;
  return JSON.stringify(buildCaptionSegmentsFromText(fullText, null, source));
}

const segmentSchema = z
  .object({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    text: z.string(),
    source: z.enum(["mic", "system"]).optional(),
    speaker: z.string().nullable().optional(),
  })
  .transform((s) => {
    if (s.endMs < s.startMs) {
      console.warn(
        `[clips] save-browser-transcript: repaired reversed segment timestamps (startMs=${s.startMs}, endMs=${s.endMs})`,
      );
      return { ...s, endMs: s.startMs };
    }
    return s;
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
        "Transcript segments with per-segment timings (ms) and the `mic`/`system` stream each came from. Stored verbatim when provided, instead of synthesizing timings from fullText. Timings are the engine's own where it reported them; the mic-only engines report none, so callers may send estimates to keep each segment's speaker.",
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
  run: async (args, context) => {
    await assertAccess("recording", args.recordingId, "editor");
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();
    const fullText = args.fullText.trim();
    const failureReason = args.failureReason?.trim() || "";
    const segmentsJson =
      args.segments && args.segments.length > 0
        ? JSON.stringify(args.segments)
        : nativeSegmentsJson(fullText, args.source);

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
        return {
          recordingId: args.recordingId,
          status: "skipped" as const,
          reason: "Transcript attempt already exists",
        };
      }
      console.warn(
        `[clips] Native transcript unavailable for ${args.recordingId} via ${args.source ?? "web-speech"}; finalization will queue Builder fallback: ${failureReason}`,
      );
      return {
        recordingId: args.recordingId,
        status: "skipped" as const,
        reason: "Empty native transcript; waiting for recording finalization",
      };
    }

    const truncated = Boolean(failureReason);
    const savedStatus = truncated ? ("failed" as const) : ("ready" as const);
    const savedFailureReason = truncated ? failureReason : null;

    if (current) {
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
          status: savedStatus,
          failureReason: savedFailureReason,
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
        status: savedStatus,
        failureReason: savedFailureReason,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      truncated
        ? `[clips] Partial native transcript saved for ${args.recordingId} via ${args.source ?? "web-speech"} (${fullText.length} chars); Builder fallback will retranscribe: ${failureReason}`
        : `[clips] Native transcript saved for ${args.recordingId} via ${args.source ?? "web-speech"} (${fullText.length} chars)`,
    );

    await writeAppState("refresh-signal", { ts: Date.now() });
    if (savedStatus === "ready") {
      await finalizeEndedMeetingsForRecording(db, args.recordingId);
    }

    const [rec] = await db
      .select({
        title: schema.recordings.title,
        titleSource: schema.recordings.titleSource,
        description: schema.recordings.description,
        status: schema.recordings.status,
        durationMs: schema.recordings.durationMs,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);

    if (!hasReadyTranscript && savedStatus === "ready") {
      track(
        "recording_completed",
        {
          app_name: "clips",
          template_name: "clips",
          output_id: args.recordingId,
          output_type: "clip",
          duration_s: Math.round((rec?.durationMs ?? 0) / 1000),
          has_transcript: true,
          transcription_source: args.source ?? "native",
        },
        context
          ? { ...context, userEmail: context.userEmail ?? ownerEmail }
          : { userId: ownerEmail },
      );
    }

    const titleQueued = !!(
      rec && isAutoTitleReplaceable(rec.title, rec.titleSource)
    );
    const summaryQueued = Boolean(rec && !rec.description?.trim());
    if (
      rec?.status === "ready" &&
      (truncated || titleQueued || summaryQueued)
    ) {
      await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "transcript",
      }).catch((err: unknown) => {
        console.warn(
          `[clips] native transcript metadata dispatch failed for ${args.recordingId}:`,
          (err as Error)?.message ?? String(err),
        );
      });
    }

    return {
      recordingId: args.recordingId,
      status: savedStatus,
      provider: args.source ?? "web-speech",
      chars: fullText.length,
      truncated,
      titleQueued,
      summaryQueued,
    };
  },
});
