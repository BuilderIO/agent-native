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
import { parseTranscriptSegments } from "../shared/transcript-segments.js";
import { assertNoDirectRecordingShares } from "./make-recording-private-for-rewind.js";
import {
  rewindExtensionKey,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

function shiftedJsonArray(
  raw: string | null | undefined,
  addedMs: number,
  fields: string[],
): string {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return raw || "[]";
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
  } catch {
    return raw || "[]";
  }
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
    const now = new Date().toISOString();
    const finish = async () => {
      const applied: RewindExtensionRequest = {
        ...request,
        status: "applied",
        actualDurationMs: args.addedMs,
        updatedAt: now,
      };
      // Queued first: an applied request can't be retried, so a failed
      // dispatch has to leave it ready.
      await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "thumbnail",
        requireAccepted: true,
      });
      await writeAppState(key, applied);
      await writeAppState("refresh-signal", { ts: Date.now() });
      return { recordingId: args.recordingId, request: applied };
    };
    // The shift records its request in the edits, so a retry after it
    // committed (say, when queuing the thumbnail or marking the request
    // applied failed) only finishes up. The duration check below would
    // refuse it.
    if (parseEdits(recording.editsJson).rewindRequestId === args.requestId) {
      return finish();
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

    await db.transaction(async (tx) => {
      // Two applies of one request can both pass the checks above. Locked,
      // the second waits for the first and then finds the request in the
      // edits, so it shifts nothing a second time. Reading what it shifts
      // here, not above, also keeps an edit saved meanwhile.
      const [locked] = await tx
        .select({
          editsJson: schema.recordings.editsJson,
          chaptersJson: schema.recordings.chaptersJson,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId))
        .for("update");
      if (!locked) {
        fail("The Clip or its local Rewind pre-roll is unavailable.", {
          errorCode: "recording_not_found",
          statusCode: 404,
        });
      }
      const edits = parseEdits(locked.editsJson);
      if (edits.rewindRequestId === args.requestId) return;
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
      edits.rewindRequestId = args.requestId;
      await tx
        .update(schema.recordings)
        .set({
          videoUrl: args.videoUrl,
          videoFormat: "mp4",
          durationMs: args.durationMs,
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          editsJson: serializeEdits(edits),
          chaptersJson: shiftedJsonArray(locked.chaptersJson, args.addedMs, [
            "startMs",
          ]),
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, args.recordingId));
      const [transcript] = await tx
        .select({ segmentsJson: schema.recordingTranscripts.segmentsJson })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
        .for("update");
      if (transcript) {
        const shifted = parseTranscriptSegments(transcript.segmentsJson).map(
          (segment) => ({
            ...segment,
            startMs: segment.startMs + args.addedMs,
            endMs: segment.endMs + args.addedMs,
          }),
        );
        await tx
          .update(schema.recordingTranscripts)
          .set({ segmentsJson: JSON.stringify(shifted), updatedAt: now })
          .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));
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

    return finish();
  },
});
