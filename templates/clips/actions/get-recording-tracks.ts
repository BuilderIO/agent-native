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
  createRecordingTrackGrant,
  RECORDING_DOWNLOAD_ACCESS_PARAM,
  RECORDING_DOWNLOAD_DEFAULT_TTL_SECONDS,
  RECORDING_DOWNLOAD_MAX_TTL_SECONDS,
  RECORDING_DOWNLOAD_MIN_TTL_SECONDS,
  recordingTracksRefusal,
  type RecordingTrackFile,
} from "../server/lib/recording-download-link.js";
import {
  listRecordingTracks,
  type RecordingTrackRow,
} from "../server/lib/recording-tracks.js";
import {
  RICH_MANIFEST_FILE,
  RICH_TRACK_IDS,
  isRichTrackId,
  type RichTrackId,
} from "../shared/rich-recording.js";

export default defineAction({
  description:
    "Get the separate tracks of one of your own rich recordings (screen, camera, mic, system sound, input, page, transcript), each with a short-lived link, plus a link to its manifest.json, which describes every track on the recording's clock. Only the recording's owner can ask, and only recordings made with the Rich recordings lab have tracks. The links work without signing in and expire after 10 minutes unless ttlSeconds asks for another time between 1 and 60 minutes; anyone holding one can download that file until then. They answer HTTP Range requests. For the ordinary video, use create-recording-download-link.",
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
        "How long the links work, in seconds: 60 to 3600. Defaults to 600.",
      ),
  }),
  outputSchema: z.object({
    recordingId: z.string(),
    manifestUrl: z.string(),
    expiresAt: z.string(),
    ttlSeconds: z.number(),
    richBytes: z.number(),
    tracks: z.array(
      z.object({
        id: z.enum(RICH_TRACK_IDS),
        url: z.string(),
        contentType: z.string(),
        bytes: z.number(),
        startMs: z.number(),
        endMs: z.number(),
        complete: z.boolean(),
      }),
    ),
  }),
  readOnly: true,
  run: async (args) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access || access.role !== "owner") {
      fail("Only the recording's owner can read its tracks.", {
        errorCode: "owner_only",
        statusCode: 403,
      });
    }
    const recording = access.resource as {
      id: string;
      ownerEmail: string;
      trashedAt?: string | null;
      failureCode?: string | null;
      mediaFormat?: string | null;
      richManifestUrl?: string | null;
      richBytes?: number | null;
      editsJson?: string | null;
    };
    if (await contextClipIdForFootage(recording.id)) {
      fail(
        "This is earlier screen time attached to a clip, not a clip of its own.",
        { errorCode: "footage_not_downloadable", statusCode: 422 },
      );
    }
    const refusal = recordingTracksRefusal(recording);
    if (refusal) {
      fail(refusal.message, {
        errorCode: refusal.errorCode,
        statusCode: refusal.statusCode,
      });
    }

    const ttlSeconds =
      args.ttlSeconds ?? RECORDING_DOWNLOAD_DEFAULT_TTL_SECONDS;
    const origin = new URL(
      getRequestContext()?.requestOrigin || getAppProductionUrl(),
    ).origin;
    const route = `${getServerAppBasePath()}${localRecordingVideoRoute(recording.id)}/tracks`;
    let expiresAt = "";
    const linkFor = (file: RecordingTrackFile) => {
      const grant = createRecordingTrackGrant({
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
        file,
        ttlSeconds,
      });
      expiresAt = grant.expiresAt;
      const url = new URL(`${route}/${file}`, origin);
      url.searchParams.set(RECORDING_DOWNLOAD_ACCESS_PARAM, grant.token);
      return url.toString();
    };

    const rows = await listRecordingTracks(recording.id, recording.ownerEmail);
    const tracks = rows
      .filter((row): row is RecordingTrackRow & { track: RichTrackId } =>
        isRichTrackId(row.track),
      )
      .sort(
        (a, b) =>
          RICH_TRACK_IDS.indexOf(a.track) - RICH_TRACK_IDS.indexOf(b.track),
      )
      .map((row) => ({
        id: row.track,
        url: linkFor(row.track),
        contentType: row.contentType,
        bytes: row.bytes,
        startMs: row.startMs,
        endMs: row.endMs,
        complete: row.complete,
      }));

    return {
      recordingId: recording.id,
      manifestUrl: linkFor(RICH_MANIFEST_FILE),
      expiresAt,
      ttlSeconds,
      richBytes: recording.richBytes ?? 0,
      tracks,
    };
  },
});
