const LOOM_HOST_RE = /(^|\.)loom\.com$/i;
const LOOM_VIDEO_ID_RE = /^[A-Za-z0-9_-]{8,120}$/;
const LOOM_VIDEO_PATHS = new Set(["share", "embed"]);
export const LOOM_START_MS_QUERY_PARAM = "loomStartMs";
export const LOOM_NATIVE_MEDIA_QUERY_PARAM = "loomMedia";

function parsePublicUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!LOOM_HOST_RE.test(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHost(parsed: URL): void {
  parsed.protocol = "https:";
  parsed.hostname = "www.loom.com";
  parsed.hash = "";
}

export function extractLoomVideoId(value: string): string | null {
  const parsed = parsePublicUrl(value);
  if (!parsed) return null;

  const [kind, rawId] = parsed.pathname.split("/").filter(Boolean);
  if (!kind || !LOOM_VIDEO_PATHS.has(kind)) return null;
  if (!rawId || !LOOM_VIDEO_ID_RE.test(rawId)) return null;
  return rawId;
}

export function normalizeLoomShareUrl(value: string): string | null {
  const parsed = parsePublicUrl(value);
  const id = extractLoomVideoId(value);
  if (!parsed || !id) return null;

  normalizeHost(parsed);
  parsed.pathname = `/share/${id}`;

  const sid = parsed.searchParams.get("sid");
  parsed.search = "";
  if (sid) parsed.searchParams.set("sid", sid);

  return parsed.href;
}

export function sanitizeLoomEmbedUrl(value: string): string | null {
  const parsed = parsePublicUrl(value);
  const id = extractLoomVideoId(value);
  if (!parsed || !id) return null;

  const [kind] = parsed.pathname.split("/").filter(Boolean);
  if (kind !== "embed") return null;

  normalizeHost(parsed);
  parsed.pathname = `/embed/${id}`;
  return parsed.href;
}

export function loomTimestampParamFromMs(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${seconds}s`;
}

export function loomEmbedUrlWithTimestamp(
  value: string,
  ms: number,
): string | null {
  const sanitized = sanitizeLoomEmbedUrl(value);
  if (!sanitized) return null;

  const parsed = new URL(sanitized);
  parsed.searchParams.set("t", loomTimestampParamFromMs(ms));
  return parsed.href;
}

export function isLoomEmbedUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && Boolean(sanitizeLoomEmbedUrl(value));
}

function isLocalVideoRoute(value: string): boolean {
  try {
    const parsed = new URL(value, "http://local.test");
    return /(?:^|\/)api\/video\/[^/]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isMarkedLoomNativeMedia(value: string): boolean {
  try {
    const parsed = new URL(value, "http://local.test");
    return parsed.searchParams.get(LOOM_NATIVE_MEDIA_QUERY_PARAM) === "1";
  } catch {
    return false;
  }
}

export function isLoomSourceName(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "loom";
}

export type LoomRecordingLike = {
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  videoUrl?: string | null;
};

export function isLoomRecordingSource(
  recording: LoomRecordingLike | null | undefined,
): boolean {
  if (!recording) return false;
  return (
    isLoomSourceName(recording.sourceAppName) ||
    isLoomEmbedUrl(recording.videoUrl)
  );
}

export function isLoomEmbedBackedRecording(
  recording: LoomRecordingLike | null | undefined,
): boolean {
  if (!recording) return false;
  if (isLoomEmbedUrl(recording.videoUrl)) return true;
  if (!isLoomSourceName(recording.sourceAppName)) return false;

  const videoUrl = recording.videoUrl?.trim() ?? "";
  if (!videoUrl) return true;
  if (isMarkedLoomNativeMedia(videoUrl)) return false;
  return isLocalVideoRoute(videoUrl);
}

export function loomEmbedUrlForId(id: string): string {
  return `https://www.loom.com/embed/${encodeURIComponent(id)}`;
}

export function loomEmbedUrlForRecording(
  recording: LoomRecordingLike | null | undefined,
): string | null {
  if (!recording) return null;

  const fromVideoUrl = sanitizeLoomEmbedUrl(recording.videoUrl ?? "");
  if (fromVideoUrl) return fromVideoUrl;

  if (!isLoomSourceName(recording.sourceAppName)) return null;
  const id =
    extractLoomVideoId(recording.sourceWindowTitle ?? "") ??
    extractLoomVideoId(recording.videoUrl ?? "");
  return id ? loomEmbedUrlForId(id) : null;
}

export function extractLoomEmbedUrlFromHtml(html: string): string | null {
  const match = html.match(
    /<iframe\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  if (!raw) return null;

  return sanitizeLoomEmbedUrl(raw.replace(/&amp;/g, "&"));
}
