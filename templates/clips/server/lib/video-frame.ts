import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RemoteFrameInput } from "./agent-frame-range.js";
import {
  IMAGE_EXTENSION_BY_MIME,
  isSupportedImageMimeType,
} from "./image-signature.js";
import { RecordingMediaFetchError } from "./recording-media-fetch-error.js";
import {
  frameSheetFfmpegArgs,
  frameSheetFpsFromProbe,
  type FrameSheetPlan,
} from "./video-frame-sheet.js";
import { resolveFfmpegCommand } from "./video-remux.js";

const FRAME_EXTRACTION_TIMEOUT_MS = 20_000;
// A sheet decodes up to a minute of video in one pass.
const FRAME_SHEET_TIMEOUT_MS = 45_000;
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
  | "NO_VIDEO_TRACK"
  | "EMPTY_MEDIA"
  | "NO_FRAME_AT_TIMESTAMP"
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

function mapFfmpegError(
  err: unknown,
): VideoFrameExtractionError | RecordingMediaFetchError {
  if (err instanceof RecordingMediaFetchError) return err;
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
      "NO_VIDEO_TRACK",
      "This recording does not contain a video track.",
    );
  }
  return new VideoFrameExtractionError(
    "EXTRACTION_FAILED",
    `Failed to extract video frame: ${message}`,
  );
}

function remoteInputArgs(remote?: RemoteFrameInput): string[] {
  return remote
    ? [
        "-protocol_whitelist",
        "http,tcp",
        "-f",
        remote.format,
        ...(remote.format === "mov" ? ["-enable_drefs", "0"] : []),
      ]
    : [];
}

async function runFfmpeg(
  args: string[],
  timeoutMs = FRAME_EXTRACTION_TIMEOUT_MS,
  remote?: RemoteFrameInput,
): Promise<string> {
  try {
    const allowedMs = remote
      ? Math.min(timeoutMs, remote.remainingMs())
      : timeoutMs;
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(resolveFfmpegCommand(), args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, allowedMs);

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new FfmpegRunError(err.message, stderr));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new FfmpegRunError("ffmpeg timed out", stderr));
          return;
        }
        if (code === 0) {
          resolve(stderr);
          return;
        }
        reject(new FfmpegRunError(`ffmpeg exited with code ${code}`, stderr));
      });
    });
  } finally {
    await remote?.assertHealthy();
  }
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
  options: {
    requireComplete?: boolean;
    maxQueueWaitMs?: number;
    remote?: RemoteFrameInput;
  } = {},
): Promise<number | null> {
  if (!options.remote) {
    const info = await stat(mediaPath);
    if (!info.size) return null;
  }

  const requireComplete = options.requireComplete === true;

  const runInSlot = requireComplete
    ? (fn: () => Promise<number | null>) =>
        withMediaValidationSlot(fn, options.maxQueueWaitMs)
    : (fn: () => Promise<number | null>) =>
        withFrameExtractionSlot(fn, options.remote);

  try {
    return await runInSlot(async () => {
      let stderr: string;
      try {
        stderr = await runFfmpeg(
          [
            "-hide_banner",
            ...(requireComplete ? ["-xerror"] : []),
            "-nostdin",
            ...remoteInputArgs(options.remote),
            "-i",
            mediaPath,
            ...(requireComplete
              ? ["-map", "0:V:0", "-map", "0:a?", "-f", "null", "-"]
              : ["-map", "0:v:0?", "-frames:v", "1", "-f", "null", "-"]),
          ],
          requireComplete ? COMPLETE_MEDIA_VALIDATION_TIMEOUT_MS : undefined,
          options.remote,
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

async function withFrameExtractionSlot<T>(
  fn: () => Promise<T>,
  remote?: RemoteFrameInput,
): Promise<T> {
  if (activeFrameExtractions >= MAX_CONCURRENT_FRAME_EXTRACTIONS) {
    const waitMs = remote?.remainingMs();
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      frameExtractionWaiters.push(waiter);
      if (remote)
        timer = setTimeout(() => {
          const index = frameExtractionWaiters.indexOf(waiter);
          if (index >= 0) frameExtractionWaiters.splice(index, 1);
          reject(
            new RecordingMediaFetchError(
              "Recording range deadline exceeded.",
              504,
            ),
          );
        }, waitMs);
    });
  }
  remote?.remainingMs();
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
      "EMPTY_MEDIA",
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

/**
 * A still image as a JPEG at the frame size cap, for a screenshot that is
 * another type or too large to hand to an agent as it is.
 */
export async function convertImageToJpeg({
  imageBytes,
  mimeType,
}: {
  imageBytes: Uint8Array;
  mimeType: string;
}): Promise<Uint8Array> {
  // observed-write-ok: temp file, removed below
  const dir = await mkdtemp(join(tmpdir(), "clips-image-input-"));
  const inputPath = join(
    dir,
    `input${isSupportedImageMimeType(mimeType) ? IMAGE_EXTENSION_BY_MIME[mimeType] : ".img"}`,
  );
  try {
    // observed-write-ok: temp file, removed below
    await writeFile(inputPath, imageBytes);
    return await extractJpegFrameFromFile({ mediaPath: inputPath, atMs: 0 });
  } finally {
    // observed-write-ok: removes this call's temp directory
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractJpegFrameFromFile({
  mediaPath,
  atMs,
  remote,
}: {
  mediaPath: string;
  atMs: number;
  remote?: RemoteFrameInput;
}): Promise<Uint8Array> {
  const info = remote ? null : await stat(mediaPath);
  if (info && !info.size) {
    throw new VideoFrameExtractionError(
      "EMPTY_MEDIA",
      "Recording media is empty.",
    );
  }

  return withFrameExtractionSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-frame-output-"));
    const outputPath = join(dir, "frame.jpg");
    try {
      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          // ffmpeg starts at the first frame at or after -ss. Comment times are
          // a frame start rounded up to a whole millisecond, so begin 1 ms
          // early to keep a sub-millisecond start (30 fps MP4) on that frame.
          "-ss",
          String(Math.max(0, atMs - 1) / 1000),
          ...remoteInputArgs(remote),
          "-i",
          mediaPath,
          "-frames:v",
          "1",
          "-vf",
          "scale='min(1280,iw)':-2",
          "-q:v",
          "3",
          outputPath,
        ],
        undefined,
        remote,
      ).catch((err) => {
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
          "NO_FRAME_AT_TIMESTAMP",
          "No frame was available at that timestamp.",
        );
      }
      if (info.size === 0) {
        throw new VideoFrameExtractionError(
          "NO_FRAME_AT_TIMESTAMP",
          "No frame was available at that timestamp.",
        );
      }

      return new Uint8Array(await readFile(outputPath));
    } catch (err) {
      if (
        err instanceof VideoFrameExtractionError ||
        err instanceof RecordingMediaFetchError
      )
        throw err;
      throw mapFfmpegError(err);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, remote);
}

/** The frame rate a frame sheet uses when its request leaves fps out. */
export async function probeFrameSheetFpsFromFile(
  mediaPath: string,
  remote?: RemoteFrameInput,
): Promise<number> {
  return withFrameExtractionSlot(async () => {
    const stderr = await runFfmpeg(
      [
        "-hide_banner",
        "-nostdin",
        ...remoteInputArgs(remote),
        "-i",
        mediaPath,
        "-map",
        "0:v:0?",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ],
      undefined,
      remote,
    ).catch((err) => {
      throw mapFfmpegError(err);
    });
    return frameSheetFpsFromProbe(stderr);
  }, remote);
}

export async function extractJpegFrameSheetFromFile({
  mediaPath,
  plan,
  remote,
}: {
  mediaPath: string;
  plan: FrameSheetPlan;
  remote?: RemoteFrameInput;
}): Promise<Uint8Array> {
  const info = remote ? null : await stat(mediaPath);
  if (info && !info.size) {
    throw new VideoFrameExtractionError(
      "EMPTY_MEDIA",
      "Recording media is empty.",
    );
  }

  const { inputArgs, filter } = frameSheetFfmpegArgs(plan);
  return withFrameExtractionSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-frame-sheet-output-"));
    const outputPath = join(dir, "sheet.jpg");
    try {
      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          ...inputArgs,
          ...remoteInputArgs(remote),
          "-i",
          mediaPath,
          "-an",
          "-sn",
          "-vf",
          filter,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          outputPath,
        ],
        FRAME_SHEET_TIMEOUT_MS,
        remote,
      ).catch((err) => {
        throw mapFfmpegError(err);
      });

      let output;
      try {
        output = await stat(outputPath);
      } catch (err) {
        const code =
          err instanceof Error && "code" in err ? err.code : undefined;
        if (code !== "ENOENT") throw err;
        output = null;
      }
      if (!output?.size) {
        throw new VideoFrameExtractionError(
          "NO_FRAME_AT_TIMESTAMP",
          "No frames were available in that range.",
        );
      }

      return new Uint8Array(await readFile(outputPath));
    } catch (err) {
      if (
        err instanceof VideoFrameExtractionError ||
        err instanceof RecordingMediaFetchError
      )
        throw err;
      throw mapFfmpegError(err);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, remote);
}
