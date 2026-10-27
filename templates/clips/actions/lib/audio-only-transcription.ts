import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseAudioChunkList,
  type AudioChunkListEntry,
} from "./audio-chunk-list.js";

const AUDIO_EXTRACTION_MIN_TIMEOUT_MS = 30_000;
const AUDIO_EXTRACTION_MAX_TIMEOUT_MS = 90_000;
const AUDIO_EXTRACTION_BASE_TIMEOUT_MS = 25_000;
const AUDIO_EXTRACTION_PER_50MB_MS = 10_000;
const SILENCE_MAX_VOLUME_DB = -60;
export const TRANSCRIPTION_CHUNK_SECONDS = 15 * 60;
const STDERR_LIMIT = 16 * 1024;
const requireFromThisFile = createRequire(import.meta.url);
let cachedFfmpegStaticPath: string | null | undefined;

export type AudioOnlyExtractionErrorCode =
  | "NO_AUDIO_SAVED"
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

export interface AudioChunk {
  audioBytes: Uint8Array;
  startMs: number;
  durationMs: number;
}

export interface AudioOnlyTranscriptionMedia {
  mimeType: string;
  maxVolumeDb: number | null;
  chunks: AudioChunk[];
}

// A `url` source is handed to ffmpeg as-is, so only pass URLs the server
// already trusts; untrusted URLs must be downloaded via ssrfSafeFetch first.
export type AudioExtractionSource =
  | { kind: "url"; url: string }
  | { kind: "file"; path: string };

export interface AudioExtractionInput {
  source: AudioExtractionSource;
  timeoutMs: number;
}

export type AudioExtractor = (
  input: AudioExtractionInput,
) => Promise<AudioOnlyTranscriptionMedia>;

class FfmpegRunError extends Error {
  stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "FfmpegRunError";
    this.stderr = stderr;
  }
}

export function isNoExtractableAudioError(err: unknown): boolean {
  return (
    err instanceof AudioOnlyExtractionError &&
    (err.code === "NO_AUDIO_SAVED" ||
      err.code === "NO_AUDIO_TRACK" ||
      err.code === "NO_SPEECH_DETECTED")
  );
}

export function isTransientExtractionError(err: unknown): boolean {
  return err instanceof AudioOnlyExtractionError && err.code === "TIMEOUT";
}

function clampAudioExtractionTimeoutMs(value: number): number {
  return Math.max(
    AUDIO_EXTRACTION_MIN_TIMEOUT_MS,
    Math.min(AUDIO_EXTRACTION_MAX_TIMEOUT_MS, Math.floor(value)),
  );
}

export function audioExtractionTimeoutMs(
  mediaByteLength: number | null | undefined,
): number {
  const override = Number(process.env.CLIPS_AUDIO_EXTRACTION_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) {
    return clampAudioExtractionTimeoutMs(override);
  }

  if (
    typeof mediaByteLength !== "number" ||
    !Number.isFinite(mediaByteLength) ||
    mediaByteLength <= 0
  ) {
    return AUDIO_EXTRACTION_MIN_TIMEOUT_MS;
  }

  const fiftyMbUnits = Math.ceil(mediaByteLength / (50 * 1024 * 1024));
  return clampAudioExtractionTimeoutMs(
    AUDIO_EXTRACTION_BASE_TIMEOUT_MS +
      fiftyMbUnits * AUDIO_EXTRACTION_PER_50MB_MS,
  );
}

// Always re-encode. Copying the source track keeps its bitrate, and an hour of
// copied audio (~60-140 MB) exceeds the transcription gateway's request size
// limit; mono 16 kHz 48 kbps is ~22 MB per hour.
const TRANSCRIPTION_AUDIO = {
  mimeType: "audio/mp4",
  extension: "m4a",
  args: [
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

// Recording bytes are user-supplied. Playlist and concat formats would let a
// crafted file make ffmpeg open other local files or arbitrary URLs.
const INPUT_FORMAT_ALLOWLIST = ["-format_whitelist", "mov,matroska,wav"];

function ffmpegInputArgs(source: AudioExtractionSource): string[] {
  if (source.kind === "file") {
    return [
      ...INPUT_FORMAT_ALLOWLIST,
      "-protocol_whitelist",
      "file",
      "-i",
      source.path,
    ];
  }
  const protocols =
    new URL(source.url).protocol === "https:" ? "https,tls,tcp" : "http,tcp";
  return [
    ...INPUT_FORMAT_ALLOWLIST,
    "-protocol_whitelist",
    protocols,
    "-reconnect",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "5",
    "-rw_timeout",
    "30000000",
    "-i",
    source.url,
  ];
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

async function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
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
        resolve();
        return;
      }
      reject(new FfmpegRunError(`ffmpeg exited with code ${code}`, stderr));
    });
  });
}

async function runFfmpegForStderr(
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
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

function parseMaxVolumeDb(stderr: string): number | null {
  const match = stderr.match(/max_volume:\s*(-?inf|-?\d+(?:\.\d+)?) dB/i);
  if (!match) return null;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

async function detectMaxVolumeDb(
  audioPath: string,
  timeoutMs: number,
): Promise<number | null> {
  const stderr = await runFfmpegForStderr(
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      audioPath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    timeoutMs,
  );
  return parseMaxVolumeDb(stderr);
}

export function assertAudioHasAudibleSignal({
  maxVolumeDb,
}: AudioOnlyTranscriptionMedia): void {
  if (maxVolumeDb === null || maxVolumeDb <= SILENCE_MAX_VOLUME_DB) {
    throw new AudioOnlyExtractionError(
      "NO_SPEECH_DETECTED",
      "No speech was detected because the recording audio is silent.",
    );
  }
}

function readChunkList(csv: string): AudioChunkListEntry[] {
  let entries: AudioChunkListEntry[];
  try {
    entries = parseAudioChunkList(csv);
  } catch (err) {
    throw new AudioOnlyExtractionError(
      "EXTRACTION_FAILED",
      `Splitting the audio for transcription failed: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  if (entries.length === 0) {
    throw new AudioOnlyExtractionError(
      "EXTRACTION_FAILED",
      "Splitting the audio for transcription produced no chunks.",
    );
  }
  return entries;
}

// Copy-only split of the already re-encoded audio. ffmpeg cuts on packet
// boundaries, so chunk lengths come from the segment list, not the target.
async function splitAudioIntoChunks(
  audioPath: string,
  dir: string,
): Promise<AudioChunk[]> {
  const listPath = join(dir, "chunks.csv");
  await runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      audioPath,
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-f",
      "segment",
      "-segment_time",
      String(TRANSCRIPTION_CHUNK_SECONDS),
      "-segment_format",
      "mp4",
      "-reset_timestamps",
      "1",
      "-segment_list",
      listPath,
      "-segment_list_type",
      "csv",
      join(dir, `chunk-%04d.${TRANSCRIPTION_AUDIO.extension}`),
    ],
    AUDIO_EXTRACTION_MIN_TIMEOUT_MS,
  );

  const entries = readChunkList(await readFile(listPath, "utf8"));
  return Promise.all(
    entries.map(async (entry) => ({
      audioBytes: new Uint8Array(await readFile(join(dir, entry.file))),
      startMs: entry.startMs,
      durationMs: entry.durationMs,
    })),
  );
}

export async function extractAudioOnlyWithFfmpeg({
  source,
  timeoutMs,
}: AudioExtractionInput): Promise<AudioOnlyTranscriptionMedia> {
  const dir = await mkdtemp(join(tmpdir(), "clips-transcription-"));
  const outputPath = join(dir, `audio.${TRANSCRIPTION_AUDIO.extension}`);

  try {
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        ...ffmpegInputArgs(source),
        ...TRANSCRIPTION_AUDIO.args,
        outputPath,
      ],
      timeoutMs,
    );

    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) {
      throw new AudioOnlyExtractionError(
        "NO_AUDIO_TRACK",
        "No speech was detected because this recording has no audio track.",
      );
    }

    return {
      mimeType: TRANSCRIPTION_AUDIO.mimeType,
      maxVolumeDb: await detectMaxVolumeDb(
        outputPath,
        audioExtractionTimeoutMs(info.size),
      ),
      chunks: await splitAudioIntoChunks(outputPath, dir),
    };
  } catch (err) {
    if (err instanceof AudioOnlyExtractionError) throw err;
    throw mapFfmpegError(err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
