import { signShortLivedToken } from "@agent-native/core/server";
import {
  LOOM_NATIVE_MEDIA_QUERY_PARAM,
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom.js";

type PlayerVideoRecording = {
  id: string;
  password?: string | null;
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
    const token = signShortLivedToken({ resourceId: recording.id });
    resolvedVideoUrl = appendQueryParam(resolvedVideoUrl, "t", token);
  }

  if (options.appPath && resolvedVideoUrl.startsWith("/")) {
    resolvedVideoUrl = options.appPath(resolvedVideoUrl);
  }

  return resolvedVideoUrl;
}
