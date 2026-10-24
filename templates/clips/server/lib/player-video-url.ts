import { signShortLivedToken } from "@agent-native/core/server";

import {
  LOOM_NATIVE_MEDIA_QUERY_PARAM,
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom.js";
import {
  youtubeEmbedUrl,
  youtubeVideoIdForRecording,
} from "../../shared/youtube.js";
import { getRecordingAccessTokenResourceId } from "./share-password.js";

type PlayerVideoRecording = {
  id: string;
  password?: string | null;
  sharePasswordVersion?: string | null;
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  videoUrl?: string | null;
};

export function localRecordingVideoRoute(recordingId: string): string {
  return `/api/video/${encodeURIComponent(recordingId)}`;
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function resolvePlayerVideoUrl(
  recording: PlayerVideoRecording,
  options: {
    addPasswordToken?: boolean;
    appPath?: (path: string) => string;
    proxyRemoteMedia?: boolean;
  } = {},
): string | null {
  let resolvedVideoUrl = recording.videoUrl ?? null;
  if (!resolvedVideoUrl) return null;

  // YouTube's player loads the video itself, so the canonical embed URL goes
  // to the browser as is: there is no Clips media behind it to proxy or gate.
  const youtubeVideoId = youtubeVideoIdForRecording(recording);
  if (youtubeVideoId) return youtubeEmbedUrl(youtubeVideoId);

  const isLoomSource = isLoomRecordingSource(recording);
  const isLoomNativeMedia =
    isLoomSource && !isLoomEmbedBackedRecording(recording);

  if (isLoomSource) {
    resolvedVideoUrl = localRecordingVideoRoute(recording.id);
    if (isLoomNativeMedia) {
      resolvedVideoUrl = appendQueryParam(
        resolvedVideoUrl,
        LOOM_NATIVE_MEDIA_QUERY_PARAM,
        "1",
      );
    }
  } else {
    const legacyMatch = resolvedVideoUrl.match(
      /^\/api\/uploads\/([^/]+)\/blob$/,
    );
    if (legacyMatch) {
      resolvedVideoUrl = localRecordingVideoRoute(legacyMatch[1]);
    } else if (
      options.proxyRemoteMedia &&
      /^https?:\/\//i.test(resolvedVideoUrl)
    ) {
      resolvedVideoUrl = localRecordingVideoRoute(recording.id);
    }
  }

  if (
    options.addPasswordToken &&
    recording.password &&
    resolvedVideoUrl.startsWith("/api/video/")
  ) {
    const token = signShortLivedToken({
      resourceId: getRecordingAccessTokenResourceId(
        recording.id,
        recording.password,
        recording.sharePasswordVersion,
      ),
    });
    resolvedVideoUrl = appendQueryParam(resolvedVideoUrl, "t", token);
  }

  if (options.appPath && resolvedVideoUrl.startsWith("/")) {
    resolvedVideoUrl = options.appPath(resolvedVideoUrl);
  }

  return resolvedVideoUrl;
}
