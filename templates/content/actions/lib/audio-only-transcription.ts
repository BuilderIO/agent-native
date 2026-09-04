import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUDIO_EXTRACTION_TIMEOUT_MS = 30_000;
const SILENCE_MAX_VOLUME_DB = -60;
const STDERR_LIMIT = 16 * 1024;
const requireFromThisFile = createRequire(import.meta.url);
let cachedFfmpegStaticPath: string | null | undefined;

export type AudioOnlyExtractionErrorCode =
  | "NO_AUDIO_TRACK"
  | "NO_SPEECH_DETECTED"
  | "FFMPEG_UNAVAILABLE"
  | "EXTRACTION_FAILED";

export class AudioOnlyExtractionError extends Error {
  code: AudioOnlyExtractionErrorCode;

  constructor(code: AudioOnlyExtractionErrorCode, message: string) {
    super(message);
    this.name = "AudioOnlyExtractionError";
    this.code = code;
  }
}

export interface AudioOnlyTranscriptionMedia {
  audioBytes: Uint8Array;
  mimeType: string;
  filename: string;
  source: "audio-input" | "extracted-audio";
}

interface AudioExtractionInput {
  mediaBytes: Uint8Array;
  mimeType: string;
}

interface AudioExtractionOutput {
  audioBytes: Uint8Array;
  mimeType: string;
  extension: string;
}

type AudioExtractor = (
  input: AudioExtractionInput,
) => Promise<AudioExtractionOutput>;

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

export function isAudioMimeType(mimeType: string | null | undefined): boolean {
  return baseMimeType(mimeType).startsWith("audio/");
}

export function audioExtensionForMimeType(
  mimeType: string | null | undefined,
): string {
  switch (baseMimeType(mimeType)) {
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
    default:
      return "webm";
  }
}

function mediaExtensionForMimeType(mimeType: string): string {
  switch (baseMimeType(mimeType)) {
    case "video/mp4":
    case "video/quicktime":
    case "audio/mp4":
      return "mp4";
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "video/webm":
    case "audio/webm":
      return "webm";
    default:
      return "bin";
  }
}

function outputForSourceMimeType(mimeType: string): {
  mimeType: string;
  extension: string;
  copyArgs: string[];
  transcodeArgs: string[];
} {
  const base = baseMimeType(mimeType);
  if (base.includes("mp4") || base === "video/quicktime") {
    return {
      mimeType: "audio/mp4",
      extension: "m4a",
      copyArgs: ["-map", "0:a:0", "-vn", "-c:a", "copy", "-f", "mp4"],
      transcodeArgs: [
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        "-c:a",
        "aac",
        "-f",
        "mp4",
      ],
    };
  }

  return {
    mimeType: "audio/webm",
    extension: "webm",
    copyArgs: ["-map", "0:a:0", "-vn", "-c:a", "copy", "-f", "webm"],
    transcodeArgs: [
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      "-c:a",
      "libopus",
      "-f",
      "webm",
    ],
  };
}

function resolveFfmpegStaticPath(): string | null {
  if (cachedFfmpegStaticPath !== undefined) return cachedFfmpegStaticPath;

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

function ffmpegCommand(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return resolveFfmpegStaticPath() ?? "ffmpeg";
}

function isMissingAudioTrack(stderr: string): boolean {
  return /matches no streams|does not contain any stream|output file #0 does not contain any stream|audio: none/i.test(
    stderr,
  );
}

function mapFfmpegError(err: unknown): AudioOnlyExtractionError {
  const message = err instanceof Error ? err.message : String(err);
  const stderr = err instanceof FfmpegRunError ? err.stderr : "";
  if (/enoent|not found|eacces|enoexec/i.test(message)) {
    return new AudioOnlyExtractionError(
      "FFMPEG_UNAVAILABLE",
      "Audio transcription requires ffmpeg to extract the media's audio track.",
    );
  }
  if (isMissingAudioTrack(stderr)) {
    return new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because this media has no audio track.",
    );
  }
  return new AudioOnlyExtractionError(
    "EXTRACTION_FAILED",
    `Failed to extract audio-only media for transcription: ${message}`,
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
    }, AUDIO_EXTRACTION_TIMEOUT_MS);

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

async function runFfmpegForStderr(args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegRunError("ffmpeg timed out", stderr));
    }, AUDIO_EXTRACTION_TIMEOUT_MS);

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

function parseVolumeDb(stderr: string, field: "mean" | "max"): number | null {
  const match = stderr.match(
    new RegExp(`${field}_volume:\\s*(-?inf|-?\\d+(?:\\.\\d+)?) dB`, "i"),
  );
  if (!match) return null;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

export async function assertAudioHasAudibleSignal(
  media: AudioOnlyTranscriptionMedia,
): Promise<void> {
  if (media.audioBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the media is empty.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "content-transcription-"));
  const inputPath = join(
    dir,
    `input.${audioExtensionForMimeType(media.mimeType)}`,
  );

  try {
    await writeFile(inputPath, media.audioBytes);
    const stderr = await runFfmpegForStderr([
      "-hide_banner",
      "-nostdin",
      "-i",
      inputPath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]).catch((err) => {
      throw mapFfmpegError(err);
    });
    const maxVolumeDb = parseVolumeDb(stderr, "max");
    if (maxVolumeDb === null || maxVolumeDb <= SILENCE_MAX_VOLUME_DB) {
      throw new AudioOnlyExtractionError(
        "NO_SPEECH_DETECTED",
        "No speech was detected because the media audio is silent.",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractAudioOnlyWithFfmpeg({
  mediaBytes,
  mimeType,
}: AudioExtractionInput): Promise<AudioExtractionOutput> {
  if (mediaBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the media is empty.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "content-transcription-"));
  const inputPath = join(dir, `input.${mediaExtensionForMimeType(mimeType)}`);
  const output = outputForSourceMimeType(mimeType);
  const outputPath = join(dir, `audio.${output.extension}`);
  const baseArgs = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];

  try {
    await writeFile(inputPath, mediaBytes);
    try {
      await runFfmpeg([
        ...baseArgs,
        "-i",
        inputPath,
        ...output.copyArgs,
        outputPath,
      ]);
    } catch (copyErr) {
      if (
        copyErr instanceof FfmpegRunError &&
        isMissingAudioTrack(copyErr.stderr)
      ) {
        throw copyErr;
      }
      await runFfmpeg([
        ...baseArgs,
        "-i",
        inputPath,
        ...output.transcodeArgs,
        outputPath,
      ]).catch((transcodeErr) => {
        throw mapFfmpegError(transcodeErr);
      });
    }

    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) {
      throw new AudioOnlyExtractionError(
        "NO_AUDIO_TRACK",
        "No speech was detected because this media has no audio track.",
      );
    }

    return {
      audioBytes: new Uint8Array(await readFile(outputPath)),
      mimeType: output.mimeType,
      extension: output.extension,
    };
  } catch (err) {
    if (err instanceof AudioOnlyExtractionError) throw err;
    throw mapFfmpegError(err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function prepareAudioOnlyTranscriptionMedia({
  blob,
  mediaId,
  sourceMimeType,
  extractor = extractAudioOnlyWithFfmpeg,
}: {
  blob: Blob;
  mediaId: string;
  sourceMimeType?: string | null;
  extractor?: AudioExtractor;
}): Promise<AudioOnlyTranscriptionMedia> {
  const mimeType =
    baseMimeType(sourceMimeType) || baseMimeType(blob.type) || "audio/webm";
  const mediaBytes = new Uint8Array(await blob.arrayBuffer());

  if (mediaBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the media is empty.",
    );
  }

  if (isAudioMimeType(mimeType)) {
    return {
      audioBytes: mediaBytes,
      mimeType,
      filename: `${mediaId}.${audioExtensionForMimeType(mimeType)}`,
      source: "audio-input",
    };
  }

  const extracted = await extractor({
    mediaBytes,
    mimeType,
  });
  return {
    audioBytes: extracted.audioBytes,
    mimeType: extracted.mimeType,
    filename: `${mediaId}.${extracted.extension}`,
    source: "extracted-audio",
  };
}
