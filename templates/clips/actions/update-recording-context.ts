import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, lt, or } from "drizzle-orm";
import { z } from "zod";

import { isPrivateClip } from "../app/lib/rewind-visibility.js";
import { getDb, schema } from "../server/db/index.js";
import {
  findRecordingContextItem,
  loadOwnedRecordingContextItem,
  SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME,
  staleProcessingCutoff,
} from "../server/lib/recording-context.js";
import { trashReleasedFootage } from "./remove-recording-context.js";

// 'ready' and 'failed' are reachable only from 'processing'. 'processing' is
// reachable from 'pending', or from a 'processing' claim stale enough that its
// worker quit. A late worker result for a window the user has since changed
// (which resets the item to pending) is rejected here instead of overwriting
// the newer request.
const REQUIRED_FROM = {
  ready: "processing",
  failed: "processing",
} as const;

const INVALID_INPUT = {
  errorCode: "recording_context_invalid_input",
  statusCode: 400,
} as const;

const FOOTAGE_MISMATCH = {
  errorCode: "recording_context_footage_mismatch",
  statusCode: 409,
} as const;

async function assertPrivateFootageRecording(
  recordingId: string,
  mediaRecordingId: string,
): Promise<void> {
  if (mediaRecordingId === recordingId) {
    fail(
      "The screen history footage cannot be the Clip itself.",
      INVALID_INPUT,
    );
  }
  await assertAccess("recording", mediaRecordingId, "owner");
  const [media] = await getDb()
    .select({
      visibility: schema.recordings.visibility,
      sourceAppName: schema.recordings.sourceAppName,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, mediaRecordingId));
  if (
    !media ||
    !isPrivateClip(media.visibility) ||
    media.sourceAppName !== SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME
  ) {
    fail(
      "The screen history footage must be a private Rewind recording.",
      INVALID_INPUT,
    );
  }
}

export default defineAction({
  description:
    "Record the desktop export for an owned screen history item. 'processing' claims a pending item and may name the footage recording it reserves; 'ready' stores that footage with its duration and must name the same recording; 'failed' stores the error and releases the reservation.",
  schema: z.object({
    id: z.string(),
    status: z.enum(["processing", "ready", "failed"]),
    mediaRecordingId: z.string().min(1).optional(),
    durationMs: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    error: z.string().min(1).optional(),
  }),
  run: async (args) => {
    const item = await loadOwnedRecordingContextItem(args.id);
    const { status, mediaRecordingId } = args;

    if (
      status !== "ready" &&
      (args.durationMs !== undefined ||
        args.width !== undefined ||
        args.height !== undefined)
    ) {
      fail("Only a ready update can carry duration or size.", INVALID_INPUT);
    }
    if (status === "failed" && mediaRecordingId !== undefined) {
      fail("A failed update cannot carry footage.", INVALID_INPUT);
    }
    if (status !== "failed" && args.error !== undefined) {
      fail("Only a failed update can carry an error.", INVALID_INPUT);
    }
    if (
      status === "ready" &&
      (mediaRecordingId === undefined || args.durationMs === undefined)
    ) {
      fail(
        "A ready update needs mediaRecordingId and durationMs.",
        INVALID_INPUT,
      );
    }
    if (mediaRecordingId !== undefined && status !== "failed") {
      await assertPrivateFootageRecording(item.recordingId, mediaRecordingId);
    }
    if (status === "failed" && args.error === undefined) {
      fail("A failed update needs an error.", INVALID_INPUT);
    }

    const now = new Date().toISOString();
    const fields =
      status === "processing"
        ? {
            status,
            error: null,
            pendingMediaRecordingId: mediaRecordingId ?? null,
            updatedAt: now,
          }
        : status === "ready"
          ? {
              status,
              mediaRecordingId,
              pendingMediaRecordingId: null,
              durationMs: args.durationMs,
              width: args.width ?? null,
              height: args.height ?? null,
              error: null,
              updatedAt: now,
            }
          : {
              status,
              error: args.error,
              pendingMediaRecordingId: null,
              updatedAt: now,
            };

    const fromState =
      status === "processing"
        ? or(
            eq(schema.recordingContextItems.status, "pending"),
            and(
              eq(schema.recordingContextItems.status, "processing"),
              lt(
                schema.recordingContextItems.updatedAt,
                staleProcessingCutoff(),
              ),
            ),
          )
        : eq(schema.recordingContextItems.status, REQUIRED_FROM[status]);
    const reservedFootage =
      status === "ready" && mediaRecordingId !== undefined
        ? eq(
            schema.recordingContextItems.pendingMediaRecordingId,
            mediaRecordingId,
          )
        : undefined;
    const transitionWhere = and(
      eq(schema.recordingContextItems.id, item.id),
      fromState,
      reservedFootage,
    );

    // The row is locked with the same predicate the update uses, so a rejected
    // transition locks nothing and trashes nothing. Once the row is locked the
    // update cannot reject, so the trash below always runs before the
    // reservation is cleared. A trash failure rolls the whole transaction back.
    const updated = await getDb().transaction(async (tx) => {
      const [locked] = await tx
        .select({
          pendingMediaRecordingId:
            schema.recordingContextItems.pendingMediaRecordingId,
        })
        .from(schema.recordingContextItems)
        .where(transitionWhere)
        .for("update");
      if (!locked) return undefined;

      // A ready update makes its reservation the item's media, and a claim
      // that names the same footage keeps it. Only a release is trashed.
      const released =
        status === "ready" ? null : locked.pendingMediaRecordingId;
      const kept = status === "processing" ? (mediaRecordingId ?? null) : null;
      if (released !== null && released !== kept) {
        await trashReleasedFootage(tx, released, item.id);
      }

      const [updated] = await tx
        .update(schema.recordingContextItems)
        .set(fields)
        .where(transitionWhere)
        .returning();
      // Unreachable: the row is locked, so the predicate that matched it still holds.
      if (!updated) {
        // guard:allow-bare-error — invariant: the row is locked by this transaction, so the predicate that matched it still holds
        throw new Error(
          `Screen history ${item.id} changed while its row was locked`,
        );
      }
      return updated;
    });
    if (updated) return updated;

    const current = await findRecordingContextItem(item.id);
    if (status === "ready" && current?.status === "processing") {
      fail(
        "This footage is not the footage reserved for this screen history export.",
        FOOTAGE_MISMATCH,
      );
    }
    fail(
      `Screen history cannot move from ${current?.status ?? "missing"} to ${status}.`,
      {
        errorCode: "recording_context_invalid_transition",
        statusCode: 409,
      },
    );
  },
});
