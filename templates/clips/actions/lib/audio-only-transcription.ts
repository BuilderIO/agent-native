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
  | "EXTRACTION_FAILED"
  | "TIMEOUT";

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
  source: "audio-input" | "extracted-audio" | "raw-media-fallback";
}

export interface AudioExtractionInput {
  mediaBytes: Uint8Array;
  mimeType: string;
  recordingId: string;
}

export interface AudioExtractionOutput {
  audioBytes: Uint8Array;
  mimeType: string;
  extension: string;
}

export type AudioExtractor = (
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

export function isNoExtractableAudioError(err: unknown): boolean {
  return (
    err instanceof AudioOnlyExtractionError &&
    (err.code === "NO_AUDIO_TRACK" || err.code === "NO_SPEECH_DETECTED")
  );
}

export function isFfmpegUnavailableError(err: unknown): boolean {
  return (
    err instanceof AudioOnlyExtractionError && err.code === "FFMPEG_UNAVAILABLE"
  );
}

/**
 * True for extraction failures that are worth an automatic retry — an
 * ffmpeg timeout is almost always transient (system under load, a slow
 * disk/network read of the source media), unlike a permanently unusable
 * input (no audio track, silent audio, ffmpeg missing from the runtime).
 */
export function isTransientExtractionError(err: unknown): boolean {
  return err instanceof AudioOnlyExtractionError && err.code === "TIMEOUT";
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
      "Audio-only transcription requires ffmpeg to extract the recording's audio track.",
    );
  }
  if (isMissingAudioTrack(stderr)) {
    return new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because this recording has no audio track.",
    );
  }
  if (/ffmpeg timed out/i.test(message)) {
    return new AudioOnlyExtractionError(
      "TIMEOUT",
      "ffmpeg timed out extracting audio for transcription.",
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

export async function analyzeAudioSignal({
  audioBytes,
  mimeType,
}: AudioOnlyTranscriptionMedia): Promise<{
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
}> {
  if (audioBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the recording media is empty.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "clips-transcription-"));
  const inputPath = join(dir, `input.${audioExtensionForMimeType(mimeType)}`);

  try {
    await writeFile(inputPath, audioBytes);
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

    return {
      meanVolumeDb: parseVolumeDb(stderr, "mean"),
      maxVolumeDb: parseVolumeDb(stderr, "max"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function assertAudioHasAudibleSignal(
  media: AudioOnlyTranscriptionMedia,
): Promise<void> {
  let signal: { meanVolumeDb: number | null; maxVolumeDb: number | null };
  try {
    signal = await analyzeAudioSignal(media);
  } catch (err) {
    // The silence pre-check is a best-effort guard, not a hard requirement.
    // When ffmpeg is unavailable (e.g. a serverless runtime without the
    // bundled binary) skip it and let the transcription provider decide,
    // rather than failing the whole request before it starts.
    if (isFfmpegUnavailableError(err)) {
      console.warn(
        "[clips] ffmpeg unavailable; skipping silence detection and proceeding to transcription.",
      );
      return;
    }
    throw err;
  }
  const maxVolumeDb = signal.maxVolumeDb;
  if (maxVolumeDb === null || maxVolumeDb <= SILENCE_MAX_VOLUME_DB) {
    throw new AudioOnlyExtractionError(
      "NO_SPEECH_DETECTED",
      "No speech was detected because the recording audio is silent.",
    );
  }
}

export async function extractAudioOnlyWithFfmpeg({
  mediaBytes,
  mimeType,
}: AudioExtractionInput): Promise<AudioExtractionOutput> {
  if (mediaBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the recording media is empty.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "clips-transcription-"));
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
        "No speech was detected because this recording has no audio track.",
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
  recordingId,
  sourceMimeType,
  extractor = extractAudioOnlyWithFfmpeg,
}: {
  blob: Blob;
  recordingId: string;
  sourceMimeType?: string | null;
  extractor?: AudioExtractor;
}): Promise<AudioOnlyTranscriptionMedia> {
  const mimeType =
    baseMimeType(sourceMimeType) || baseMimeType(blob.type) || "audio/webm";
  const mediaBytes = new Uint8Array(await blob.arrayBuffer());

  if (mediaBytes.byteLength === 0) {
    throw new AudioOnlyExtractionError(
      "NO_AUDIO_TRACK",
      "No speech was detected because the recording media is empty.",
    );
  }

  if (isAudioMimeType(mimeType)) {
    return {
      audioBytes: mediaBytes,
      mimeType,
      filename: `${recordingId}.${audioExtensionForMimeType(mimeType)}`,
      source: "audio-input",
    };
  }

  let extracted: AudioExtractionOutput;
  try {
    extracted = await extractor({
      mediaBytes,
      mimeType,
      recordingId,
    });
  } catch (err) {
    // No ffmpeg to strip the audio track. Rather than fail outright, hand the
    // original media to the transcription provider — Gemini/Builder accepts
    // video containers directly. (Whisper-style providers may reject it, in
    // which case the normal provider error path takes over.)
    if (isFfmpegUnavailableError(err)) {
      console.warn(
        "[clips] ffmpeg unavailable; sending original media to the transcription provider without audio extraction.",
      );
      return {
        audioBytes: mediaBytes,
        mimeType,
        filename: `${recordingId}.${mediaExtensionForMimeType(mimeType)}`,
        source: "raw-media-fallback",
      };
    }
    throw err;
  }
  return {
    audioBytes: extracted.audioBytes,
    mimeType: extracted.mimeType,
    filename: `${recordingId}.${extracted.extension}`,
    source: "extracted-audio",
  };
}
