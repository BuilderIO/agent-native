import { signShortLivedToken } from "@agent-native/core/server";
import { isLoomRecordingSource } from "../../shared/loom.js";

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

export function resolvePlayerVideoUrl(
  recording: PlayerVideoRecording,
  options: {
    addPasswordToken?: boolean;
    appPath?: (path: string) => string;
  } = {},
): string | null {
  let resolvedVideoUrl = recording.videoUrl ?? null;
  if (!resolvedVideoUrl) return null;

  if (isLoomRecordingSource(recording)) {
    resolvedVideoUrl = localRecordingVideoRoute(recording.id);
  } else {
    const legacyMatch = resolvedVideoUrl.match(
      /^\/api\/uploads\/([^/]+)\/blob$/,
    );
    if (legacyMatch) {
      resolvedVideoUrl = localRecordingVideoRoute(legacyMatch[1]);
    }
  }

  if (
    options.addPasswordToken &&
    recording.password &&
    resolvedVideoUrl.startsWith("/api/video/")
  ) {
    const token = signShortLivedToken({ resourceId: recording.id });
    const sep = resolvedVideoUrl.includes("?") ? "&" : "?";
    resolvedVideoUrl = `${resolvedVideoUrl}${sep}t=${encodeURIComponent(token)}`;
  }

  if (options.appPath && resolvedVideoUrl.startsWith("/")) {
    resolvedVideoUrl = options.appPath(resolvedVideoUrl);
  }

  return resolvedVideoUrl;
}
