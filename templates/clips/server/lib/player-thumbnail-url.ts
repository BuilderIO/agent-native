export type PlayerThumbnailRecording = {
  id: string;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
};

function appendQueryParam(url: string, key: string, value: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function localRecordingThumbnailRoute(recordingId: string): string {
  return `/api/thumbnail/${encodeURIComponent(recordingId)}`;
}

export function resolvePlayerThumbnailUrl(
  recording: PlayerThumbnailRecording,
  options: {
    accessToken?: string | null;
    appPath?: (path: string) => string;
  } = {},
): string | null {
  if (!recording.thumbnailUrl && !recording.animatedThumbnailUrl) return null;

  let resolved = localRecordingThumbnailRoute(recording.id);
  if (options.accessToken) {
    resolved = appendQueryParam(resolved, "t", options.accessToken);
  }
  if (options.appPath) resolved = options.appPath(resolved);
  return resolved;
}
