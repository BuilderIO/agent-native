import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

import { probeMediaDurationMs } from "../../server/lib/video-frame.js";
import { isFfmpegAvailable } from "../../server/lib/video-remux.js";
import { readResponseBytesWithLimit } from "./video-download-limits.js";

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
const MAX_EXPECTED_DURATION_TOLERANCE_MS = 5_000;

export class LoomVideoUnavailableError extends Error {
  statusCode = 422;

  constructor(message = LOOM_VIDEO_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "LoomVideoUnavailableError";
  }
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

async function validateDownloadedVideo({
  bytes,
  mimeType,
  expectedDurationMs,
}: {
  bytes: Uint8Array;
  mimeType: string;
  expectedDurationMs?: number | null;
}): Promise<void> {
  if (!isFfmpegAvailable()) {
    throw new LoomVideoUnavailableError(
      "Loom media could not be verified in this environment.",
    );
  }

  const actualDurationMs = await probeMediaDurationMs(bytes, mimeType, {
    requireComplete: true,
  });
  if (actualDurationMs === null || actualDurationMs <= 0) {
    throw new LoomVideoUnavailableError(
      "Loom returned media without a playable video track.",
    );
  }

  if (expectedDurationMs && expectedDurationMs > 0) {
    const toleranceMs = Math.min(
      MAX_EXPECTED_DURATION_TOLERANCE_MS,
      Math.round(expectedDurationMs * 0.1),
    );
    if (actualDurationMs + toleranceMs < expectedDurationMs) {
      throw new LoomVideoUnavailableError(
        "Loom returned an incomplete video file.",
      );
    }
  }
}

export async function downloadLoomVideo({
  loomId,
  shareUrl,
  expectedDurationMs,
}: {
  loomId: string;
  shareUrl: string;
  expectedDurationMs?: number | null;
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
  if (response.status === 206 || response.headers.has("content-range")) {
    throw new LoomVideoUnavailableError("Loom returned a partial video file.");
  }

  const mimeType = normalizeVideoMimeType(response.headers.get("content-type"));
  const bytes = await readResponseBytesWithLimit(response);
  if (bytes.byteLength <= 0) {
    throw new Error("Loom returned an empty video file.");
  }
  await validateDownloadedVideo({
    bytes,
    mimeType,
    expectedDurationMs,
  });
  return {
    bytes,
    mimeType,
    sizeBytes: bytes.byteLength,
    sourceUrl,
  };
}
