import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, lt, or } from "drizzle-orm";
import { z } from "zod";

import { isPrivateClip } from "../app/lib/rewind-visibility.js";
import { getDb, schema } from "../server/db/index.js";
import {
  findRecordingContextItem,
  loadOwnedRecordingContextItem,
  staleProcessingCutoff,
} from "../server/lib/recording-context.js";

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
    .select({ visibility: schema.recordings.visibility })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, mediaRecordingId));
  if (!media || !isPrivateClip(media.visibility)) {
    fail(
      "The screen history footage must be a private recording.",
      INVALID_INPUT,
    );
  }
}

export default defineAction({
  description:
    "Record the desktop export result for an owned screen history item. 'processing' claims a pending item, 'ready' stores the private footage recording with its duration, and 'failed' stores the error.",
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
    const { status } = args;

    const hasFootage =
      args.mediaRecordingId !== undefined ||
      args.durationMs !== undefined ||
      args.width !== undefined ||
      args.height !== undefined;
    if (status !== "ready" && hasFootage) {
      fail("Only a ready update can carry footage fields.", INVALID_INPUT);
    }
    if (status !== "failed" && args.error !== undefined) {
      fail("Only a failed update can carry an error.", INVALID_INPUT);
    }
    if (status === "ready") {
      if (
        args.mediaRecordingId === undefined ||
        args.durationMs === undefined
      ) {
        fail(
          "A ready update needs mediaRecordingId and durationMs.",
          INVALID_INPUT,
        );
      }
      await assertPrivateFootageRecording(
        item.recordingId,
        args.mediaRecordingId,
      );
    }
    if (status === "failed" && args.error === undefined) {
      fail("A failed update needs an error.", INVALID_INPUT);
    }

    const now = new Date().toISOString();
    const fields =
      status === "processing"
        ? { status, error: null, updatedAt: now }
        : status === "ready"
          ? {
              status,
              mediaRecordingId: args.mediaRecordingId,
              durationMs: args.durationMs,
              width: args.width ?? null,
              height: args.height ?? null,
              error: null,
              updatedAt: now,
            }
          : { status, error: args.error, updatedAt: now };

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

    const [updated] = await getDb()
      .update(schema.recordingContextItems)
      .set(fields)
      .where(and(eq(schema.recordingContextItems.id, item.id), fromState))
      .returning();
    if (updated) return updated;

    const current = await findRecordingContextItem(item.id);
    fail(
      `Screen history cannot move from ${current?.status ?? "missing"} to ${status}.`,
      {
        errorCode: "recording_context_invalid_transition",
        statusCode: 409,
      },
    );
  },
});
