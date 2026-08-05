import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const schemaInput = z
  .object({
    recordingId: z.string().trim().min(1).max(200),
    sessionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

function viewerIdentity(sessionId: string | undefined) {
  const viewerEmail = getRequestUserEmail()?.trim().toLowerCase() || null;
  const viewerKey = viewerEmail
    ? viewerEmail
    : sessionId
      ? `anon:${sessionId}`
      : null;
  if (!viewerKey) {
    throw new Error("sessionId is required for anonymous viewers");
  }
  return { viewerEmail, viewerKey };
}

export default defineAction({
  description:
    "Load the current viewer's saved playback position for a Clips recording.",
  agentTool: false,
  schema: schemaInput,
  http: { method: "GET" },
  run: async ({ recordingId, sessionId }) => {
    const { viewerEmail, viewerKey } = viewerIdentity(sessionId);
    const access = await resolveAccess("recording", recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${recordingId}`);
    }

    const [row] = await getDb()
      .select({
        recordingId: schema.recordingPlaybackPositions.recordingId,
        viewerKey: schema.recordingPlaybackPositions.viewerKey,
        viewerEmail: schema.recordingPlaybackPositions.viewerEmail,
        positionMs: schema.recordingPlaybackPositions.positionMs,
        updatedAt: schema.recordingPlaybackPositions.updatedAt,
      })
      .from(schema.recordingPlaybackPositions)
      .where(
        and(
          eq(schema.recordingPlaybackPositions.recordingId, recordingId),
          eq(schema.recordingPlaybackPositions.viewerKey, viewerKey),
        ),
      )
      .limit(1);

    return {
      playbackPosition: row
        ? {
            ...row,
            viewerEmail: row.viewerEmail ?? viewerEmail,
          }
        : null,
    };
  },
});
