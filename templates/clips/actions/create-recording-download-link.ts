import { defineAction, fail } from "@agent-native/core/action";
import {
  getAppProductionUrl,
  getRequestContext,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { contextClipIdForFootage } from "../server/lib/context-footage.js";
import { localRecordingVideoRoute } from "../server/lib/player-video-url.js";
import { getServerAppBasePath } from "../server/lib/public-agent-context.js";
import {
  createRecordingDownloadGrant,
  RECORDING_DOWNLOAD_ACCESS_PARAM,
  RECORDING_DOWNLOAD_DEFAULT_TTL_SECONDS,
  RECORDING_DOWNLOAD_MAX_TTL_SECONDS,
  RECORDING_DOWNLOAD_MIN_TTL_SECONDS,
  recordingDownloadRefusal,
  type DownloadableRecording,
} from "../server/lib/recording-download-link.js";

function knownAmount(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

export default defineAction({
  description:
    "Create a short-lived link that downloads one of your own recordings' video file, for another app or tool that needs the file itself, such as a private recording. Only the recording's owner can create one. The link works without signing in, for that one recording only, and expires after 10 minutes unless ttlSeconds asks for another time between 1 and 60 minutes; anyone holding it can download the file until then, so pass it only to the tool that fetches it. It answers HTTP Range requests, so fetch a large file in ranges. Viewers of a shared clip should use the share link instead.",
  mcpApp: { compactCatalog: true },
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    ttlSeconds: z
      .number()
      .int()
      .min(RECORDING_DOWNLOAD_MIN_TTL_SECONDS)
      .max(RECORDING_DOWNLOAD_MAX_TTL_SECONDS)
      .optional()
      .describe(
        "How long the link works, in seconds: 60 to 3600. Defaults to 600.",
      ),
  }),
  outputSchema: z.object({
    recordingId: z.string(),
    url: z.string(),
    expiresAt: z.string(),
    ttlSeconds: z.number(),
    videoFormat: z.enum(["webm", "mp4"]).nullable(),
    sizeBytes: z.number().nullable(),
    durationMs: z.number().nullable(),
  }),
  readOnly: true,
  run: async (args) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access || access.role !== "owner") {
      fail("Only the recording's owner can create a download link.", {
        errorCode: "owner_only",
        statusCode: 403,
      });
    }
    const recording = access.resource as DownloadableRecording & {
      videoFormat?: "webm" | "mp4" | null;
      videoSizeBytes?: number | null;
      durationMs?: number | null;
    };
    if (await contextClipIdForFootage(recording.id)) {
      fail(
        "This is earlier screen time attached to a clip, not a clip of its own.",
        { errorCode: "footage_not_downloadable", statusCode: 422 },
      );
    }
    const refusal = recordingDownloadRefusal(recording);
    if (refusal) {
      fail(refusal.message, {
        errorCode: refusal.errorCode,
        statusCode: refusal.statusCode,
      });
    }

    const grant = createRecordingDownloadGrant({
      recordingId: recording.id,
      ownerEmail: recording.ownerEmail,
      ttlSeconds: args.ttlSeconds ?? RECORDING_DOWNLOAD_DEFAULT_TTL_SECONDS,
    });
    const url = new URL(
      `${getServerAppBasePath()}${localRecordingVideoRoute(recording.id)}`,
      new URL(getRequestContext()?.requestOrigin || getAppProductionUrl())
        .origin,
    );
    url.searchParams.set(RECORDING_DOWNLOAD_ACCESS_PARAM, grant.token);

    return {
      recordingId: recording.id,
      url: url.toString(),
      expiresAt: grant.expiresAt,
      ttlSeconds: grant.ttlSeconds,
      videoFormat: recording.videoFormat ?? null,
      // Both columns default to 0 until the upload reports them.
      sizeBytes: knownAmount(recording.videoSizeBytes),
      durationMs: knownAmount(recording.durationMs),
    };
  },
});
