import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

import { readResponseBytesWithLimit } from "./video-download-limits.js";

const DIRECT_VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;
const DIRECT_VIDEO_USER_AGENT =
  "Mozilla/5.0 (compatible; AgentNativeClips/1.0; +https://agent-native.com)";

export type DirectVideoDownload = {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
};

const VIDEO_EXTENSION_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function guessMimeTypeFromUrl(sourceUrl: string): string | null {
  let path: string;
  try {
    path = new URL(sourceUrl).pathname.toLowerCase();
  } catch {
    return null;
  }
  for (const [ext, mime] of Object.entries(VIDEO_EXTENSION_MIME)) {
    if (path.endsWith(ext)) return mime;
  }
  return null;
}

function normalizeDirectVideoMimeType(
  headerValue: string | null,
  sourceUrl: string,
): string | null {
  const mimeType =
    (headerValue ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mimeType === "video/mp4" || mimeType === "video/webm") {
    return mimeType;
  }
  if (!mimeType || mimeType === "application/octet-stream") {
    return guessMimeTypeFromUrl(sourceUrl);
  }
  return null;
}

/** Any non-Loom `https://`/`http://` URL is a candidate direct video link;
 * the real check happens after fetching, against the response content type. */
export function isCandidateDirectVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function downloadDirectVideo(
  url: string,
): Promise<DirectVideoDownload> {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        Accept: "video/mp4,video/webm,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": DIRECT_VIDEO_USER_AGENT,
      },
      signal: AbortSignal.timeout(DIRECT_VIDEO_DOWNLOAD_TIMEOUT_MS),
    },
    { maxRedirects: 3 },
  );

  if (!response.ok) {
    throw new Error(
      `Could not download that link (${response.status} ${response.statusText}). Make sure the URL is public and points directly to a video file.`,
    );
  }

  const mimeType = normalizeDirectVideoMimeType(
    response.headers.get("content-type"),
    url,
  );
  if (!mimeType) {
    throw new Error(
      "That link doesn't point to a video file Clips can import. Paste a Loom link, or a direct link to an MP4/WebM file.",
    );
  }

  const bytes = await readResponseBytesWithLimit(response);
  if (bytes.byteLength <= 0) {
    throw new Error("That link returned an empty file.");
  }

  return { bytes, mimeType, sizeBytes: bytes.byteLength };
}
