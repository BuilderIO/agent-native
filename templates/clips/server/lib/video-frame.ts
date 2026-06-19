import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FRAME_EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_FRAME_EXTRACTIONS = 2;
const STDERR_LIMIT = 16 * 1024;
const requireFromThisFile = createRequire(import.meta.url);
let cachedFfmpegStaticPath: string | null | undefined;
let activeFrameExtractions = 0;
const frameExtractionWaiters: Array<() => void> = [];

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

function ffmpegCommand(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return resolveFfmpegStaticPath() ?? "ffmpeg";
}

function resolveFfmpegStaticPath(): string | null {
  if (cachedFfmpegStaticPath !== undefined) {
    return cachedFfmpegStaticPath;
  }

  try {
    const resolved = requireFromThisFile("ffmpeg-static");
    cachedFfmpegStaticPath =
      typeof resolved === "string" && resolved && existsSync(resolved)
        ? resolved
        : null;
  } catch {
    cachedFfmpegStaticPath = null;
  }

  return cachedFfmpegStaticPath;
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

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegRunError("ffmpeg timed out", stderr));
    }, FRAME_EXTRACTION_TIMEOUT_MS);

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
        resolve();
        return;
      }
      reject(new FfmpegRunError(`ffmpeg exited with code ${code}`, stderr));
    });
  });
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

  const dir = await mkdtemp(join(tmpdir(), "clips-frame-"));
  const inputPath = join(dir, `input.${mediaExtensionForMimeType(mimeType)}`);
  const outputPath = join(dir, "frame.jpg");
  const seconds = Math.max(0, Math.round(atMs) / 1000);

  try {
    await writeFile(inputPath, mediaBytes);
    await withFrameExtractionSlot(async () => {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        String(seconds),
        "-i",
        inputPath,
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
    });

    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) {
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
}
