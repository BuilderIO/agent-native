import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { isPrivateClip } from "../app/lib/rewind-visibility.js";
import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
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

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));
    const shiftedTranscript = transcript
      ? JSON.stringify(
          parseTranscriptSegments(transcript.segmentsJson).map((segment) => ({
            ...segment,
            startMs: segment.startMs + args.addedMs,
            endMs: segment.endMs + args.addedMs,
          })),
        )
      : null;
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.recordings)
        .set({
          videoUrl: args.videoUrl,
          videoFormat: "mp4",
          durationMs: args.durationMs,
          editsJson: serializeEdits(edits),
          chaptersJson: shiftedJsonArray(recording.chaptersJson, args.addedMs, [
            "startMs",
          ]),
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, args.recordingId));
      if (transcript && shiftedTranscript) {
        await tx
          .update(schema.recordingTranscripts)
          .set({ segmentsJson: shiftedTranscript, updatedAt: now })
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

    const applied: RewindExtensionRequest = {
      ...request,
      status: "applied",
      actualDurationMs: args.addedMs,
      updatedAt: now,
    };
    await writeAppState(key, applied);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { recordingId: args.recordingId, request: applied };
  },
});
