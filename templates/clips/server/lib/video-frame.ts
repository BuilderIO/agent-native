import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveFfmpegCommand } from "./video-remux.js";

const FRAME_EXTRACTION_TIMEOUT_MS = 20_000;
const COMPLETE_MEDIA_VALIDATION_TIMEOUT_MS = 45_000;
const MAX_CONCURRENT_FRAME_EXTRACTIONS = 2;
const MAX_CONCURRENT_MEDIA_VALIDATIONS = 1;
const MEDIA_VALIDATION_QUEUE_TIMEOUT_MS = 20_000;
const STDERR_LIMIT = 16 * 1024;
let activeFrameExtractions = 0;
const frameExtractionWaiters: Array<() => void> = [];
let activeMediaValidations = 0;
const mediaValidationWaiters: Array<() => void> = [];

export type VideoFrameExtractionErrorCode =
  | "NO_VIDEO"
  | "FFMPEG_UNAVAILABLE"
  | "EXTRACTION_FAILED";

export class VideoFrameExtractionError extends Error {
  code: VideoFrameExtractionErrorCode;

  constructor(code: VideoFrameExtractionErrorCode, message: string) {
    super(message);
    this.name = "VideoFrameExtractionError";
    this.code = code;
  }
}

class FfmpegRunError extends Error {
  stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "FfmpegRunError";
    this.stderr = stderr;
  }
}

function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function mediaExtensionForMimeType(mimeType: string): string {
  switch (baseMimeType(mimeType)) {
    case "video/mp4":
    case "video/quicktime":
      return "mp4";
    case "video/webm":
      return "webm";
    default:
      return "bin";
  }
}

function isMissingVideoTrack(stderr: string): boolean {
  return /matches no streams|does not contain any stream|output file #0 does not contain any stream|video: none/i.test(
    stderr,
  );
}

function mapFfmpegError(err: unknown): VideoFrameExtractionError {
  const message = err instanceof Error ? err.message : String(err);
  const stderr = err instanceof FfmpegRunError ? err.stderr : "";
  if (/enoent|not found|eacces|enoexec/i.test(message)) {
    return new VideoFrameExtractionError(
      "FFMPEG_UNAVAILABLE",
      "Frame extraction requires ffmpeg.",
    );
  }
  if (isMissingVideoTrack(stderr)) {
    return new VideoFrameExtractionError(
      "NO_VIDEO",
      "This recording does not contain a video track.",
    );
  }
  return new VideoFrameExtractionError(
    "EXTRACTION_FAILED",
    `Failed to extract video frame: ${message}`,
  );
}

async function runFfmpeg(
  args: string[],
  timeoutMs = FRAME_EXTRACTION_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(resolveFfmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegRunError("ffmpeg timed out", stderr));
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new FfmpegRunError(err.message, stderr));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stderr);
        return;
      }
      reject(new FfmpegRunError(`ffmpeg exited with code ${code}`, stderr));
    });
  });
}

function parseDurationMs(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return Math.max(
    0,
    Math.round((hours * 3600 + minutes * 60 + seconds) * 1000),
  );
}

export async function probeMediaDurationMs(
  mediaBytes: Uint8Array,
  mimeType: string,
  options: { requireComplete?: boolean; maxQueueWaitMs?: number } = {},
): Promise<number | null> {
  if (mediaBytes.byteLength === 0) return null;

  const dir = await mkdtemp(join(tmpdir(), "clips-duration-probe-"));
  const inputPath = join(dir, `input.${mediaExtensionForMimeType(mimeType)}`);
  try {
    await writeFile(inputPath, mediaBytes);
    return await probeMediaDurationMsFromFile(inputPath, options);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeMediaDurationMsFromFile(
  mediaPath: string,
  options: { requireComplete?: boolean; maxQueueWaitMs?: number } = {},
): Promise<number | null> {
  const info = await stat(mediaPath);
  if (!info.size) return null;

  const requireComplete = options.requireComplete === true;

  const runInSlot = requireComplete
    ? (fn: () => Promise<number | null>) =>
        withMediaValidationSlot(fn, options.maxQueueWaitMs)
    : withFrameExtractionSlot;

  try {
    return await runInSlot(async () => {
      let stderr: string;
      try {
        stderr = await runFfmpeg(
          [
            "-hide_banner",
            ...(requireComplete ? ["-xerror"] : []),
            "-nostdin",
            "-i",
            mediaPath,
            ...(requireComplete
              ? ["-map", "0:V:0", "-map", "0:a?", "-f", "null", "-"]
              : ["-map", "0:v:0?", "-frames:v", "1", "-f", "null", "-"]),
          ],
          requireComplete ? COMPLETE_MEDIA_VALIDATION_TIMEOUT_MS : undefined,
        );
      } catch (error) {
        if (error instanceof FfmpegRunError) return null;
        throw error;
      }
      return parseDurationMs(stderr);
    });
  } catch (error) {
    if (error instanceof MediaValidationQueueTimeoutError) return null;
    throw error;
  }
}

async function withFrameExtractionSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFrameExtractions >= MAX_CONCURRENT_FRAME_EXTRACTIONS) {
    await new Promise<void>((resolve) => frameExtractionWaiters.push(resolve));
  }
  activeFrameExtractions += 1;
  try {
    return await fn();
  } finally {
    activeFrameExtractions = Math.max(0, activeFrameExtractions - 1);
    frameExtractionWaiters.shift()?.();
  }
}

class MediaValidationQueueTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for media validation capacity.");
    this.name = "MediaValidationQueueTimeoutError";
  }
}

async function withMediaValidationSlot<T>(
  fn: () => Promise<T>,
  maxQueueWaitMs = MEDIA_VALIDATION_QUEUE_TIMEOUT_MS,
): Promise<T> {
  let slotReserved = false;
  if (activeMediaValidations >= MAX_CONCURRENT_MEDIA_VALIDATIONS) {
    const acquired = await new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const waiter = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(true);
      };
      mediaValidationWaiters.push(waiter);
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = mediaValidationWaiters.indexOf(waiter);
        if (index >= 0) mediaValidationWaiters.splice(index, 1);
        resolve(false);
      }, maxQueueWaitMs);
    });
    if (!acquired) throw new MediaValidationQueueTimeoutError();
    slotReserved = true;
  }
  if (!slotReserved) activeMediaValidations += 1;
  try {
    return await fn();
  } finally {
    const waiter = mediaValidationWaiters.shift();
    if (waiter) {
      waiter();
    } else {
      activeMediaValidations = Math.max(0, activeMediaValidations - 1);
    }
  }
}

export async function extractJpegFrame({
  mediaBytes,
  mimeType,
  atMs,
}: {
  mediaBytes: Uint8Array;
  mimeType: string;
  atMs: number;
}): Promise<Uint8Array> {
  if (mediaBytes.byteLength === 0) {
    throw new VideoFrameExtractionError(
      "NO_VIDEO",
      "Recording media is empty.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "clips-frame-input-"));
  const inputPath = join(dir, `input.${mediaExtensionForMimeType(mimeType)}`);
  try {
    await writeFile(inputPath, mediaBytes);
    return await extractJpegFrameFromFile({ mediaPath: inputPath, atMs });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractJpegFrameFromFile({
  mediaPath,
  atMs,
}: {
  mediaPath: string;
  atMs: number;
}): Promise<Uint8Array> {
  const info = await stat(mediaPath);
  if (!info.size) {
    throw new VideoFrameExtractionError(
      "NO_VIDEO",
      "Recording media is empty.",
    );
  }

  return withFrameExtractionSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-frame-output-"));
    const outputPath = join(dir, "frame.jpg");
    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        String(Math.max(0, atMs) / 1000),
        "-i",
        mediaPath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "3",
        outputPath,
      ]).catch((err) => {
        throw mapFfmpegError(err);
      });

      let info;
      try {
        info = await stat(outputPath);
      } catch (err) {
        const code =
          err instanceof Error && "code" in err ? err.code : undefined;
        if (code !== "ENOENT") throw err;
        throw new VideoFrameExtractionError(
          "NO_VIDEO",
          "No frame was available at that timestamp.",
        );
      }
      if (info.size === 0) {
        throw new VideoFrameExtractionError(
          "NO_VIDEO",
          "No frame was available at that timestamp.",
        );
      }

      return new Uint8Array(await readFile(outputPath));
    } catch (err) {
      if (err instanceof VideoFrameExtractionError) throw err;
      throw mapFfmpegError(err);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
