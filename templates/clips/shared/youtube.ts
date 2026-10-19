export const YOUTUBE_SOURCE_APP_NAME = "YouTube";

const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
const YOUTU_BE_HOST_RE = /^(www\.)?youtu\.be$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_ID_PATHS = new Set(["embed", "shorts", "live", "v"]);
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube.com";

function parseYouTubeUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (
      !YOUTUBE_HOST_RE.test(parsed.hostname) &&
      !YOUTU_BE_HOST_RE.test(parsed.hostname)
    ) {
      return null;
    }
    return parsed;
    // coercion-ok: input that is not a URL is not a YouTube link
  } catch {
    return null;
  }
}

function validVideoId(value: string | null | undefined): string | null {
  return value && YOUTUBE_VIDEO_ID_RE.test(value) ? value : null;
}

/** The 11-character video ID from any YouTube watch, share, Shorts or embed link. */
export function extractYouTubeVideoId(value: string): string | null {
  const parsed = parseYouTubeUrl(value);
  if (!parsed) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (YOUTU_BE_HOST_RE.test(parsed.hostname)) {
    return validVideoId(segments[0]);
  }
  if (segments[0] === "watch") {
    return validVideoId(parsed.searchParams.get("v"));
  }
  if (segments[0] && YOUTUBE_ID_PATHS.has(segments[0])) {
    return validVideoId(segments[1]);
  }
  return null;
}

export function isYouTubeUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && parseYouTubeUrl(value) !== null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}`;
}

/** Only the canonical embed URL that a YouTube import stores counts. */
export function youtubeVideoIdFromEmbedUrl(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^https:\/\/www\.youtube\.com\/embed\/([A-Za-z0-9_-]{11})$/);
  return match?.[1] ?? null;
}

export type YouTubeRecordingLike = {
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  videoUrl?: string | null;
};

export function youtubeVideoIdForRecording(
  recording: YouTubeRecordingLike | null | undefined,
): string | null {
  if (!recording) return null;
  const fromVideoUrl = youtubeVideoIdFromEmbedUrl(recording.videoUrl);
  if (fromVideoUrl) return fromVideoUrl;
  if (
    recording.sourceAppName?.trim().toLowerCase() !==
    YOUTUBE_SOURCE_APP_NAME.toLowerCase()
  ) {
    return null;
  }
  return extractYouTubeVideoId(recording.sourceWindowTitle ?? "");
}

export function isYouTubeEmbedBackedRecording(
  recording: YouTubeRecordingLike | null | undefined,
): boolean {
  return youtubeVideoIdForRecording(recording) !== null;
}
