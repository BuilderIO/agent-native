import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import { resolvePlayerVideoUrl } from "../../../../lib/player-video-url.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

export default defineEventHandler(async (event: H3Event) => {
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
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!recording) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    return {
      recording: {
        id: recording.id,
        status: recording.status,
        videoUrl: resolvePlayerVideoUrl(recording, { appPath }),
        durationMs: recording.durationMs,
        width: recording.width,
        height: recording.height,
        hasAudio: Boolean(recording.hasAudio),
        hasCamera: Boolean(recording.hasCamera),
        uploadProgress: recording.uploadProgress,
        failureReason: recording.failureReason,
        updatedAt: recording.updatedAt,
      },
    };
  });
});
