/**
 * Serves one of a rich recording's separate tracks, or its manifest, to a
 * holder of the short-lived link `get-recording-tracks` made for that file.
 * Nothing else opens it: share links, embeds, passwords and sessions all get
 * a 401, because only the owner may read a recording's tracks.
 *
 * Route: GET /api/video/:recordingId/tracks/:track?download_access=<token>
 *   :track is a track id (shared/rich-recording.ts) or `manifest`.
 *
 * Answers HTTP Range requests, as the video route does.
 */
import { runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  fetchProviderMedia,
  messageForProviderFetchError,
  PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
  providerResponse,
  statusCodeForProviderFetchError,
} from "../../../../../lib/provider-media-fetch.js";
import {
  isRecordingTrackFile,
  RECORDING_DOWNLOAD_ACCESS_PARAM,
  resolveRecordingTrackAccess,
} from "../../../../../lib/recording-download-link.js";
import { fetchS3ObjectByUrl } from "../../../../../lib/s3-upload-provider.js";

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return typeof value === "string" ? value : "";
}

export default defineEventHandler(async (event: H3Event) => {
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  const recordingId = getRouterParam(event, "recordingId");
  const file = getRouterParam(event, "track");
  if (!recordingId || !isRecordingTrackFile(file)) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const token = firstQueryValue(
    getQuery(event)[RECORDING_DOWNLOAD_ACCESS_PARAM],
  );
  if (!token) {
    setResponseStatus(event, 401);
    return {
      error:
        "A recording's tracks open only through links from get-recording-tracks.",
      errorCode: "link_required",
    };
  }
  const access = await resolveRecordingTrackAccess(recordingId, file, token);
  if (!access.ok) {
    setResponseStatus(event, access.statusCode);
    return { error: access.message, errorCode: access.errorCode };
  }

  const { recording } = access;
  const rangeHeader = getRequestHeader(event, "range");
  const range = rangeHeader?.startsWith("bytes=") ? rangeHeader : undefined;
  return runWithRequestContext(
    {
      userEmail: recording.ownerEmail,
      orgId: recording.organizationId,
    },
    async () => {
      let upstream: Response | { error: string; status: number };
      try {
        const signed = await fetchS3ObjectByUrl(access.url, {
          range,
          timeoutMs: PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
          recordingId,
          storageMode: recording.storageMode === "hosted" ? "hosted" : "own",
        });
        if (
          signed?.status === 200 ||
          signed?.status === 206 ||
          signed?.status === 416
        ) {
          upstream = signed;
        } else if (recording.storageMode === "hosted") {
          await signed?.body?.cancel().catch(() => undefined);
          upstream = {
            status: !signed || signed.status === 404 ? 404 : 502,
            error: "The track could not be loaded from storage.",
          };
        } else {
          await signed?.body?.cancel().catch(() => undefined);
          upstream = await fetchProviderMedia(access.url, range);
        }
      } catch (err) {
        setResponseStatus(event, statusCodeForProviderFetchError(err));
        return { error: messageForProviderFetchError(err) };
      }
      if (!(upstream instanceof Response)) {
        setResponseStatus(event, upstream.status);
        return { error: upstream.error };
      }
      if (upstream.status >= 500) {
        await upstream.body?.cancel().catch(() => undefined);
        setResponseStatus(event, 502);
        return {
          error: "The track could not be loaded from storage.",
          upstreamStatus: upstream.status,
        };
      }
      const response = providerResponse(upstream);
      // The stored type was checked against the track's own list when it was
      // uploaded; never let storage pick something a browser would run.
      if (upstream.status === 200 || upstream.status === 206) {
        response.headers.set("content-type", access.contentType);
      }
      response.headers.set(
        "Content-Security-Policy",
        "default-src 'none'; sandbox",
      );
      return response;
    },
  );
});
