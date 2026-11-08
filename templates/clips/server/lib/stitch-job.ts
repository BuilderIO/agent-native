/**
 * "Stitch clips" used to run in the browser with ffmpeg.wasm: it downloaded
 * every source, re-encoded them single-threaded and uploaded the result, so a
 * long stitch sat at 0% for many minutes and died when the tab closed. Now
 * `stitch-recordings` creates the new recording as `processing` right away and
 * this in-process job does the work on the server:
 *
 *  1. re-checks the caller owns every source,
 *  2. streams each source video to a temp dir,
 *  3. ffprobes them; when every stream matches it concatenates with the concat
 *     demuxer and `-c copy`, otherwise it re-encodes (libx264 veryfast, aac,
 *     scale/pad to the largest size, `-threads 4`),
 *  4. uploads the mp4 in parts through the storage provider's multipart upload,
 *  5. marks the recording ready the way finalize does, or failed with a reason.
 *
 * Kept in one file so the weekly upstream merge stays easy.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { writeAppState } from "@agent-native/core/application-state";
import {
  getActiveFileUploadProviderForRequest,
  type FileUploadResult,
} from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, isNull, like, lt, notInArray } from "drizzle-orm";

import { markRecordingSeekable } from "../../actions/lib/ensure-seekable-video.js";
import { assertNativeRecordingMedia } from "../../actions/lib/native-media.js";
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
import { uploadRecordingMedia } from "./upload-recording-media.js";
import {
  isFfmpegAvailable,
  resolveFfmpegCommand,
  runFfmpegWithProgress,
} from "./video-remux.js";

/** Stitch recordings stuck in `processing` this long are marked failed. */
export const STALE_STITCH_MS = 2 * 60 * 60 * 1000;
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

export interface StitchVideoStream {
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  pixFmt: string | null;
}

export interface StitchAudioStream {
  codec: string;
  sampleRate: number;
  channels: number;
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
        }
      : null;

  const audio: StitchAudioStream | null = audioStream
    ? {
        codec: str(audioStream.codec_name) ?? "unknown",
        sampleRate: num(audioStream.sample_rate) ?? 0,
        channels: num(audioStream.channels) ?? 0,
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
  const first: StitchVideoStream | undefined = videos[0];
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
    const a0: StitchAudioStream | undefined = audios[0];
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
}

/** Silence for a source without audio; concat pads any shortfall itself. */
function silenceSeconds(durationMs: number | null): string {
  return durationMs && durationMs > 0 ? (durationMs / 1000).toFixed(3) : "0.1";
}

const AUDIO_FORMAT = "aformat=sample_fmts=fltp:channel_layouts=stereo";

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
      filters.push(
        `[${i}:a]aresample=48000,${AUDIO_FORMAT},asetpts=PTS-STARTPTS[a${i}]`,
      );
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

/**
 * Concatenates local video files into one mp4 at `outputPath`. Tries a stream
 * copy when the sources match and falls back to a re-encode if that fails.
 */
export async function concatVideoFiles(
  sources: readonly StitchSourceFile[],
  outputPath: string,
  options: { onProgress?: (fraction: number) => void } = {},
): Promise<ConcatResult> {
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
  const timeoutMs = stitchFfmpegTimeoutMs(totalMs);

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
        { timeoutMs, label: "stitch copy", totalMs, onProgress },
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
        })),
        width,
        height,
        audio,
        outputPath,
      }),
      { timeoutMs, label: "stitch re-encode", totalMs, onProgress },
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
 * missing, not theirs, or not a Clips-hosted video.
 */
export async function loadOwnedStitchSources(
  ids: readonly string[],
  ownerEmail: string,
): Promise<RecordingRow[]> {
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
  }
  return ordered;
}

function isLocalRecordingBlob(videoUrl: string): boolean {
  return (
    videoUrl.startsWith("/api/video/") ||
    (videoUrl.startsWith("/api/uploads/") && videoUrl.endsWith("/blob"))
  );
}

/** Streams one source video to disk; never holds a stored video in memory. */
async function downloadSource(
  recording: RecordingRow,
  path: string,
): Promise<void> {
  const videoUrl = recording.videoUrl ?? "";
  if (isLocalRecordingBlob(videoUrl)) {
    // Dev-only blobs in application state are small and already in memory.
    const media = await loadRecordingMediaBytes(
      recording as PublicAgentRecording,
    );
    // observed-write-ok: temp-only copy of the source inside the job's temp dir
    await writeFile(path, media.bytes);
    return;
  }
  const response = await fetchRecordingMediaResponse(videoUrl, {
    recordingId: recording.id,
    storageMode: recording.storageMode,
  });
  if (!response.body) {
    throw new Error(`Recording "${recording.title}" has no video data.`);
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream),
    // observed-write-ok: temp-only copy of the source inside the job's temp dir
    createWriteStream(path, { flags: "wx" }),
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Uploads the stitched file. Uses the provider's multipart upload in parts so
 * a long video never sits in memory; falls back to a single upload for a
 * provider without one.
 */
async function uploadStitchedFile(input: {
  recordingId: string;
  ownerEmail: string;
  path: string;
  sizeBytes: number;
}): Promise<FileUploadResult> {
  const { recordingId, ownerEmail, path, sizeBytes } = input;
  const filename = `${recordingId}.mp4`;
  const mimeType = "video/mp4";
  const provider = await getActiveFileUploadProviderForRequest();

  if (provider?.resumable) {
    const resumable = provider.resumable;
    return withRecordingMediaProduction(
      { recordingId, ownerEmail, recordAsset: false },
      async () => {
        let session = await resumable.startSession(
          filename,
          mimeType,
          sizeBytes,
        );
        const file = await open(path, "r");
        try {
          const buffer = Buffer.alloc(STITCH_UPLOAD_PART_BYTES);
          let offset = 0;
          while (offset < sizeBytes) {
            const length = Math.min(
              STITCH_UPLOAD_PART_BYTES,
              sizeBytes - offset,
            );
            const { bytesRead } = await file.read(buffer, 0, length, offset);
            if (bytesRead !== length) {
              throw new Error("The combined video changed while uploading.");
            }
            // A copy: providers may keep a reference to the part.
            const part = new Uint8Array(buffer.subarray(0, length));
            const result = await resumable.relayChunk(
              session,
              stitchPartContentRange(offset, length, sizeBytes),
              part,
              { mimeType },
            );
            if (!result.ok) {
              throw new Error(`Storage refused a part (${result.status}).`);
            }
            if (result.updatedMeta) {
              session = {
                ...session,
                meta: { ...session.meta, ...result.updatedMeta },
              };
            }
            offset += length;
          }
          const url = await resumable.completeSession(session, filename, {
            stableUrl: true,
            recordAsset: false,
          });
          return { url, provider: provider.id };
        } catch (error) {
          if (resumable.abortSession) {
            await resumable.abortSession(session).catch((abortError) => {
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

  const data = new Uint8Array(await readFile(path));
  const uploaded = await uploadRecordingMedia({
    recordingId,
    ownerEmail,
    data,
    filename,
    mimeType,
    stableUrl: true,
    recordAsset: false,
  });
  if (!uploaded?.url) {
    throw new Error(
      "No video storage is connected. Connect Builder.io or S3-compatible storage and try again.",
    );
  }
  return uploaded;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface StitchJobInput {
  recordingId: string;
  ownerEmail: string;
  orgId?: string | null;
  sourceRecordingIds: string[];
}

/** One stitch at a time per container: the host is shared with other apps. */
let queue: Promise<unknown> = Promise.resolve();

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

export async function runStitchJob(input: StitchJobInput): Promise<void> {
  const { recordingId, ownerEmail } = input;
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

    const files: StitchSourceFile[] = [];
    for (const [i, source] of sources.entries()) {
      const extension = source.videoFormat === "mp4" ? "mp4" : "webm";
      const path = join(dir, `src${i}.${extension}`);
      try {
        await downloadSource(source, path);
      } catch (error) {
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
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastLogged < 60_000) return;
        lastLogged = now;
        console.log(
          `[stitch-job] ${recordingId} ${Math.round(fraction * 100)}%`,
        );
      },
    });
    const encodedAt = Date.now();

    const upload = await uploadStitchedFile({
      recordingId,
      ownerEmail,
      path: outputPath,
      sizeBytes: result.sizeBytes,
    });
    uploadedUrl = upload.url;
    const bound = await isS3ObjectUrlBoundToRecording(upload.url, recordingId);
    if (bound === false) {
      throw new Error(
        "The combined video was stored under the wrong recording.",
      );
    }

    const ready = {
      recordingId,
      ownerEmail,
      videoUrl: upload.url,
      result,
      now: new Date().toISOString(),
      thumbnailUrl: sources[0]?.thumbnailUrl ?? null,
    };
    if (!(await promoteStitch(ready))) {
      throw new Error(
        "The stitched recording was deleted or changed while it was being combined.",
      );
    }
    // The row now points at the upload: never delete it from here on.
    uploadedUrl = null;
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
  } catch (error) {
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
    await failStitch(recordingId, reason).catch((failError) => {
      console.error("[stitch-job] could not mark the stitch failed", {
        recordingId,
        error:
          failError instanceof Error ? failError.message : String(failError),
      });
    });
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

/**
 * Recordings this process has queued or is stitching. The stale sweep skips
 * them, so a long stitch is never marked failed while it still runs.
 */
const activeStitchIds = new Set<string>();

/** Runs the job in the background, as the owner, one stitch at a time. */
export function startStitchJob(input: StitchJobInput): void {
  activeStitchIds.add(input.recordingId);
  const next = queue.then(() =>
    runWithRequestContext(
      {
        userEmail: input.ownerEmail,
        ...(input.orgId ? { orgId: input.orgId } : {}),
      },
      () => runStitchJob(input),
    ),
  );
  queue = next
    .catch((error) => {
      console.error("[stitch-job] unexpected failure", {
        recordingId: input.recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      activeStitchIds.delete(input.recordingId);
    });
}

/**
 * Stitch jobs run in this process, so a restart loses them. Called on server
 * start and every 30 minutes: stitched recordings still `processing` after
 * STALE_STITCH_MS, and not queued or running in this process, are marked
 * failed so they don't spin forever.
 */
export async function failStaleStitchJobs(
  now: number = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - STALE_STITCH_MS).toISOString();
  // guard:allow-unscoped — system recovery sweep over orphaned stitch jobs.
  const stale = await getDb()
    .update(schema.recordings)
    .set({
      status: "failed",
      failureReason:
        "The server restarted while these recordings were being combined. Stitch them again.",
      failureCode: STITCH_FAILURE_CODE,
      updatedAt: new Date(now).toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.status, "processing"),
        isNull(schema.recordings.videoUrl),
        // guard:allow-blob-predicate — stale sweep runs once at boot, already narrowed to processing rows
        like(schema.recordings.editsJson, '%"stitchedFrom"%'),
        lt(schema.recordings.createdAt, cutoff),
        activeStitchIds.size > 0
          ? notInArray(schema.recordings.id, [...activeStitchIds])
          : undefined,
      ),
    )
    .returning({ id: schema.recordings.id });
  return stale.length;
}
