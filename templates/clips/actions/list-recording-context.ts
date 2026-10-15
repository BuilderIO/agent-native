import { defineAction, fail } from "@agent-native/core/action";
import { verifyShortLivedToken } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
    const items = await getDb()
      .select()
      .from(schema.recordingContextItems)
      .where(
        and(
          eq(schema.recordingContextItems.recordingId, recordingId),
          ne(schema.recordingContextItems.status, "removed"),
        ),
      )
      .orderBy(desc(schema.recordingContextItems.createdAt));
    return { items };
  },
});
