import {
  createScopedAgentAccessGrant,
  verifyScopedAgentAccessToken,
  type ScopedAgentAccessGrant,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import { isLoomEmbedBackedRecording } from "../../shared/loom.js";
import { youtubeVideoIdForRecording } from "../../shared/youtube.js";
import { getDb, schema } from "../db/index.js";
import { contextClipIdForFootage } from "./context-footage.js";
import { isHeldForRedaction } from "./pending-redactions.js";

export const RECORDING_DOWNLOAD_ACCESS_PARAM = "download_access";
export const RECORDING_DOWNLOAD_DEFAULT_TTL_SECONDS = 10 * 60;
export const RECORDING_DOWNLOAD_MIN_TTL_SECONDS = 60;
export const RECORDING_DOWNLOAD_MAX_TTL_SECONDS = 60 * 60;

const RECORDING_DOWNLOAD_TOKEN_KIND = "clip-video-download";

export interface DownloadableRecording {
  id: string;
  ownerEmail: string;
  status?: string | null;
  failureCode?: string | null;
  trashedAt?: string | null;
  editsJson?: string | null;
  videoUrl?: string | null;
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
}

export interface RecordingDownloadRefusal {
  errorCode:
    | "not_found"
    | "not_ready"
    | "no_video_file"
    | "redaction_pending"
    | "footage_not_downloadable";
  statusCode: number;
  message: string;
}

// The owner is part of what the token signs, so a link stops working as soon
// as the recording belongs to someone else.
function downloadScope(recordingId: string, ownerEmail: string) {
  return {
    resourceKind: RECORDING_DOWNLOAD_TOKEN_KIND,
    resourceId: JSON.stringify([recordingId, ownerEmail.trim().toLowerCase()]),
  };
}

export function createRecordingDownloadGrant(input: {
  recordingId: string;
  ownerEmail: string;
  ttlSeconds: number;
}): ScopedAgentAccessGrant {
  return createScopedAgentAccessGrant({
    ...downloadScope(input.recordingId, input.ownerEmail),
    ttlSeconds: input.ttlSeconds,
  });
}

export function recordingDownloadRefusal(
  recording: DownloadableRecording,
): RecordingDownloadRefusal | null {
  if (recording.trashedAt || recording.failureCode === "taken_down") {
    return {
      errorCode: "not_found",
      statusCode: 404,
      message: "This recording is in the Trash or no longer available.",
    };
  }
  if (recording.status !== "ready") {
    return {
      errorCode: "not_ready",
      statusCode: 409,
      message:
        "This recording is still uploading or processing. Try again once it is ready.",
    };
  }
  if (
    !recording.videoUrl ||
    youtubeVideoIdForRecording(recording) ||
    isLoomEmbedBackedRecording(recording)
  ) {
    return {
      errorCode: "no_video_file",
      statusCode: 422,
      message:
        "This recording plays in an embedded player, so Clips has no video file to download.",
    };
  }
  // The stored video still shows what the owner marked for redaction, so it
  // stays in Clips until the redactions are burned in or cleared.
  if (isHeldForRedaction(recording.editsJson, null)) {
    return {
      errorCode: "redaction_pending",
      statusCode: 409,
      message:
        "This recording has redactions that aren't burned in yet. Apply or clear them, then ask for a download link.",
    };
  }
  return null;
}

export type RecordingDownloadAccess =
  | { ok: true; recording: typeof schema.recordings.$inferSelect }
  | {
      ok: false;
      errorCode:
        | RecordingDownloadRefusal["errorCode"]
        | "link_invalid"
        | "link_expired";
      statusCode: number;
      message: string;
    };

export async function resolveRecordingDownloadAccess(
  recordingId: string,
  token: string,
): Promise<RecordingDownloadAccess> {
  const [recording] = await getDb()
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording) {
    return {
      ok: false,
      errorCode: "not_found",
      statusCode: 404,
      message: "Not found",
    };
  }
  const verified = verifyScopedAgentAccessToken(
    token,
    downloadScope(recording.id, recording.ownerEmail),
  );
  if (!verified.ok) {
    return verified.reason === "expired"
      ? {
          ok: false,
          errorCode: "link_expired",
          statusCode: 410,
          message:
            "This download link has expired. Ask Clips for a new one with create-recording-download-link.",
        }
      : {
          ok: false,
          errorCode: "link_invalid",
          statusCode: 403,
          message: "This download link is not valid for this recording.",
        };
  }
  if (await contextClipIdForFootage(recording.id)) {
    return {
      ok: false,
      errorCode: "footage_not_downloadable",
      statusCode: 404,
      message: "Not found",
    };
  }
  const refusal = recordingDownloadRefusal(recording);
  return refusal ? { ok: false, ...refusal } : { ok: true, recording };
}
