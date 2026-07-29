// guard:allow-api-route — Upload transport resume endpoint returns lease and offset state for the chunk protocol.

/**
 * Report the authoritative received-offset for an in-flight upload, so a
 * client whose stream dropped can continue instead of stranding.
 *
 * The chunk-POST protocol is unchanged: a client resumes by POSTing the next
 * chunk at `nextChunkIndex`. Asking also renews the lease, because a client
 * asking where to resume is a live writer.
 *
 * Route: GET /api/uploads/:recordingId/resume
 */

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import {
  listRecordingChunkKeys,
  recordingChunkIndexFromKey,
  sumRecordingChunkBytes,
} from "../../../../lib/recording-upload-state.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import { getResumableSession } from "../../../../lib/resumable-session.js";
import { renewUploadLease } from "../../../../lib/upload-lease.js";

export default defineEventHandler(async (event: H3Event) => {
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }

  let ownerEmail: string;
  let orgId: string | undefined;
  try {
    const context = await getEventOwnerContext(event);
    ownerEmail = context.userEmail;
    orgId = context.orgId;
  } catch {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const [recording] = await getDb()
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        failureReason: schema.recordings.failureReason,
        videoUrl: schema.recordings.videoUrl,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!recording) {
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }

    const lease = await renewUploadLease(recordingId);
    if (!lease.held) {
      return {
        resumable: false,
        recordingId,
        status: lease.status,
        failureReason: lease.failureReason,
        videoUrl: lease.videoUrl,
      };
    }

    const session = await getResumableSession(recordingId).catch(() => null);
    if (session) {
      return {
        resumable: true,
        recordingId,
        status: recording.status,
        uploadMode: "streaming" as const,
        bytesReceived: session.bytesUploaded,
        nextChunkIndex: (session.lastCommittedIndex ?? -1) + 1,
      };
    }

    const stored = new Set(
      (await listRecordingChunkKeys(ownerEmail, recordingId))
        .map(recordingChunkIndexFromKey)
        .filter((index): index is number => index !== null),
    );
    // Finalize requires chunks contiguous from 0, so resume at the first gap
    // rather than after the highest index we happen to hold.
    let nextChunkIndex = 0;
    while (stored.has(nextChunkIndex)) nextChunkIndex += 1;

    return {
      resumable: true,
      recordingId,
      status: recording.status,
      uploadMode: "buffered" as const,
      bytesReceived: await sumRecordingChunkBytes(ownerEmail, recordingId),
      nextChunkIndex,
    };
  });
});
