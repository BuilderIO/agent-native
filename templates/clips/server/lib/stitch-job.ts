/**
 * "Stitch clips" used to run in the browser with ffmpeg.wasm: it downloaded
 * every source, re-encoded them single-threaded and uploaded the result, so a
 * long stitch sat at 0% for many minutes and died when the tab closed. Now
 * `stitch-recordings` creates the new recording as `processing`, stores a
 * `clips_stitch_jobs` row and dispatches the post-finalize worker (a durable
 * background function on serverless hosts). The worker claims the row with a
 * lease (server/lib/stitch-job-store.ts) and runs this job:
 *
 *  1. re-checks the caller owns every source,
 *  2. streams each source video to a temp dir, within per-source and total
 *     byte, stall and time limits,
 *  3. ffprobes them; when every stream matches it concatenates with the concat
 *     demuxer and `-c copy`, otherwise it re-encodes (libx264 veryfast, aac,
 *     scale/pad to the largest size, `-threads 4`), keeping each source's
 *     audio offset against its video,
 *  4. uploads the mp4 in parts through the destination recording's storage
 *     provider, each part with a timeout,
 *  5. marks the recording ready the way finalize does, or failed with a reason.
 *
 * A worker that dies leaves its lease to run out; the recovery sweep
 * (recoverStitchJobs) dispatches the job again, up to STITCH_MAX_ATTEMPTS.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { writeAppState } from "@agent-native/core/application-state";
import type {
  FileUploadProvider,
  FileUploadResult,
  ResumableUploadSession,
} from "@agent-native/core/file-upload";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { markRecordingSeekable } from "../../actions/lib/ensure-seekable-video.js";
import { assertNativeRecordingMedia } from "../../actions/lib/native-media.js";
import {
  formatUploadBytes,
  MAX_UPLOAD_BYTES,
} from "../../shared/upload-limits.js";
import { getDb, schema } from "../db/index.js";
import { dispatchPostFinalizeJob } from "./post-finalize-dispatch.js";
import {
  fetchRecordingMediaResponse,
  loadRecordingMediaBytes,
  type PublicAgentRecording,
} from "./public-agent-context.js";
import { deleteStoredMediaUrl } from "./recording-media-cleanup.js";
import { withRecordingMediaProduction } from "./recording-media-lifecycle.js";
import { ownerEmailMatches } from "./recordings.js";
import { isS3ObjectUrlBoundToRecording } from "./s3-upload-provider.js";
import {
  claimStitchJob,
  planStitchRecovery,
  pruneSettledStitchJobs,
  renewStitchLease,
  settleStitchJob,
  STITCH_LEASE_RENEW_MS,
  STITCH_MAX_ATTEMPTS,
  stitchJobSourceIds,
  type StitchClaim,
} from "./stitch-job-store.js";
import {
  isFfmpegAvailable,
  resolveFfmpegCommand,
  runFfmpegWithProgress,
} from "./video-remux.js";
import { resolveClipsVideoStorage } from "./video-storage.js";

/** Most recordings one stitch accepts; each one is downloaded and probed. */
export const MAX_STITCH_SOURCES = 20;
export const STITCH_FAILURE_CODE = "stitch_failed";
/** Encoder threads: the host is shared with other apps. */
export const STITCH_ENCODE_THREADS = 4;
const PROBE_TIMEOUT_MS = 60_000;
const MIN_FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_FFMPEG_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** Copy concat may drift a little per source (keyframe-aligned ends). */
const COPY_DURATION_TOLERANCE_MS_PER_SOURCE = 1_500;

/** Parts of the stitched file sent to the storage provider's multipart upload. */
const STITCH_UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/** `bytes a-b/total` on the last part, `bytes a-b/*` before it. */
function stitchPartContentRange(
  start: number,
  length: number,
  total: number,
): string {
  const end = start + length - 1;
  return start + length >= total
    ? `bytes ${start}-${end}/${total}`
    : `bytes ${start}-${end}/*`;
}

type RecordingRow = typeof schema.recordings.$inferSelect;

// ---------------------------------------------------------------------------
// Probe + plan (pure, unit tested)
// ---------------------------------------------------------------------------

function firstOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[0] : undefined;
}

export interface StitchVideoStream {
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  pixFmt: string | null;
  /** The stream's `start_time`; null when ffprobe does not report one. */
  startMs?: number | null;
}

export interface StitchAudioStream {
  codec: string;
  sampleRate: number;
  channels: number;
  /** The stream's `start_time`; null when ffprobe does not report one. */
  startMs?: number | null;
}

export interface StitchSourceProbe {
  /** ffprobe `format_name`, e.g. "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
  formatName: string;
  durationMs: number | null;
  video: StitchVideoStream | null;
  audio: StitchAudioStream | null;
}

export type StitchAudioMode = "none" | "all" | "some";

export type StitchPlan =
  | {
      mode: "copy";
      width: number;
      height: number;
      hasAudio: boolean;
      reason: string;
    }
  | {
      mode: "reencode";
      width: number;
      height: number;
      audio: StitchAudioMode;
      reason: string;
    };

const COPYABLE_VIDEO_CODECS = new Set(["h264", "hevc"]);
const COPYABLE_AUDIO_CODECS = new Set(["aac"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function startMsOf(stream: Record<string, unknown> | undefined): number | null {
  // ffprobe prints "N/A" when a stream has no start time.
  const seconds = num(stream?.start_time);
  return seconds === null ? null : Math.round(seconds * 1000);
}

/** Parses `ffprobe -print_format json -show_format -show_streams` output. */
export function parseFfprobeOutput(raw: unknown): StitchSourceProbe {
  const root = asRecord(raw) ?? {};
  const format = asRecord(root.format) ?? {};
  const streams = Array.isArray(root.streams)
    ? root.streams
        .map(asRecord)
        .filter((s): s is Record<string, unknown> => !!s)
    : [];

  const videoStream = streams.find(
    (s) =>
      s.codec_type === "video" &&
      // Cover art / attached pictures are not the video track.
      asRecord(s.disposition)?.attached_pic !== 1,
  );
  const audioStream = streams.find((s) => s.codec_type === "audio");

  const width = num(videoStream?.width);
  const height = num(videoStream?.height);
  const video: StitchVideoStream | null =
    videoStream && width && height && width > 0 && height > 0
      ? {
          codec: str(videoStream.codec_name) ?? "unknown",
          profile: str(videoStream.profile),
          width,
          height,
          pixFmt: str(videoStream.pix_fmt),
          startMs: startMsOf(videoStream),
        }
      : null;

  const audio: StitchAudioStream | null = audioStream
    ? {
        codec: str(audioStream.codec_name) ?? "unknown",
        sampleRate: num(audioStream.sample_rate) ?? 0,
        channels: num(audioStream.channels) ?? 0,
        startMs: startMsOf(audioStream),
      }
    : null;

  const durationSeconds =
    num(format.duration) ??
    num(videoStream?.duration) ??
    num(audioStream?.duration);
  const durationMs =
    durationSeconds !== null && durationSeconds > 0
      ? Math.round(durationSeconds * 1000)
      : null;

  return {
    formatName: str(format.format_name) ?? "",
    durationMs,
    video,
    audio,
  };
}

function isMp4Container(formatName: string): boolean {
  return formatName.split(",").some((name) => name === "mp4" || name === "mov");
}

function evenUp(value: number): number {
  return Math.ceil(value / 2) * 2;
}

/**
 * Copy when every stream already matches and is mp4-friendly; otherwise
 * re-encode to the largest frame size.
 */
export function planStitch(probes: readonly StitchSourceProbe[]): StitchPlan {
  if (probes.length < 2) {
    throw new Error("Stitching needs at least 2 videos.");
  }
  const missingVideo = probes.findIndex((p) => !p.video);
  if (missingVideo >= 0) {
    throw new Error(
      `Recording ${missingVideo + 1} in the stitch has no readable video track.`,
    );
  }
  const videos = probes.flatMap((p) => (p.video ? [p.video] : []));
  const width = evenUp(Math.max(...videos.map((v) => v.width)));
  const height = evenUp(Math.max(...videos.map((v) => v.height)));
  const withAudio = probes.filter((p) => p.audio).length;
  const audio: StitchAudioMode =
    withAudio === 0 ? "none" : withAudio === probes.length ? "all" : "some";

  const reencode = (reason: string): StitchPlan => ({
    mode: "reencode",
    width,
    height,
    audio,
    reason,
  });

  if (!probes.every((p) => isMp4Container(p.formatName))) {
    return reencode("not every source is an mp4 file");
  }
  const first = firstOf(videos);
  if (!first) {
    return reencode("no video sources");
  }
  if (!COPYABLE_VIDEO_CODECS.has(first.codec)) {
    return reencode(`video codec ${first.codec} cannot be copied into mp4`);
  }
  const videoMismatch = videos.find(
    (v) =>
      v.codec !== first.codec ||
      v.profile !== first.profile ||
      v.width !== first.width ||
      v.height !== first.height ||
      v.pixFmt !== first.pixFmt,
  );
  if (videoMismatch) {
    return reencode("video codec, profile, size or pixel format differ");
  }
  if (audio === "some") {
    return reencode("some sources have audio and some do not");
  }
  if (audio === "all") {
    const audios = probes.flatMap((p) => (p.audio ? [p.audio] : []));
    const a0 = firstOf(audios);
    if (!a0) {
      return reencode("no audio sources");
    }
    if (!COPYABLE_AUDIO_CODECS.has(a0.codec)) {
      return reencode(`audio codec ${a0.codec} cannot be copied into mp4`);
    }
    if (
      audios.some(
        (a) =>
          a.codec !== a0.codec ||
          a.sampleRate !== a0.sampleRate ||
          a.channels !== a0.channels,
      )
    ) {
      return reencode("audio codec, sample rate or channels differ");
    }
  }
  return {
    mode: "copy",
    width: first.width,
    height: first.height,
    hasAudio: audio === "all",
    reason: "all sources match",
  };
}

/** A concat demuxer list; paths are quoted the way ffconcat expects. */
export function buildConcatList(paths: readonly string[]): string {
  const lines = ["ffconcat version 1.0"];
  for (const path of paths) {
    lines.push(`file '${path.replace(/'/g, "'\\''")}'`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildCopyConcatArgs(input: {
  listPath: string;
  outputPath: string;
  hasAudio: boolean;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    input.listPath,
    "-map",
    "0:v:0",
    ...(input.hasAudio ? ["-map", "0:a:0"] : []),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    input.outputPath,
  ];
}

export interface ReencodeInput {
  path: string;
  hasAudio: boolean;
  /** Used to size the silence for a source without audio. */
  durationMs: number | null;
  /** Stream start times from ffprobe, to keep the audio offset. */
  videoStartMs?: number | null;
  audioStartMs?: number | null;
}

const AUDIO_FORMAT = "aformat=sample_fmts=fltp:channel_layouts=stereo";

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * The audio chain for one source, timed against its video. Every segment's
 * video is reset to start at 0, so audio must be shifted by the same amount:
 * audio that starts later than the video is delayed by the gap, and audio
 * that starts earlier loses the part before the first video frame. Resetting
 * audio to its own start instead would pull late audio forward and push
 * early audio back, out of sync for the whole segment.
 */
export function sourceAudioFilter(source: ReencodeInput, index: number) {
  const videoStart = source.videoStartMs ?? null;
  const audioStart = source.audioStartMs ?? null;
  const offsetMs =
    videoStart !== null && audioStart !== null ? audioStart - videoStart : 0;
  const steps = [`[${index}:a]`];
  if (offsetMs < 0 && videoStart !== null) {
    steps.push(`atrim=start=${seconds(videoStart)},`);
  }
  steps.push(`aresample=48000,${AUDIO_FORMAT},asetpts=PTS-STARTPTS`);
  if (offsetMs > 0) {
    steps.push(`,adelay=delays=${offsetMs}|${offsetMs}`);
  }
  steps.push(`[a${index}]`);
  return steps.join("");
}

/** Silence for a source without audio; concat pads any shortfall itself. */
function silenceSeconds(durationMs: number | null): string {
  return durationMs && durationMs > 0 ? (durationMs / 1000).toFixed(3) : "0.1";
}

export function buildReencodeArgs(input: {
  inputs: readonly ReencodeInput[];
  width: number;
  height: number;
  audio: StitchAudioMode;
  outputPath: string;
  threads?: number;
}): string[] {
  const { inputs, width, height, audio, outputPath } = input;
  const threads = input.threads ?? STITCH_ENCODE_THREADS;
  const includeAudio = audio !== "none";
  const filters: string[] = [];
  const concatInputs: string[] = [];
  inputs.forEach((source, i) => {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,` +
        `setpts=PTS-STARTPTS[v${i}]`,
    );
    if (!includeAudio) {
      concatInputs.push(`[v${i}]`);
      return;
    }
    if (source.hasAudio) {
      filters.push(sourceAudioFilter(source, i));
    } else {
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,` +
          `atrim=duration=${silenceSeconds(source.durationMs)},` +
          `${AUDIO_FORMAT},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filters.push(
    `${concatInputs.join("")}concat=n=${inputs.length}:v=1:a=${includeAudio ? 1 : 0}` +
      `[outv]${includeAudio ? "[outa]" : ""}`,
  );

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    ...inputs.flatMap((source) => ["-i", source.path]),
    "-filter_complex_threads",
    "2",
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
    ...(includeAudio ? ["-map", "[outa]"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    ...(includeAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
    "-threads",
    String(threads),
    "-max_muxing_queue_size",
    "4096",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];
}

export function stitchFfmpegTimeoutMs(totalDurationMs: number): number {
  return Math.min(
    MAX_FFMPEG_TIMEOUT_MS,
    Math.max(MIN_FFMPEG_TIMEOUT_MS, Math.round(totalDurationMs * 3)),
  );
}

// ---------------------------------------------------------------------------
// ffprobe / ffmpeg
// ---------------------------------------------------------------------------

export function resolveFfprobeCommand(): string {
  // Next to the ffmpeg in use (FFMPEG_PATH or the system one), else on PATH.
  const ffmpeg = resolveFfmpegCommand();
  if (ffmpeg.includes("/")) {
    const sibling = join(dirname(ffmpeg), "ffprobe");
    if (existsSync(sibling)) return sibling;
  }
  if (existsSync("/usr/bin/ffprobe")) return "/usr/bin/ffprobe";
  return "ffprobe";
}

export function isFfprobeAvailable(): boolean {
  return (
    // observed-write-ok: read-only ffprobe version check
    spawnSync(resolveFfprobeCommand(), ["-version"], {
      stdio: "ignore",
      timeout: 2_000,
    }).status === 0
  );
}

export async function probeStitchSource(
  path: string,
): Promise<StitchSourceProbe> {
  const stdout = await new Promise<string>((resolve, reject) => {
    // observed-write-ok: ffprobe only reads the source file
    const child = spawn(
      resolveFfprobeCommand(),
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffprobe timed out"));
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString("utf8")).slice(-4096);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe exited with code ${code}: ${err.trim()}`));
    });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe returned unreadable output");
  }
  return parseFfprobeOutput(parsed);
}

export interface StitchSourceFile {
  path: string;
  /** Duration stored on the recording, used when the file has none. */
  fallbackDurationMs?: number | null;
}

export interface ConcatResult {
  plan: StitchPlan;
  mode: "copy" | "reencode";
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface ConcatOptions {
  onProgress?: (fraction: number) => void;
  /** Kills ffmpeg when aborted. */
  signal?: AbortSignal;
  /**
   * Wall-clock budget for all ffmpeg work. A failed or timed-out stream copy
   * leaves the re-encode only what is left of it.
   */
  budgetMs?: number;
}

/**
 * Concatenates local video files into one mp4 at `outputPath`. Tries a stream
 * copy when the sources match and falls back to a re-encode if that fails.
 */
export async function concatVideoFiles(
  sources: readonly StitchSourceFile[],
  outputPath: string,
  options: ConcatOptions = {},
): Promise<ConcatResult> {
  const { signal } = options;
  // One ffprobe at a time: probes are quick and the host is shared.
  const probes: Awaited<ReturnType<typeof probeStitchSource>>[] = [];
  for (const source of sources) {
    probes.push(await probeStitchSource(source.path));
  }
  const plan = planStitch(probes);
  const durations = probes.map(
    (probe, i) => probe.durationMs ?? sources[i]?.fallbackDurationMs ?? null,
  );
  const totalMs = durations.reduce<number>((sum, d) => sum + (d ?? 0), 0);
  const onProgress = options.onProgress ?? (() => {});
  const budgetMs = options.budgetMs ?? stitchFfmpegTimeoutMs(totalMs);
  const deadline = Date.now() + budgetMs;
  const remainingMs = () => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `Combining the videos took longer than ${Math.round(budgetMs / 60_000)} minutes.`,
      );
    }
    return left;
  };

  let mode: "copy" | "reencode" = plan.mode;
  if (plan.mode === "copy") {
    const listPath = join(dirname(outputPath), "concat.txt");
    // observed-write-ok: temp-only concat list inside the job's temp dir
    await writeFile(
      listPath,
      buildConcatList(sources.map((source) => source.path)),
    );
    try {
      await runFfmpegWithProgress(
        buildCopyConcatArgs({
          listPath,
          outputPath,
          hasAudio: plan.hasAudio,
        }),
        {
          timeoutMs: remainingMs(),
          label: "stitch copy",
          totalMs,
          onProgress,
          signal,
        },
      );
      const out = await probeStitchSource(outputPath);
      const tolerance = COPY_DURATION_TOLERANCE_MS_PER_SOURCE * sources.length;
      if (
        !out.video ||
        (plan.hasAudio && !out.audio) ||
        (totalMs > 0 &&
          (out.durationMs === null ||
            Math.abs(out.durationMs - totalMs) > tolerance))
      ) {
        throw new Error(
          `copy output did not check out (duration ${out.durationMs}ms, expected ${totalMs}ms)`,
        );
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("[stitch-job] stream copy failed, re-encoding instead", {
        error: error instanceof Error ? error.message : String(error),
      });
      mode = "reencode";
    }
  }

  if (mode === "reencode") {
    const width = plan.width;
    const height = plan.height;
    const audio: StitchAudioMode =
      plan.mode === "reencode" ? plan.audio : plan.hasAudio ? "all" : "none";
    await runFfmpegWithProgress(
      buildReencodeArgs({
        inputs: sources.map((source, i) => ({
          path: source.path,
          hasAudio: Boolean(probes[i]?.audio),
          durationMs: durations[i] ?? null,
          videoStartMs: probes[i]?.video?.startMs ?? null,
          audioStartMs: probes[i]?.audio?.startMs ?? null,
        })),
        width,
        height,
        audio,
        outputPath,
      }),
      {
        timeoutMs: remainingMs(),
        label: "stitch re-encode",
        totalMs,
        onProgress,
        signal,
      },
    );
  }

  const out = await probeStitchSource(outputPath);
  const info = await stat(outputPath);
  if (!out.video || info.size === 0) {
    throw new Error("The combined video came out empty.");
  }
  onProgress(1);
  return {
    plan,
    mode,
    durationMs: out.durationMs ?? totalMs,
    width: out.video.width,
    height: out.video.height,
    hasAudio: Boolean(out.audio),
    sizeBytes: info.size,
  };
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Largest single source a stitch downloads: the upload limit. */
export const STITCH_SOURCE_MAX_BYTES = MAX_UPLOAD_BYTES;
/** All sources of one stitch together, and the combined video. */
export const STITCH_TOTAL_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** A transfer that sends no bytes this long is stopped. */
export const STITCH_TRANSFER_STALL_MS = 60_000;
/** Most time one source download may take. */
export const STITCH_SOURCE_TRANSFER_MAX_MS = 30 * 60_000;
/** Most time the storage provider may take to accept one upload part. */
export const STITCH_UPLOAD_PART_TIMEOUT_MS = 2 * 60_000;
/** Most time the whole upload may take. */
export const STITCH_UPLOAD_MAX_MS = 60 * 60_000;
/** Providers without multipart upload get the file in memory, up to this. */
export const STITCH_BUFFERED_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

/** A stitch that went over one of the limits above; not worth retrying. */
export class StitchLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StitchLimitError";
  }
}

/** The worker lost its job lease; another worker owns the stitch now. */
export class StitchLeaseLostError extends Error {
  constructor() {
    super("Another worker took over this stitch.");
    this.name = "StitchLeaseLostError";
  }
}

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("The stitch was stopped."),
      );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const timer = setTimeout(() => reject(new Error(message)), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

// ---------------------------------------------------------------------------
// Sources: access + download
// ---------------------------------------------------------------------------

/** Parses the action's `sourceRecordingIds` (array, JSON string or CSV). */
export function parseSourceRecordingIds(value: string | string[]): string[] {
  let ids: unknown;
  if (typeof value === "string") {
    try {
      ids = JSON.parse(value);
    } catch {
      ids = value.split(",").map((s) => s.trim());
    }
  } else {
    ids = value;
  }
  if (!Array.isArray(ids)) ids = [ids];
  return (ids as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}

/**
 * The caller's own recordings, in the requested order. Throws when one is
 * missing, not theirs, not a Clips-hosted video, or the set is over the
 * stitch size limits.
 */
export async function loadOwnedStitchSources(
  ids: readonly string[],
  ownerEmail: string,
  options: { checkSizes?: boolean } = {},
): Promise<RecordingRow[]> {
  const checkSizes = options.checkSizes ?? true;
  if (ids.length < 2) {
    throw new Error("stitch-recordings needs at least 2 sourceRecordingIds");
  }
  if (ids.length > MAX_STITCH_SOURCES) {
    throw new Error(
      `stitch-recordings accepts at most ${MAX_STITCH_SOURCES} sourceRecordingIds`,
    );
  }
  const sources = await getDb()
    .select()
    .from(schema.recordings)
    .where(
      and(
        inArray(schema.recordings.id, [...ids]),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  const byId = new Map(sources.map((s) => [s.id, s]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(
      `Not all source recordings were found: asked for ${ids.length}, got ${ids.length - missing.length}`,
    );
  }
  const ordered = ids.flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
  let totalBytes = 0;
  for (const source of ordered) {
    assertNativeRecordingMedia(source);
    if (source.trashedAt) {
      throw new Error(`Recording "${source.title}" is in the trash.`);
    }
    if (source.status !== "ready" || !source.videoUrl) {
      throw new Error(
        `Recording "${source.title}" does not have a ready video yet.`,
      );
    }
    const size = source.videoSizeBytes ?? 0;
    if (checkSizes && size > STITCH_SOURCE_MAX_BYTES) {
      throw new StitchLimitError(
        `Recording "${source.title}" is ${formatUploadBytes(size, "up")}; a stitch takes recordings up to ${formatUploadBytes(STITCH_SOURCE_MAX_BYTES, "down")}.`,
      );
    }
    totalBytes += size;
  }
  if (checkSizes && totalBytes > STITCH_TOTAL_MAX_BYTES) {
    throw new StitchLimitError(
      `These recordings add up to ${formatUploadBytes(totalBytes, "up")}; one stitch takes up to ${formatUploadBytes(STITCH_TOTAL_MAX_BYTES, "down")}.`,
    );
  }
  return ordered;
}

function isLocalRecordingBlob(videoUrl: string): boolean {
  return (
    videoUrl.startsWith("/api/video/") ||
    (videoUrl.startsWith("/api/uploads/") && videoUrl.endsWith("/blob"))
  );
}

/** Bytes the remaining sources of one stitch may still download. */
export interface StitchByteBudget {
  remaining: number;
}

function sourceLimitError(
  title: string,
  perSourceLimit: number,
  budget: StitchByteBudget,
): StitchLimitError {
  return budget.remaining < perSourceLimit
    ? new StitchLimitError(
        `The recordings add up to more than the ${formatUploadBytes(STITCH_TOTAL_MAX_BYTES, "down")} one stitch can download.`,
      )
    : new StitchLimitError(
        `Recording "${title}" is larger than the ${formatUploadBytes(perSourceLimit, "down")} a stitch downloads per recording.`,
      );
}

/**
 * Streams one source video to disk; never holds a stored video in memory.
 * Stops when the source goes over its byte limit or the stitch's remaining
 * budget, stops sending data for STITCH_TRANSFER_STALL_MS, or takes longer
 * than STITCH_SOURCE_TRANSFER_MAX_MS.
 */
export async function downloadStitchSource(
  recording: Pick<
    RecordingRow,
    "id" | "title" | "videoUrl" | "storageMode" | "videoSizeBytes"
  >,
  path: string,
  budget: StitchByteBudget,
  options: {
    signal?: AbortSignal;
    perSourceLimit?: number;
    stallMs?: number;
    maxMs?: number;
  } = {},
): Promise<number> {
  const perSourceLimit = options.perSourceLimit ?? STITCH_SOURCE_MAX_BYTES;
  const limit = Math.min(perSourceLimit, budget.remaining);
  const videoUrl = recording.videoUrl ?? "";
  if (isLocalRecordingBlob(videoUrl)) {
    // Dev-only blobs in application state are small and already in memory.
    const media = await loadRecordingMediaBytes(
      recording as PublicAgentRecording,
    );
    if (media.bytes.byteLength > limit) {
      throw sourceLimitError(recording.title, perSourceLimit, budget);
    }
    // observed-write-ok: temp-only copy of the source inside the job's temp dir
    await writeFile(path, media.bytes);
    budget.remaining -= media.bytes.byteLength;
    return media.bytes.byteLength;
  }

  const controller = new AbortController();
  const stallMs = options.stallMs ?? STITCH_TRANSFER_STALL_MS;
  const stall = setTimeout(
    () =>
      controller.abort(
        new Error(
          `The download stopped sending data for ${Math.round(stallMs / 1000)} seconds.`,
        ),
      ),
    stallMs,
  );
  const onParentAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onParentAbort();
  options.signal?.addEventListener("abort", onParentAbort, { once: true });
  let received = 0;
  try {
    const response = await fetchRecordingMediaResponse(videoUrl, {
      recordingId: recording.id,
      storageMode: recording.storageMode,
      timeoutMs: options.maxMs ?? STITCH_SOURCE_TRANSFER_MAX_MS,
      signal: controller.signal,
    });
    if (!response.body) {
      throw new Error(`Recording "${recording.title}" has no video data.`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body.cancel().catch(() => {});
      throw sourceLimitError(recording.title, perSourceLimit, budget);
    }
    stall.refresh();
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > limit) {
          callback(sourceLimitError(recording.title, perSourceLimit, budget));
          return;
        }
        stall.refresh();
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream),
      meter,
      // observed-write-ok: temp-only copy of the source inside the job's temp dir
      createWriteStream(path, { flags: "wx" }),
      { signal: controller.signal },
    );
  } catch (error) {
    if (error instanceof StitchLimitError) throw error;
    const reason: unknown = controller.signal.reason;
    if (controller.signal.aborted && reason instanceof Error) throw reason;
    throw error;
  } finally {
    clearTimeout(stall);
    options.signal?.removeEventListener("abort", onParentAbort);
  }
  budget.remaining -= received;
  return received;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * The upload provider of the destination recording, as its persisted storage
 * mode resolves it now. The action pinned the stitch to own storage and noted
 * the provider; a provider that changed since is refused rather than silently
 * writing the video somewhere else.
 */
export async function resolveStitchDestinationProvider(input: {
  recordingId: string;
  ownerEmail: string;
  expectedProviderId: string | null;
}): Promise<FileUploadProvider> {
  const storage = await resolveClipsVideoStorage({
    intent: "existing",
    recordingId: input.recordingId,
    email: input.ownerEmail,
  });
  if (storage.mode === "hosted") {
    throw new StitchLimitError(
      "Server stitching saves to your own video storage, and this recording uses hosted Clips storage.",
    );
  }
  if (storage.mode !== "own" || !storage.provider) {
    throw new StitchLimitError(
      "No video storage is connected. Connect Builder.io or S3-compatible storage and stitch again.",
    );
  }
  if (
    input.expectedProviderId &&
    storage.provider.id !== input.expectedProviderId
  ) {
    throw new StitchLimitError(
      "Your video storage changed after this stitch was started. Stitch the recordings again.",
    );
  }
  return storage.provider;
}

/**
 * Uploads the stitched file through the destination's provider: in parts
 * through its multipart upload, so a long video never sits in memory, each
 * part with a timeout. A provider without one gets the file in a single
 * upload, only up to STITCH_BUFFERED_UPLOAD_MAX_BYTES.
 */
export async function uploadStitchedFile(input: {
  recordingId: string;
  ownerEmail: string;
  path: string;
  sizeBytes: number;
  provider: FileUploadProvider;
  signal?: AbortSignal;
  partTimeoutMs?: number;
}): Promise<FileUploadResult> {
  const { recordingId, ownerEmail, path, sizeBytes, provider, signal } = input;
  const partTimeoutMs = input.partTimeoutMs ?? STITCH_UPLOAD_PART_TIMEOUT_MS;
  const filename = `${recordingId}.mp4`;
  const mimeType = "video/mp4";
  const deadline = Date.now() + STITCH_UPLOAD_MAX_MS;
  const timeLeft = () => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `Uploading the combined video took longer than ${STITCH_UPLOAD_MAX_MS / 60_000} minutes.`,
      );
    }
    return left;
  };

  const resumable = provider.resumable;
  if (resumable) {
    return withRecordingMediaProduction(
      { recordingId, ownerEmail, recordAsset: false },
      async () => {
        // Opened before the session starts, so a missing file never leaves
        // an open multipart upload behind.
        const file = await open(path, "r");
        let started: ResumableUploadSession | null = null;
        try {
          started = await withTimeout(
            resumable.startSession(filename, mimeType, sizeBytes),
            Math.min(partTimeoutMs, timeLeft()),
            "Storage did not start the upload in time.",
            signal,
          );
          let session: ResumableUploadSession = started;
          const buffer = Buffer.alloc(STITCH_UPLOAD_PART_BYTES);
          let offset = 0;
          let part = 0;
          while (offset < sizeBytes) {
            const length = Math.min(
              STITCH_UPLOAD_PART_BYTES,
              sizeBytes - offset,
            );
            const { bytesRead } = await file.read(buffer, 0, length, offset);
            if (bytesRead !== length) {
              throw new Error("The combined video changed while uploading.");
            }
            part += 1;
            // A copy: providers may keep a reference to the part.
            const bytes = new Uint8Array(buffer.subarray(0, length));
            const current: ResumableUploadSession = session;
            const result = await withTimeout(
              resumable.relayChunk(
                current,
                stitchPartContentRange(offset, length, sizeBytes),
                bytes,
                { mimeType },
              ),
              Math.min(partTimeoutMs, timeLeft()),
              `Storage did not accept part ${part} of the combined video within ${Math.round(partTimeoutMs / 1000)} seconds.`,
              signal,
            );
            if (!result.ok) {
              throw new Error(`Storage refused a part (${result.status}).`);
            }
            if (result.updatedMeta) {
              session = {
                ...current,
                meta: { ...current.meta, ...result.updatedMeta },
              };
              started = session;
            }
            offset += length;
          }
          const url = await withTimeout(
            resumable.completeSession(session, filename, {
              stableUrl: true,
              recordAsset: false,
            }),
            Math.min(partTimeoutMs, timeLeft()),
            "Storage did not finish the upload in time.",
            signal,
          );
          return { url, provider: provider.id };
        } catch (error) {
          if (started && resumable.abortSession) {
            await resumable.abortSession(started).catch((abortError) => {
              console.warn(
                "[stitch-job] could not abort the multipart upload",
                {
                  recordingId,
                  error:
                    abortError instanceof Error
                      ? abortError.message
                      : String(abortError),
                },
              );
            });
          }
          throw error;
        } finally {
          await file.close().catch(() => {});
        }
      },
    );
  }

  if (sizeBytes > STITCH_BUFFERED_UPLOAD_MAX_BYTES) {
    throw new StitchLimitError(
      `The combined video is ${formatUploadBytes(sizeBytes, "up")}, and your storage provider takes it in one piece, up to ${formatUploadBytes(STITCH_BUFFERED_UPLOAD_MAX_BYTES, "down")}.`,
    );
  }
  const data = new Uint8Array(await readFile(path));
  return withRecordingMediaProduction(
    { recordingId, ownerEmail, recordAsset: false },
    () =>
      withTimeout(
        provider.upload({
          data,
          filename,
          mimeType,
          ownerEmail,
          stableUrl: true,
          recordAsset: false,
        }),
        timeLeft(),
        `Uploading the combined video took longer than ${STITCH_UPLOAD_MAX_MS / 60_000} minutes.`,
        signal,
      ),
  );
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface StitchJobInput {
  recordingId: string;
  ownerEmail: string;
  sourceRecordingIds: string[];
  /** The destination's provider when the stitch was accepted. */
  storageProviderId: string | null;
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const firstLine = message.split("\n").find((line) => line.trim()) ?? "";
  const reason = firstLine.trim() || "Stitching failed.";
  return reason.length > 300 ? `${reason.slice(0, 297)}...` : reason;
}

async function failStitch(recordingId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .update(schema.recordings)
    .set({
      status: "failed",
      failureReason: reason,
      failureCode: STITCH_FAILURE_CODE,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.status, "processing"),
      ),
    );
  try {
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "failed",
      failureReason: reason,
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.warn("[stitch-job] could not write the failure state", {
      recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Flips the row to ready; false when it was deleted or changed meanwhile. */
async function promoteStitch(input: {
  recordingId: string;
  ownerEmail: string;
  videoUrl: string;
  result: ConcatResult;
  now: string;
  /** The first source's thumbnail, reused for the stitched recording. */
  thumbnailUrl: string | null;
}): Promise<boolean> {
  const { recordingId, ownerEmail, videoUrl, result, now, thumbnailUrl } =
    input;
  const promoted = await getDb()
    .update(schema.recordings)
    .set({
      status: "ready",
      videoUrl,
      videoFormat: "mp4",
      videoSizeBytes: result.sizeBytes,
      mediaUpdatedAt: now,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
      hasAudio: result.hasAudio,
      failureReason: null,
      failureCode: null,
      uploadProgress: 100,
      // Frame extraction refuses files over 200 MB, and a stitch is often
      // bigger, so the first source's thumbnail is the reliable choice.
      ...(thumbnailUrl
        ? { thumbnailUrl, thumbnailStatus: "generated" as const }
        : { thumbnailStatus: "pending" as const }),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "processing"),
        isNull(schema.recordings.trashedAt),
      ),
    )
    .returning({ id: schema.recordings.id });
  return promoted.length === 1;
}

/** The same bookkeeping finalize-recording does once a clip is ready. */
async function afterStitchReady(input: {
  recordingId: string;
  ownerEmail: string;
  videoUrl: string;
  result: ConcatResult;
  now: string;
  thumbnailUrl: string | null;
}): Promise<void> {
  const { recordingId, ownerEmail, videoUrl, result, now } = input;
  const db = getDb();
  await writeAppState(`recording-upload-${recordingId}`, {
    recordingId,
    status: "ready",
    pendingMediaVerification: false,
    progress: 100,
    videoUrl,
    videoSizeBytes: result.sizeBytes,
    durationMs: result.durationMs,
    seekableApplied: true,
    finishedAt: now,
  });
  // Written with +faststart, so it is already seekable.
  await markRecordingSeekable(recordingId, videoUrl).catch((error) => {
    console.warn("[stitch-job] could not write the seekable marker", {
      recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const insertedTranscripts = await db
    .insert(schema.recordingTranscripts)
    .values({
      recordingId,
      ownerEmail,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.recordingTranscripts.recordingId })
    .returning({ recordingId: schema.recordingTranscripts.recordingId });

  await writeAppState("refresh-signal", { ts: Date.now() });

  if (!input.thumbnailUrl) {
    await dispatchPostFinalizeJob({
      recordingId,
      kind: "thumbnail",
      requireAccepted: true,
    }).catch((error: unknown) => {
      console.warn("[stitch-job] thumbnail dispatch failed", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  if (insertedTranscripts.length > 0) {
    await dispatchPostFinalizeJob({
      recordingId,
      kind: "transcript",
      requestedByEmail: ownerEmail,
    }).catch((error: unknown) => {
      console.warn("[stitch-job] transcript dispatch failed", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * A thumbnail the stitched recording may point at. A hosted thumbnail is
 * deleted when its own recording replaces it, so only own-storage ones are
 * shared; otherwise the stitch gets its own.
 */
function shareableThumbnail(source: RecordingRow | undefined): string | null {
  if (!source?.thumbnailUrl || source.storageMode === "hosted") return null;
  return source.thumbnailUrl;
}

export type StitchJobOutcome =
  | { status: "ready" }
  | { status: "failed"; reason: string }
  | { status: "lost" };

/**
 * Does the stitch for a claimed job. Every write that settles it checks the
 * lease token; when the lease is lost it stops and leaves the recording and
 * any upload to the worker that took over (the upload key is shared, so
 * deleting it could delete that worker's video).
 */
export async function runStitchJob(
  input: StitchJobInput,
  lease: { token: string; signal: AbortSignal },
): Promise<StitchJobOutcome> {
  const { recordingId, ownerEmail } = input;
  const { token, signal } = lease;
  const started = Date.now();
  let dir: string | null = null;
  let uploadedUrl: string | null = null;
  try {
    // observed-write-ok: per-job temp dir, removed in finally
    dir = await mkdtemp(join(tmpdir(), "clips-stitch-"));
    const sources = await loadOwnedStitchSources(
      input.sourceRecordingIds,
      ownerEmail,
    );
    if (!isFfmpegAvailable() || !isFfprobeAvailable()) {
      throw new Error("ffmpeg is not available on this server.");
    }
    const provider = await resolveStitchDestinationProvider({
      recordingId,
      ownerEmail,
      expectedProviderId: input.storageProviderId,
    });

    const budget: StitchByteBudget = { remaining: STITCH_TOTAL_MAX_BYTES };
    const files: StitchSourceFile[] = [];
    for (const [i, source] of sources.entries()) {
      signal.throwIfAborted();
      const extension = source.videoFormat === "mp4" ? "mp4" : "webm";
      const path = join(dir, `src${i}.${extension}`);
      try {
        await downloadStitchSource(source, path, budget, { signal });
      } catch (error) {
        if (error instanceof StitchLimitError || signal.aborted) throw error;
        throw new Error(
          `Could not download "${source.title}": ${shortReason(error)}`,
        );
      }
      files.push({ path, fallbackDurationMs: source.durationMs });
    }
    const downloadedAt = Date.now();

    const outputPath = join(dir, "stitched.mp4");
    let lastLogged = 0;
    const result = await concatVideoFiles(files, outputPath, {
      signal,
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastLogged < 60_000) return;
        lastLogged = now;
        console.log(
          `[stitch-job] ${recordingId} ${Math.round(fraction * 100)}%`,
        );
      },
    });
    if (result.sizeBytes > STITCH_TOTAL_MAX_BYTES) {
      throw new StitchLimitError(
        `The combined video is ${formatUploadBytes(result.sizeBytes, "up")}; a stitch can save up to ${formatUploadBytes(STITCH_TOTAL_MAX_BYTES, "down")}.`,
      );
    }
    const encodedAt = Date.now();

    const upload = await uploadStitchedFile({
      recordingId,
      ownerEmail,
      path: outputPath,
      sizeBytes: result.sizeBytes,
      provider,
      signal,
    });
    uploadedUrl = upload.url;
    const bound = await isS3ObjectUrlBoundToRecording(upload.url, recordingId);
    if (bound === false) {
      throw new Error(
        "The combined video was stored under the wrong recording.",
      );
    }

    if (!(await renewStitchLease(recordingId, token))) {
      throw new StitchLeaseLostError();
    }
    const ready = {
      recordingId,
      ownerEmail,
      videoUrl: upload.url,
      result,
      now: new Date().toISOString(),
      thumbnailUrl: shareableThumbnail(sources[0]),
    };
    if (!(await promoteStitch(ready))) {
      throw new Error(
        "The stitched recording was deleted or changed while it was being combined.",
      );
    }
    // The row now points at the upload: never delete it from here on.
    uploadedUrl = null;
    await settleStitchJob({ recordingId, token, state: "ready" });
    // The recording is ready and playable now. The bookkeeping below only
    // queues the thumbnail and transcript; a failure there is logged and the
    // video stays ready (the thumbnail and transcript can be made again).
    await afterStitchReady(ready).catch((error: unknown) => {
      console.warn("[stitch-job] post-ready bookkeeping failed", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    console.log(
      `[stitch-job] ${recordingId} ready: ${sources.length} sources, ${result.mode} (${result.plan.reason}), ` +
        `${result.durationMs}ms, ${result.sizeBytes} bytes — download ${((downloadedAt - started) / 1000).toFixed(1)}s, ` +
        `encode ${((encodedAt - downloadedAt) / 1000).toFixed(1)}s, upload ${((Date.now() - encodedAt) / 1000).toFixed(1)}s`,
    );
    return { status: "ready" };
  } catch (error) {
    if (
      error instanceof StitchLeaseLostError ||
      signal.reason instanceof StitchLeaseLostError
    ) {
      console.warn(`[stitch-job] ${recordingId} lease lost; stopping`);
      return { status: "lost" };
    }
    const reason = shortReason(error);
    console.warn(`[stitch-job] ${recordingId} failed:`, reason);
    if (uploadedUrl) {
      await deleteStoredMediaUrl(uploadedUrl, { recordingId }).catch(
        (cleanupError) => {
          console.warn("[stitch-job] could not delete the orphaned upload", {
            recordingId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        },
      );
    }
    const settled = await settleStitchJob({
      recordingId,
      token,
      state: "failed",
      error: reason,
    }).catch((settleError: unknown) => {
      console.error("[stitch-job] could not settle the failed job", {
        recordingId,
        error:
          settleError instanceof Error
            ? settleError.message
            : String(settleError),
      });
      // Still mark the recording: a failed job row is recovered by the sweep.
      return true;
    });
    if (!settled) return { status: "lost" };
    await failStitch(recordingId, reason).catch((failError) => {
      console.error("[stitch-job] could not mark the stitch failed", {
        recordingId,
        error:
          failError instanceof Error ? failError.message : String(failError),
      });
    });
    return { status: "failed", reason };
  } finally {
    if (dir) {
      // The stitch result is already settled here (ready or failed); a
      // leftover temp dir must not change it, but it must be visible.
      // observed-write-ok: removes the per-job temp dir
      await rm(dir, { recursive: true, force: true }).catch(
        (error: unknown) => {
          console.warn("[stitch-job] could not remove the temp dir", {
            recordingId,
            dir,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  }
}

const EXHAUSTED_REASON = `Stitching was interrupted ${STITCH_MAX_ATTEMPTS} times before it finished, for example by server restarts. Stitch the recordings again.`;

/** Fails a job, and its recording, after its last attempt ran out. */
async function failExhaustedStitch(recordingId: string): Promise<boolean> {
  const settled = await settleStitchJob({
    recordingId,
    state: "failed",
    error: EXHAUSTED_REASON,
  });
  if (settled) await failStitch(recordingId, EXHAUSTED_REASON);
  return settled;
}

export type DurableStitchResult =
  | StitchJobOutcome
  | {
      status: "skipped";
      reason: Exclude<
        Extract<StitchClaim, { claimed: false }>["reason"],
        "exhausted"
      >;
    };

/**
 * The post-finalize worker's entry point: claims the job, keeps its lease
 * alive while the stitch runs and stops the stitch (ffmpeg included) if the
 * lease is lost. Safe to call more than once for the same recording: only one
 * worker holds the lease, and a settled job is skipped.
 */
export async function runDurableStitchJob(
  recordingId: string,
): Promise<DurableStitchResult> {
  const claim = await claimStitchJob(recordingId);
  if (!claim.claimed) {
    if (claim.reason === "exhausted") {
      await failExhaustedStitch(recordingId);
      return { status: "failed", reason: EXHAUSTED_REASON };
    }
    return { status: "skipped", reason: claim.reason };
  }
  const { token, job } = claim;
  console.log("[stitch-job] claimed", {
    recordingId,
    attempt: job.attempts,
  });
  const controller = new AbortController();
  let renewing: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (renewing || controller.signal.aborted) return;
    renewing = renewStitchLease(recordingId, token)
      .then((held) => {
        if (!held) controller.abort(new StitchLeaseLostError());
      })
      .catch((error: unknown) => {
        // A failed renewal is retried on the next beat; the lease outlasts
        // several of them.
        console.warn("[stitch-job] lease renewal failed", {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        renewing = null;
      });
  }, STITCH_LEASE_RENEW_MS);
  heartbeat.unref?.();
  try {
    return await runStitchJob(
      {
        recordingId,
        ownerEmail: job.ownerEmail,
        sourceRecordingIds: stitchJobSourceIds(job),
        storageProviderId: job.storageProviderId,
      },
      { token, signal: controller.signal },
    );
  } finally {
    clearInterval(heartbeat);
    await renewing;
    // Start the next waiting stitch now instead of at the next sweep.
    await recoverStitchJobs().catch((error: unknown) => {
      console.warn("[stitch-job] could not start the next stitch", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/** Hands the job to the post-finalize worker (a durable background function on serverless). */
export async function dispatchStitchJob(recordingId: string): Promise<void> {
  await dispatchPostFinalizeJob({
    recordingId,
    kind: "stitch",
    awaitDurableAcceptance: true,
  });
}

/**
 * The recovery sweep, run every minute on long-lived servers and on the
 * recurring sweep tick on serverless ones. Dispatches queued jobs and jobs
 * whose worker died (their lease ran out), as far as there are free slots;
 * fails jobs whose attempts are used up or whose recording is gone; prunes
 * settled job rows.
 */
export async function recoverStitchJobs(now: number = Date.now()): Promise<{
  dispatched: number;
  failed: number;
}> {
  const plan = await planStitchRecovery(now);
  let failed = 0;
  for (const job of plan.orphaned) {
    const settled = await settleStitchJob({
      recordingId: job.recordingId,
      state: "failed",
      error: "The stitched recording was deleted or is no longer processing.",
      now,
    });
    if (settled) failed += 1;
  }
  for (const job of plan.exhausted) {
    if (await failExhaustedStitch(job.recordingId)) failed += 1;
  }
  let dispatched = 0;
  for (const job of plan.dispatch) {
    try {
      await dispatchStitchJob(job.recordingId);
      dispatched += 1;
    } catch (error) {
      console.warn("[stitch-job] recovery dispatch failed", {
        recordingId: job.recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await pruneSettledStitchJobs(now);
  return { dispatched, failed };
}
