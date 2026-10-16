import { defineAction, fail } from "@agent-native/core/action";
import { verifyShortLivedToken } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isHeldForRedaction,
  REDACTION_HOLD_MESSAGE,
} from "../server/lib/pending-redactions.js";
import { staleProcessingCutoff } from "../server/lib/recording-context.js";
import { isRecordingExpiredForViewer } from "../server/lib/recording-page-access.js";
import { getRecordingAccessTokenResourceId } from "../server/lib/share-password.js";

export default defineAction({
  description:
    "List the earlier screen-time context attached to a Clip, excluding removed items. The context is passive metadata; the Clip's video is never changed.",
  schema: z.object({
    recordingId: z.string(),
    accessToken: z.string().max(2048).optional(),
  }),
  http: { method: "GET" },
  run: async ({ recordingId, accessToken }) => {
    // Must run before assertAccess: it answers 403 for a missing row too, and the
    // desktop needs 404 to trash footage for a permanently deleted Clip.
    const [recording] = await getDb()
      .select({
        id: schema.recordings.id,
        password: schema.recordings.password,
        sharePasswordVersion: schema.recordings.sharePasswordVersion,
        expiresAt: schema.recordings.expiresAt,
        trashedAt: schema.recordings.trashedAt,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);
    if (!recording) {
      fail("Recording not found.", {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    const access = await assertAccess("recording", recordingId, "viewer");
    // The owner's desktop worker reads items for a trashed Clip to finish or
    // recover an export; the same 404 there would read as "permanently deleted".
    if (recording.trashedAt && access.role !== "owner") {
      fail("Recording not found.", {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    if (
      isRecordingExpiredForViewer({
        expiresAt: recording.expiresAt,
        viewerIsOwner: access.role === "owner",
      })
    ) {
      fail("Recording has expired.", {
        errorCode: "recording_expired",
        statusCode: 410,
      });
    }
    if (isHeldForRedaction(recording.editsJson, access.role)) {
      fail(REDACTION_HOLD_MESSAGE, {
        errorCode: "recording_redaction_pending",
        statusCode: 409,
      });
    }
    if (recording.password && access.role !== "owner") {
      const scopeId = getRecordingAccessTokenResourceId(
        recordingId,
        recording.password,
        recording.sharePasswordVersion,
      );
      if (!accessToken || !verifyShortLivedToken(accessToken, scopeId).ok) {
        fail("Password required.", {
          errorCode: "recording_password_required",
          statusCode: 401,
        });
      }
    }
    const where = and(
      eq(schema.recordingContextItems.recordingId, recordingId),
      ne(schema.recordingContextItems.status, "removed"),
    );
    const orderBy = desc(schema.recordingContextItems.createdAt);
    if (access.role === "owner") {
      const items = await getDb()
        .select()
        .from(schema.recordingContextItems)
        .where(where)
        .orderBy(orderBy);
      return {
        items: items.map((item) => ({
          ...item,
          waitingForDevice: Boolean(item.capturedDeviceId),
        })),
      };
    }
    const items = await getDb()
      .select({
        id: schema.recordingContextItems.id,
        recordingId: schema.recordingContextItems.recordingId,
        kind: schema.recordingContextItems.kind,
        label: schema.recordingContextItems.label,
        startedAt: schema.recordingContextItems.startedAt,
        endedAt: schema.recordingContextItems.endedAt,
        status: schema.recordingContextItems.status,
        mediaRecordingId: sql<
          string | null
        >`case when ${schema.recordingContextItems.status} = 'ready' then ${schema.recordingContextItems.mediaRecordingId} else null end`,
        processingClaimFresh: sql<boolean>`case when ${schema.recordingContextItems.status} = 'processing' then ${schema.recordingContextItems.updatedAt} >= ${staleProcessingCutoff()} else false end`,
        waitingForDevice: sql<boolean>`${schema.recordingContextItems.capturedDeviceId} is not null`,
      })
      .from(schema.recordingContextItems)
      .where(where)
      .orderBy(orderBy);
    return { items };
  },
});
