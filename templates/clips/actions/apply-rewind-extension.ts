import { defineAction, fail } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { isPrivateClip } from "../app/lib/rewind-visibility.js";
import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import { isS3ObjectUrlBoundToRecording } from "../server/lib/s3-upload-provider.js";
import { TRANSCRIPT_VERSION_LIMIT } from "../server/lib/transcript-versions.js";
import { parseTranscriptSegments } from "../shared/transcript-segments.js";
import { assertNoDirectRecordingShares } from "./make-recording-private-for-rewind.js";
import {
  rewindExtensionKey,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

/** `raw` with each field shifted, or null when it isn't a JSON array. */
function shiftedJsonArray(
  raw: string | null | undefined,
  addedMs: number,
  fields: string[],
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return null; // coercion-ok: null is "unreadable", and every caller handles it
  }
  if (!Array.isArray(parsed)) return null;
  return JSON.stringify(
    parsed.map((item) => {
      if (!item || typeof item !== "object") return item;
      const next = { ...item } as Record<string, unknown>;
      for (const field of fields) {
        if (typeof next[field] === "number") {
          next[field] = Math.max(0, Math.round(next[field] + addedMs));
        }
      }
      return next;
    }),
  );
}

export default defineAction({
  description:
    "Replace an owned Clip with an explicitly prepended local Rewind range while shifting its timestamped editor data and preserving the original-start marker.",
  schema: z.object({
    recordingId: z.string(),
    requestId: z.string(),
    preRollRecordingId: z.string(),
    videoUrl: z.string().min(1),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    addedMs: z
      .number()
      .int()
      .positive()
      .max(5 * 60_000),
  }),
  run: async (args) => {
    if (args.videoUrl.startsWith("data:")) {
      throw new Error(
        "The combined Clip must be uploaded before it is applied.",
      );
    }
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const [recording] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    const [preRoll] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.preRollRecordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!recording || !preRoll) {
      throw new Error("The Clip or its local Rewind pre-roll is unavailable.");
    }
    if (
      !isPrivateClip(recording.visibility) ||
      !isPrivateClip(preRoll.visibility)
    ) {
      throw new Error(
        "Rewind history can only be added to a private Clip from a private pre-roll.",
      );
    }
    await assertNoDirectRecordingShares(args.recordingId);
    const key = rewindExtensionKey(args.recordingId);
    const request = (await readAppState(key)) as RewindExtensionRequest | null;
    if (
      !request ||
      request.requestId !== args.requestId ||
      request.status !== "ready" ||
      request.preRollRecordingId !== args.preRollRecordingId
    ) {
      throw new Error("The Rewind pre-roll request is not ready to apply.");
    }
    const expectedDuration = recording.durationMs + args.addedMs;
    if (Math.abs(args.durationMs - expectedDuration) > 2_000) {
      throw new Error("The combined Clip duration does not match its sources.");
    }
    const storageMode = recording.storageMode === "hosted" ? "hosted" : "own";
    const rewindMediaIsBound = await isS3ObjectUrlBoundToRecording(
      args.videoUrl,
      args.recordingId,
      { storageMode },
    );
    if (
      rewindMediaIsBound === false ||
      (storageMode === "hosted" && rewindMediaIsBound !== true)
    ) {
      throw new Error("The Rewind upload is not bound to its recording.");
    }

    const edits = parseEdits(recording.editsJson);
    edits.trims = edits.trims.map((trim) => ({
      ...trim,
      startMs: trim.startMs + args.addedMs,
      endMs: trim.endMs + args.addedMs,
    }));
    edits.blurs = edits.blurs.map((blur) => ({
      ...blur,
      startMs: blur.startMs + args.addedMs,
      endMs: blur.endMs + args.addedMs,
    }));
    edits.rewindOriginalStartMs = args.addedMs;
    edits.mediaStorageLayout = "external";
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.recordings)
        .set({
          videoUrl: args.videoUrl,
          videoFormat: "mp4",
          durationMs: args.durationMs,
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          editsJson: serializeEdits(edits),
          // Unreadable chapters stay as stored rather than blocking the
          // extension.
          chaptersJson:
            shiftedJsonArray(recording.chaptersJson, args.addedMs, [
              "startMs",
            ]) ??
            (recording.chaptersJson || "[]"),
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, args.recordingId));
      // Locked, so a replace or restore can't swap the transcript or its
      // versions between this read and the shifted writes below.
      const [transcript] = await tx
        .select()
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .for("update");
      if (transcript) {
        await tx
          .update(schema.recordingTranscripts)
          .set({
            segmentsJson: JSON.stringify(
              parseTranscriptSegments(transcript.segmentsJson).map(
                (segment) => ({
                  ...segment,
                  startMs: segment.startMs + args.addedMs,
                  endMs: segment.endMs + args.addedMs,
                }),
              ),
            ),
            updatedAt: now,
          })
          .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));
      }
      // Saved transcripts move with the video too, so one restored after the
      // extension lines up with the longer timeline.
      const versions = schema.recordingTranscriptVersions;
      const saved = await tx
        .select({ id: versions.id, segmentsJson: versions.segmentsJson })
        .from(versions)
        .where(eq(versions.recordingId, args.recordingId))
        .limit(TRANSCRIPT_VERSION_LIMIT);
      for (const version of saved) {
        const segmentsJson = shiftedJsonArray(
          version.segmentsJson,
          args.addedMs,
          ["startMs", "endMs"],
        );
        // Left as stored, it would come back on the old timeline.
        if (segmentsJson === null) {
          fail(
            `Saved transcript ${version.id} has unreadable segments, so it can't move with the video. Nothing was changed.`,
            { errorCode: "transcript_version_unreadable", statusCode: 500 },
          );
        }
        await tx
          .update(versions)
          .set({ segmentsJson })
          .where(eq(versions.id, version.id));
      }
      await tx
        .update(schema.recordingComments)
        .set({
          videoTimestampMs: sql`${schema.recordingComments.videoTimestampMs} + ${args.addedMs}`,
          updatedAt: now,
        })
        .where(eq(schema.recordingComments.recordingId, args.recordingId));
      await tx
        .update(schema.recordingReactions)
        .set({
          videoTimestampMs: sql`${schema.recordingReactions.videoTimestampMs} + ${args.addedMs}`,
        })
        .where(eq(schema.recordingReactions.recordingId, args.recordingId));
      await tx
        .update(schema.recordings)
        .set({ trashedAt: now, expiresAt: now, updatedAt: now })
        .where(eq(schema.recordings.id, args.preRollRecordingId));
    });

    const applied: RewindExtensionRequest = {
      ...request,
      status: "applied",
      actualDurationMs: args.addedMs,
      updatedAt: now,
    };
    await writeAppState(key, applied);
    await dispatchPostFinalizeJob({
      recordingId: args.recordingId,
      kind: "thumbnail",
      requireAccepted: true,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { recordingId: args.recordingId, request: applied };
  },
});
