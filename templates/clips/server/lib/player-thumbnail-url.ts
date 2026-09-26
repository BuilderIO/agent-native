import { isImageRecording } from "../../shared/recording-kind.js";

export type PlayerThumbnailRecording = {
  id: string;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  baseImageUrl?: string | null;
  /** When the stored image last changed. */
  mediaUpdatedAt?: string | null;
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
    animated?: boolean;
    /** The un-marked base image an editor draws on, rather than the served one. */
    base?: boolean;
    appPath?: (path: string) => string;
  } = {},
): string | null {
  if (options.base && !recording.baseImageUrl) return null;
  if (!recording.thumbnailUrl && !recording.animatedThumbnailUrl) return null;

  let resolved = localRecordingThumbnailRoute(recording.id);
  if (options.accessToken) {
    resolved = appendQueryParam(resolved, "t", options.accessToken);
  }
  if (options.animated) {
    resolved = appendQueryParam(resolved, "animated", "1");
  }
  if (options.base) {
    resolved = appendQueryParam(resolved, "base", "1");
  }
  // The route is the same before and after a screenshot is edited, and a
  // browser that already holds an <img> for a URL does not ask again — so a
  // library card kept showing the picture from before the edit. The version
  // makes an edited image a new URL everywhere this is used.
  if (recording.mediaUpdatedAt) {
    resolved = appendQueryParam(resolved, "media", recording.mediaUpdatedAt);
  }
  if (options.appPath) resolved = options.appPath(resolved);
  return resolved;
}

/**
 * The thumbnail a listing hands back. A screenshot's thumbnail is the whole
 * picture, so it goes through the route that checks password, expiry and the
 * redaction hold, never as the raw storage URL.
 */
export function listingThumbnailUrl(
  recording: PlayerThumbnailRecording & { kind?: string | null },
): string | null {
  return isImageRecording(recording)
    ? resolvePlayerThumbnailUrl(recording)
    : (recording.thumbnailUrl ?? null);
}
