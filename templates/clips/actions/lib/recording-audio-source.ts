import { createWriteStream } from "node:fs";
import { mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { readAppState } from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { formatUploadBytes, MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";

import { isBuilderCdnHost } from "../../server/lib/builder-cdn.js";
import { fetchS3ObjectByUrl } from "../../server/lib/s3-upload-provider.js";
import {
  AudioOnlyExtractionError,
  extractAudioOnlyWithFfmpeg,
  type AudioExtractor,
  type AudioOnlyTranscriptionMedia,
} from "./audio-only-transcription.js";

interface RecordingAudioTimeouts {
  downloadMs: number;
  extractionMs: number;
}

type MediaFetcher = (url: string, init: RequestInit) => Promise<Response>;

// Free bytes on the filesystem holding `dir`, or null when it can't be read.
type FreeSpaceReader = (dir: string) => Promise<number | null>;

type RecordingMediaTarget =
  | { kind: "local-blob" }
  | { kind: "stream"; url: string; origin: "app" | "builder-cdn" }
  | { kind: "download"; url: string };

function appOrigin(): string {
  const port = process.env.NITRO_PORT || process.env.PORT || "3000";
  return (
    process.env.PUBLIC_URL ??
    process.env.NITRO_PUBLIC_URL ??
    `http://localhost:${port}`
  );
}

// Only URLs the server controls may be streamed by ffmpeg directly: ffmpeg
// follows redirects and resolves hosts without the SSRF guard, so any other
// URL is downloaded through ssrfSafeFetch instead.
export function resolveRecordingMediaTarget(
  videoUrl: string,
): RecordingMediaTarget {
  if (
    videoUrl.startsWith("/api/video/") ||
    (videoUrl.startsWith("/api/uploads/") && videoUrl.endsWith("/blob"))
  ) {
    return { kind: "local-blob" };
  }
  if (videoUrl.startsWith("/") && !videoUrl.startsWith("//")) {
    return { kind: "stream", url: `${appOrigin()}${videoUrl}`, origin: "app" };
  }
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return { kind: "download", url: videoUrl };
  }
  if (parsed.protocol === "https:" && isBuilderCdnHost(parsed.hostname)) {
    return { kind: "stream", url: parsed.toString(), origin: "builder-cdn" };
  }
  return { kind: "download", url: videoUrl };
}

const safeFetch: MediaFetcher = (url, init) =>
  ssrfSafeFetch(url, init, { maxRedirects: 3 });

// Room kept for ffmpeg's audio output, which shares the temp filesystem with
// the downloaded video: about an hour and a half of transcription audio.
const AUDIO_OUTPUT_RESERVE_BYTES = 32 * 1024 * 1024;

const readFreeSpace: FreeSpaceReader = async (dir) => {
  try {
    const stats = await statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
};

// Serverless temp space is small (512 MB on AWS Lambda) next to the upload
// limit, so a video that can't fit fails with a plain reason instead of a raw
// ENOSPC, and isn't retried, since every attempt would fail the same way.
function tooLargeError(reason: string): AudioOnlyExtractionError {
  return new AudioOnlyExtractionError(
    "MEDIA_TOO_LARGE",
    `This video is too large to transcribe. ${reason}`,
  );
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "clips-transcription-source-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      console.warn(
        `[clips] failed to remove transcription temp dir ${dir}:`,
        (err as Error)?.message ?? String(err),
      );
    });
  }
}

async function downloadToFile(
  url: string,
  path: string,
  fetcher: MediaFetcher,
  timeoutMs: number,
  freeSpace: FreeSpaceReader,
): Promise<void> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
  await writeResponseToFile(res, path, freeSpace);
}

async function writeResponseToFile(
  res: Response,
  path: string,
  freeSpace: FreeSpaceReader,
): Promise<void> {
  if (!res.ok) {
    // guard:allow-bare-error — invariant: request-transcript records media preparation errors as a failed transcript.
    throw new Error(
      `Failed to fetch videoUrl: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const declaredBytes = Number(res.headers.get("content-length") ?? "0");
  if (declaredBytes > MAX_UPLOAD_BYTES) {
    throw tooLargeError(
      `It is ${formatUploadBytes(declaredBytes, "up")}, over the ${formatUploadBytes(MAX_UPLOAD_BYTES, "down")} limit.`,
    );
  }
  if (declaredBytes > 0) {
    const free = await freeSpace(dirname(path));
    if (free !== null && declaredBytes + AUDIO_OUTPUT_RESERVE_BYTES > free) {
      throw tooLargeError(
        `It is ${formatUploadBytes(declaredBytes, "up")}, and the server has room for ${formatUploadBytes(Math.max(0, free - AUDIO_OUTPUT_RESERVE_BYTES), "down")}.`,
      );
    }
  }
  // guard:allow-bare-error — invariant: request-transcript catches media preparation errors and records them as a failed transcript.
  if (!res.body) throw new Error("Failed to fetch videoUrl: empty body");

  let receivedBytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPLOAD_BYTES) {
        callback(
          tooLargeError(
            `It is over the ${formatUploadBytes(MAX_UPLOAD_BYTES, "down")} limit.`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body as unknown as NodeReadableStream),
    limit,
    createWriteStream(path),
  );
}

export async function prepareRecordingTranscriptionAudio({
  recordingId,
  videoUrl,
  storageMode,
  timeouts,
  extractor = extractAudioOnlyWithFfmpeg,
  fetchers = { app: fetch, safe: safeFetch },
  freeSpace = readFreeSpace,
}: {
  recordingId: string;
  videoUrl: string;
  storageMode?: "own" | "hosted" | null;
  timeouts: RecordingAudioTimeouts;
  extractor?: AudioExtractor;
  fetchers?: { app: MediaFetcher; safe: MediaFetcher };
  freeSpace?: FreeSpaceReader;
}): Promise<AudioOnlyTranscriptionMedia> {
  const extractFromFile = (write: (path: string) => Promise<void>) =>
    withTempDir(async (dir) => {
      const path = join(dir, "input");
      try {
        await write(path);
      } catch (err) {
        // A download without a declared size can still fill the disk.
        if ((err as NodeJS.ErrnoException)?.code !== "ENOSPC") throw err;
        throw tooLargeError(
          "The server ran out of temporary space while saving it.",
        );
      }
      return extractor({
        source: { kind: "file", path },
        timeoutMs: timeouts.extractionMs,
      });
    });
  const downloadAndExtract = (url: string, fetcher: MediaFetcher) =>
    extractFromFile((path) =>
      downloadToFile(url, path, fetcher, timeouts.downloadMs, freeSpace),
    );

  if (storageMode === "hosted") {
    return extractFromFile(async (path) => {
      const res = await fetchS3ObjectByUrl(videoUrl, {
        storageMode: "hosted",
        recordingId,
        timeoutMs: timeouts.downloadMs,
      });
      // guard:allow-bare-error — invariant: request-transcript records media preparation errors as a failed transcript.
      if (!res) throw new Error("Failed to fetch hosted recording media");
      await writeResponseToFile(res, path, freeSpace);
    });
  }

  const target = resolveRecordingMediaTarget(videoUrl);
  switch (target.kind) {
    case "local-blob":
      return extractFromFile(async (path) => {
        const stash = await readAppState(`recording-blob-${recordingId}`);
        const b64 = typeof stash?.data === "string" ? stash.data : null;
        // guard:allow-bare-error — invariant: request-transcript catches media preparation errors and records them as a failed transcript.
        if (!b64) throw new Error("recording-blob app-state missing");
        await writeFile(path, Buffer.from(b64, "base64"));
      });
    case "download":
      return downloadAndExtract(target.url, fetchers.safe);
    case "stream":
      try {
        return await extractor({
          source: { kind: "url", url: target.url },
          timeoutMs: timeouts.downloadMs + timeouts.extractionMs,
        });
      } catch (err) {
        // A stream can fail where a full download succeeds, e.g. a server
        // without range support for an MP4 whose index sits at the end.
        if (
          !(err instanceof AudioOnlyExtractionError) ||
          err.code !== "EXTRACTION_FAILED"
        ) {
          throw err;
        }
        console.warn(
          `[clips] streaming audio extraction failed for ${recordingId}; retrying from a downloaded copy: ${err.message}`,
        );
        return downloadAndExtract(
          target.url,
          target.origin === "app" ? fetchers.app : fetchers.safe,
        );
      }
  }
}
