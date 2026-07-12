import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { z } from "zod";

const LOOM_DOWNLOAD_TIMEOUT_MS = 120_000;
const LOOM_VIDEO_USER_AGENT =
  "Mozilla/5.0 (compatible; AgentNativeClips/1.0; +https://agent-native.com)";

const LoomTranscodedUrlSchema = z.object({
  url: z.string().url(),
});

export type LoomVideoDownload = {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
  sourceUrl: string;
};

const LOOM_VIDEO_UNAVAILABLE_MESSAGE =
  "Loom did not provide a downloadable MP4 for this video. Download the original from Loom and use Upload video in Clips.";

export class LoomVideoUnavailableError extends Error {
  statusCode = 422;

  constructor(message = LOOM_VIDEO_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "LoomVideoUnavailableError";
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function assertUploadSize(sizeBytes: number | null | undefined): void {
  if (!Number.isFinite(sizeBytes ?? NaN) || (sizeBytes ?? 0) <= 0) return;
  if ((sizeBytes ?? 0) > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Loom video is too large to import (${formatBytes(sizeBytes ?? 0)}, max ${formatBytes(MAX_UPLOAD_BYTES)}). Download a shorter or compressed copy and upload it directly.`,
    );
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function safeLoomDownloadUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "cdn.loom.com") return null;
    if (!parsed.pathname.startsWith("/sessions/transcoded/")) return null;
    if (!parsed.pathname.endsWith(".mp4")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function readResponseBytesWithLimit(
  response: Response,
): Promise<Uint8Array> {
  const contentLength = parseContentLength(
    response.headers.get("content-length"),
  );
  assertUploadSize(contentLength);

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    assertUploadSize(arrayBuffer.byteLength);
    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      assertUploadSize(totalBytes);
      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, totalBytes);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function normalizeVideoMimeType(value: string | null): string {
  const mimeType = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mimeType || mimeType === "application/octet-stream") return "video/mp4";
  if (mimeType !== "video/mp4") {
    throw new Error(
      `Loom returned ${mimeType || "unknown"} instead of MP4 video.`,
    );
  }
  return "video/mp4";
}

async function fetchTranscodedVideoUrl({
  loomId,
  shareUrl,
}: {
  loomId: string;
  shareUrl: string;
}): Promise<string> {
  const endpoint = `https://www.loom.com/api/campaigns/sessions/${encodeURIComponent(
    loomId,
  )}/transcoded-url`;
  const response = await ssrfSafeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.loom.com",
        Referer: shareUrl,
        "User-Agent": LOOM_VIDEO_USER_AGENT,
        "X-Loom-Request-Source": "loom_web",
      },
      signal: AbortSignal.timeout(15_000),
    },
    { maxRedirects: 2 },
  );

  if (response.status === 204) {
    throw new LoomVideoUnavailableError();
  }

  if (!response.ok) {
    throw new Error(
      `Loom did not provide a downloadable MP4 (${response.status} ${response.statusText}). Make sure the link is public and allows playback.`,
    );
  }

  const parsed = LoomTranscodedUrlSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Loom returned an unexpected video download response.");
  }

  const sourceUrl = safeLoomDownloadUrl(parsed.data.url);
  if (!sourceUrl) {
    throw new Error(
      "Loom returned a video URL that Clips cannot import safely.",
    );
  }
  return sourceUrl;
}

export async function downloadLoomVideo({
  loomId,
  shareUrl,
}: {
  loomId: string;
  shareUrl: string;
}): Promise<LoomVideoDownload> {
  const sourceUrl = await fetchTranscodedVideoUrl({ loomId, shareUrl });
  const response = await ssrfSafeFetch(
    sourceUrl,
    {
      headers: {
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": LOOM_VIDEO_USER_AGENT,
      },
      signal: AbortSignal.timeout(LOOM_DOWNLOAD_TIMEOUT_MS),
    },
    { maxRedirects: 3 },
  );

  if (!response.ok) {
    throw new Error(
      `Loom video download failed (${response.status} ${response.statusText}).`,
    );
  }

  const mimeType = normalizeVideoMimeType(response.headers.get("content-type"));
  const bytes = await readResponseBytesWithLimit(response);
  if (bytes.byteLength <= 0) {
    throw new Error("Loom returned an empty video file.");
  }
  return {
    bytes,
    mimeType,
    sizeBytes: bytes.byteLength,
    sourceUrl,
  };
}
