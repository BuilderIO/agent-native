import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { CHAPTERS_BUSY } from "../shared/stored-chapters.js";
import { parseTranscriptSegments } from "../shared/transcript-segments.js";
import { assertNoDirectRecordingShares } from "./make-recording-private-for-rewind.js";
import {
  rewindExtensionKey,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

/** Shifts that keep missing a changing row give up rather than spin. */
const MAX_ATTEMPTS = 4;

/** Thrown inside the transaction to undo the pre-roll claim on a miss. */
class RowChanged extends Error {}

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
    expectedMediaUpdatedAt: z
      .string()
      .min(1)
      .describe(
        "mediaUpdatedAt from the Clip state used to prepare this Rewind upload; a changed value refuses to overwrite a later media edit or redaction.",
      ),
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
    let request = (await readAppState(key)) as RewindExtensionRequest | null;
    if (
      !request ||
      request.requestId !== args.requestId ||
      !["ready", "applying", "applied"].includes(request.status) ||
      request.preRollRecordingId !== args.preRollRecordingId
    ) {
      throw new Error("The Rewind pre-roll request is not ready to apply.");
    }
    const now = new Date().toISOString();
    const markApplied = async () => {
      // The shift cleared the thumbnail; a retry after a failed dispatch
      // must ask for it again.
      await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "thumbnail",
        requireAccepted: true,
      });
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = (await readAppState(
          key,
        )) as RewindExtensionRequest | null;
        if (
          !current ||
          current.requestId !== args.requestId ||
          current.preRollRecordingId !== args.preRollRecordingId
        ) {
          fail("The Rewind pre-roll request is no longer current.", {
            errorCode: "rewind_request_changed",
            statusCode: 409,
          });
        }
        if (current.status === "applied") {
          return { recordingId: args.recordingId, request: current };
        }
        if (!["ready", "applying", "failed"].includes(current.status)) {
          fail("The Rewind pre-roll request is not applying.", {
            errorCode: "rewind_request_changed",
            statusCode: 409,
          });
        }
        const applied: RewindExtensionRequest = {
          ...current,
          status: "applied",
          actualDurationMs: args.addedMs,
          updatedAt: now,
        };
        if (await compareAndSetAppState(key, current, applied)) {
          await writeAppState("refresh-signal", { ts: Date.now() });
          return { recordingId: args.recordingId, request: applied };
        }
      }
      fail("The Rewind request kept changing. Try again.", {
        errorCode: "rewind_request_changed",
        statusCode: 409,
      });
    };
    // An apply whose shift committed but whose request was never marked
    // applied (the server stopped in between) is finished, not refused, or
    // the request stays ready and every retry fails.
    const wasApplied = (editsJson: string) =>
      parseEdits(editsJson).rewindPreRollId === args.preRollRecordingId;
    if (request.status === "applied") {
      if (wasApplied(recording.editsJson)) {
        return { recordingId: args.recordingId, request };
      }
      fail("The Rewind request is applied but its media update is missing.", {
        errorCode: "rewind_request_changed",
        statusCode: 409,
      });
    }
    if (wasApplied(recording.editsJson)) {
      return markApplied();
    }
    if (recording.mediaUpdatedAt !== args.expectedMediaUpdatedAt) {
      fail(
        "The Clip media changed before Rewind could be applied. Try again.",
        {
          errorCode: "recording_media_changed",
          statusCode: 409,
        },
      );
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

    if (request.status === "ready") {
      const applying: RewindExtensionRequest = {
        ...request,
        status: "applying",
        updatedAt: new Date().toISOString(),
      };
      if (await compareAndSetAppState(key, request, applying)) {
        request = applying;
      } else {
        const latest = (await readAppState(
          key,
        )) as RewindExtensionRequest | null;
        if (
          !latest ||
          latest.requestId !== args.requestId ||
          latest.preRollRecordingId !== args.preRollRecordingId ||
          !["applying", "applied"].includes(latest.status)
        ) {
          fail(
            "The Rewind pre-roll request changed before it could be applied.",
            {
              errorCode: "rewind_request_changed",
              statusCode: 409,
            },
          );
        }
        request = latest;
        if (request.status === "applied") {
          return { recordingId: args.recordingId, request };
        }
      }
    }

    // Chapters and cuts are shifted from the values read here, and a save
    // can land meanwhile (a chapter edit, the editor's autosaved trims). The
    // update only matches the row as read; on a miss nothing is written and
    // the shift is made again from the newer values. Trashing the pre-roll
    // claims the request first, so a second apply racing this one stops
    // rather than shifting the already-shifted row again.
    let current = {
      chaptersJson: recording.chaptersJson,
      editsJson: recording.editsJson,
      mediaUpdatedAt: recording.mediaUpdatedAt,
      videoUrl: recording.videoUrl,
      updatedAt: recording.updatedAt,
    };
    for (let attempt = 1; ; attempt++) {
      const edits = parseEdits(current.editsJson);
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
      edits.rewindPreRollId = args.preRollRecordingId;
      edits.mediaStorageLayout = "external";

      const outcome = await db
        .transaction(async (tx) => {
          const claimed = await tx
            .update(schema.recordings)
            .set({ trashedAt: now, expiresAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.recordings.id, args.preRollRecordingId),
                isNull(schema.recordings.trashedAt),
              ),
            )
            .returning({ id: schema.recordings.id });
          if (claimed.length === 0) return "taken" as const;
          const written = await tx
            .update(schema.recordings)
            .set({
              videoUrl: args.videoUrl,
              videoFormat: "mp4",
              durationMs: args.durationMs,
              ...(args.width !== undefined ? { width: args.width } : {}),
              ...(args.height !== undefined ? { height: args.height } : {}),
              editsJson: serializeEdits(edits),
              chaptersJson: shiftedJsonArray(
                current.chaptersJson,
                args.addedMs,
                ["startMs"],
              ),
              thumbnailUrl: null,
              animatedThumbnailUrl: null,
              mediaUpdatedAt: nextRevision(current.mediaUpdatedAt, now),
              updatedAt: nextRevision(current.updatedAt, now),
            })
            .where(
              and(
                eq(schema.recordings.id, args.recordingId),
                eq(schema.recordings.chaptersJson, current.chaptersJson),
                eq(schema.recordings.editsJson, current.editsJson),
                eq(schema.recordings.mediaUpdatedAt, current.mediaUpdatedAt),
                current.videoUrl === null
                  ? isNull(schema.recordings.videoUrl)
                  : eq(schema.recordings.videoUrl, current.videoUrl),
                eq(schema.recordings.updatedAt, current.updatedAt),
              ),
            )
            .returning({ id: schema.recordings.id });
          if (written.length === 0) throw new RowChanged();
          const [transcript] = await tx
            .select({
              segmentsJson: schema.recordingTranscripts.segmentsJson,
            })
            .from(schema.recordingTranscripts)
            .where(
              eq(schema.recordingTranscripts.recordingId, args.recordingId),
            );
          if (transcript) {
            const shiftedTranscript = JSON.stringify(
              parseTranscriptSegments(transcript.segmentsJson).map(
                (segment) => ({
                  ...segment,
                  startMs: segment.startMs + args.addedMs,
                  endMs: segment.endMs + args.addedMs,
                }),
              ),
            );
            const transcriptWritten = await tx
              .update(schema.recordingTranscripts)
              .set({ segmentsJson: shiftedTranscript, updatedAt: now })
              .where(
                and(
                  eq(schema.recordingTranscripts.recordingId, args.recordingId),
                  eq(
                    schema.recordingTranscripts.segmentsJson,
                    transcript.segmentsJson,
                  ),
                ),
              )
              .returning({ id: schema.recordingTranscripts.recordingId });
            if (transcriptWritten.length === 0) throw new RowChanged();
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
          return "applied" as const;
        })
        .catch((err) => {
          if (err instanceof RowChanged) return "missed" as const;
          throw err;
        });
      if (outcome === "applied") break;
      if (outcome === "taken") {
        const [latest] = await db
          .select({ editsJson: schema.recordings.editsJson })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId));
        if (latest && wasApplied(latest.editsJson)) return markApplied();
        fail("The Rewind pre-roll was deleted. Request the Rewind again.", {
          errorCode: "rewind_preroll_unavailable",
          statusCode: 409,
        });
      }
      if (attempt >= MAX_ATTEMPTS) {
        fail("The Clip kept changing while Rewind was applied. Try again.", {
          errorCode: CHAPTERS_BUSY,
          statusCode: 409,
        });
      }
      const [latest] = await db
        .select({
          chaptersJson: schema.recordings.chaptersJson,
          editsJson: schema.recordings.editsJson,
          mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
          videoUrl: schema.recordings.videoUrl,
          updatedAt: schema.recordings.updatedAt,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!latest) {
        fail("The Clip is unavailable.", {
          errorCode: "recording_not_found",
          statusCode: 404,
        });
      }
      if (latest.mediaUpdatedAt !== args.expectedMediaUpdatedAt) {
        fail(
          "The Clip media changed while Rewind was being applied. Try again.",
          {
            errorCode: "recording_media_changed",
            statusCode: 409,
          },
        );
      }
      if (latest.videoUrl !== recording.videoUrl) {
        fail(
          "The Clip media changed while Rewind was being applied. Try again.",
          {
            errorCode: "recording_media_changed",
            statusCode: 409,
          },
        );
      }
      current = latest;
    }

    return markApplied();
  },
});

function nextRevision(previous: string, now: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.parse(now);
  return new Date(
    Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs,
  ).toISOString();
}
