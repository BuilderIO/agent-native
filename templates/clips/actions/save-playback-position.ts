import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";

const schemaInput = z
  .object({
    recordingId: z.string().trim().min(1).max(200),
    positionMs: z
      .number()
      .finite()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
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
    "Save the current viewer's playback position for a Clips recording.",
  agentTool: false,
  schema: schemaInput,
  run: async ({ recordingId, positionMs, sessionId }) => {
    const { viewerEmail, viewerKey } = viewerIdentity(sessionId);
    const access = await resolveAccess("recording", recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${recordingId}`);
    }

    const now = new Date().toISOString();
    const [row] = await getDb()
      .insert(schema.recordingPlaybackPositions)
      .values({
        id: nanoid(),
        recordingId,
        viewerKey,
        viewerEmail,
        positionMs,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.recordingPlaybackPositions.recordingId,
          schema.recordingPlaybackPositions.viewerKey,
        ],
        set: {
          viewerEmail,
          positionMs,
          updatedAt: now,
        },
      })
      .returning({
        recordingId: schema.recordingPlaybackPositions.recordingId,
        viewerKey: schema.recordingPlaybackPositions.viewerKey,
        viewerEmail: schema.recordingPlaybackPositions.viewerEmail,
        positionMs: schema.recordingPlaybackPositions.positionMs,
        updatedAt: schema.recordingPlaybackPositions.updatedAt,
      });

    return { playbackPosition: row ?? null };
  },
});
