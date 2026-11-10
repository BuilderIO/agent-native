/**
 * Raise the audio of quiet recordings to a normal speech level.
 *
 * The desktop recorder captures the built-in MacBook microphone through
 * ScreenCaptureKit without Apple's voice processing. Speech then arrives near
 * -60 dBFS, and the live auto-gain stage stops at +18 dB, so the finished clip
 * lands around -40 LUFS while normal speech sits near -16 LUFS. Live-uploaded
 * clips never pass the offline loudnorm chain, so the server levels them here,
 * once the recording is ready.
 *
 * Only quiet clips are touched. The video stream is copied, only the audio is
 * re-encoded: a fixed gain plus a peak limiter, so the result sounds like the
 * original, only louder, without the pumping of dynamic normalization.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";

import {
  fetchProviderBytes,
  isRemoteProviderUrl,
} from "../../actions/lib/ensure-seekable-video.js";
import { isLoomRecordingSource } from "../../shared/loom.js";
import { isYouTubeEmbedBackedRecording } from "../../shared/youtube.js";
import { getDb, schema } from "../db/index.js";
import {
  deleteRecordingMediaObjects,
  deleteStoredMediaUrl,
  deleteSupersededHostedMedia,
} from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import { uploadRecordingMedia } from "./upload-recording-media.js";
import {
  isFfmpegAvailable,
  resolveFfmpegCommand,
  withRemuxSlot,
} from "./video-remux.js";

/** Integrated loudness the boost aims for (spoken-word streaming level). */
export const AUDIO_LEVEL_TARGET_LUFS = -16;
/** Clips at or above this level keep their original audio untouched. */
export const AUDIO_LEVEL_QUIET_THRESHOLD_LUFS = -24;
/** Below this the clip is silence or a muted mic: boosting only adds noise. */
export const AUDIO_LEVEL_SILENCE_LUFS = -70;
/** Largest boost applied, so a near-silent clip can't turn into loud hiss. */
export const AUDIO_LEVEL_MAX_GAIN_DB = 30;
/** Boosts smaller than this are not worth a re-encode. */
export const AUDIO_LEVEL_MIN_GAIN_DB = 3;
/** Limiter ceiling: -1 dBFS. */
export const AUDIO_LEVEL_LIMIT = 0.891;

/**
 * Largest stored file leveled. The job holds the source and the leveled copy
 * in memory while it uploads, so very long recordings are left alone.
 */
export const AUDIO_LEVEL_MAX_BYTES = 1024 * 1024 * 1024;

const MEASURE_TIMEOUT_MS = 10 * 60 * 1000;
const BOOST_TIMEOUT_MS = 20 * 60 * 1000;
const STDERR_LIMIT = 64 * 1024;
const DURATION_TOLERANCE_MS = 1_500;

export interface LoudnessMeasurement {
  integratedLufs: number | null;
  samplePeakDbfs: number | null;
}

export type AudioLevelStatus =
  | "boosted"
  | "already-normal"
  | "silent"
  | "skipped-not-ready"
  | "skipped-no-audio"
  | "skipped-no-media"
  | "skipped-local-media"
  | "skipped-no-ffmpeg"
  | "skipped-too-large"
  | "skipped-fetch-failed"
  | "skipped-measure-failed"
  | "skipped-boost-failed"
  | "skipped-multiple-audio"
  | "skipped-upload-failed"
  | "not-found";

/** Statuses a later attempt can fix (network, storage, a busy ffmpeg). */
export const RETRYABLE_AUDIO_LEVEL_STATUSES: ReadonlySet<AudioLevelStatus> =
  new Set<AudioLevelStatus>([
    "skipped-fetch-failed",
    "skipped-measure-failed",
    "skipped-boost-failed",
    "skipped-upload-failed",
  ]);

export function isRetryableAudioLevelStatus(status: AudioLevelStatus): boolean {
  return RETRYABLE_AUDIO_LEVEL_STATUSES.has(status);
}

export interface AudioLevelResult {
  recordingId: string;
  status: AudioLevelStatus;
  changed: boolean;
  integratedLufs?: number | null;
  gainDb?: number;
  detail?: string;
}

/** Index without assuming the item exists (lint and typecheck disagree on `[i]`). */
export function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function lastNumberAfter(text: string, label: RegExp): number | null {
  let value: number | null = null;
  for (const match of text.matchAll(label)) {
    const raw = itemAt(match, 1);
    if (raw === undefined) continue;
    const parsed = Number(raw);
    value = Number.isFinite(parsed) ? parsed : null;
  }
  return value;
}

/**
 * Read the summary that ffmpeg's `ebur128=peak=sample` filter prints at the end
 * of stderr. Silence reports `-70.0 LUFS` / `-inf dBFS`; `-inf` parses to null.
 */
export function parseEbur128Summary(stderr: string): LoudnessMeasurement {
  const summaryStart = stderr.lastIndexOf("Summary:");
  const summary = summaryStart >= 0 ? stderr.slice(summaryStart) : "";
  return {
    integratedLufs: lastNumberAfter(summary, /\bI:\s+(-?[\d.]+|-inf)\s+LUFS/g),
    samplePeakDbfs: lastNumberAfter(
      summary,
      /\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/g,
    ),
  };
}

export type AudioBoostPlan =
  | { action: "boost"; gainDb: number }
  | { action: "keep"; reason: "already-normal" | "silent" | "unmeasured" };

/** Decide whether, and by how much, to raise a clip's audio. */
export function planAudioBoost(
  measurement: LoudnessMeasurement,
): AudioBoostPlan {
  const lufs = measurement.integratedLufs;
  if (lufs === null) return { action: "keep", reason: "unmeasured" };
  if (lufs <= AUDIO_LEVEL_SILENCE_LUFS) {
    return { action: "keep", reason: "silent" };
  }
  if (lufs >= AUDIO_LEVEL_QUIET_THRESHOLD_LUFS) {
    return { action: "keep", reason: "already-normal" };
  }
  const gainDb = Math.min(
    AUDIO_LEVEL_TARGET_LUFS - lufs,
    AUDIO_LEVEL_MAX_GAIN_DB,
  );
  if (gainDb < AUDIO_LEVEL_MIN_GAIN_DB) {
    return { action: "keep", reason: "already-normal" };
  }
  return { action: "boost", gainDb: Math.round(gainDb * 10) / 10 };
}

export function buildMeasureArgs(inputPath: string): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-nostdin",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-af",
    "ebur128=peak=sample",
    "-f",
    "null",
    "-",
  ];
}

export function buildBoostArgs(input: {
  inputPath: string;
  outputPath: string;
  gainDb: number;
  format: "mp4" | "webm";
}): string[] {
  // `level=0`: alimiter otherwise auto-levels its output and undoes the gain.
  const filter = `volume=${input.gainDb}dB,alimiter=limit=${AUDIO_LEVEL_LIMIT}:level=0`;
  const audioCodec =
    input.format === "mp4"
      ? ["-c:a", "aac", "-b:a", "160k"]
      : ["-c:a", "libopus", "-b:a", "128k"];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input.inputPath,
    "-map",
    "0:v?",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-af",
    filter,
    ...audioCodec,
    ...(input.format === "mp4" ? ["-movflags", "+faststart"] : []),
    "-f",
    input.format,
    input.outputPath,
  ];
}

async function runFfmpegCapturingStderr(
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // observed-write-ok: ffmpeg only reads/writes files in a private temp dir.
    const child = spawn(resolveFfmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg audio level timed out\n${stderr}`));
    }, timeoutMs);
    timeout.unref();
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`${err.message}\n${stderr}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
    });
  });
}

export interface ProbedFile {
  durationMs: number | null;
  hasAudio: boolean;
  audioStreams: number;
}

/** Read duration and audio presence from `ffmpeg -i` output. */
export function parseFfmpegInputInfo(stderr: string): ProbedFile {
  const match = /Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationMs =
    match && match[1] && match[2] && match[3]
      ? Math.round(
          (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
            1000,
        )
      : null;
  return {
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr),
    audioStreams: (stderr.match(/Stream #\d+:\d+[^\n]*: Audio:/g) ?? []).length,
  };
}

/**
 * Probe a file on disk. `ffmpeg -i` with no output exits non-zero by design,
 * so the stream summary is read from stderr whatever the exit code.
 */
async function probeFile(path: string): Promise<ProbedFile> {
  const stderr = await new Promise<string>((resolve, reject) => {
    // observed-write-ok: read-only probe, ffmpeg writes no output file.
    const child = spawn(resolveFfmpegCommand(), ["-hide_banner", "-i", path], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let text = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg probe timed out"));
    }, 60_000);
    timeout.unref();
    child.stderr.on("data", (chunk: Buffer) => {
      text = (text + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(text);
    });
  });
  return parseFfmpegInputInfo(stderr);
}

/** Measure a media file's integrated loudness and sample peak. */
export async function measureLoudness(
  inputPath: string,
): Promise<LoudnessMeasurement> {
  const stderr = await runFfmpegCapturingStderr(
    buildMeasureArgs(inputPath),
    MEASURE_TIMEOUT_MS,
  );
  return parseEbur128Summary(stderr);
}

/**
 * Raise the audio of `mediaBytes` when it is quiet. Returns the new bytes, or
 * null with the reason when the clip keeps its original audio.
 */
export async function boostQuietAudio(input: {
  mediaBytes: Uint8Array;
  format: "mp4" | "webm";
}): Promise<
  | {
      changed: true;
      bytes: Uint8Array;
      measurement: LoudnessMeasurement;
      gainDb: number;
    }
  | {
      changed: false;
      measurement: LoudnessMeasurement | null;
      reason:
        | "already-normal"
        | "silent"
        | "unmeasured"
        | "boost-failed"
        | "multiple-audio";
      detail?: string;
    }
> {
  // observed-write-ok: private temp dir, removed in `finally`.
  const dir = await mkdtemp(join(tmpdir(), "clips-audio-level-"));
  const inputPath = join(dir, `input.${input.format}`);
  const outputPath = join(dir, `output.${input.format}`);
  try {
    // observed-write-ok: temp input file for ffmpeg.
    await writeFile(inputPath, input.mediaBytes);
    // The re-encode keeps one audio stream. A file with several (separate
    // mic and system tracks, alternate languages) would lose the others.
    const source = await probeFile(inputPath);
    if (source.audioStreams > 1) {
      return { changed: false, measurement: null, reason: "multiple-audio" };
    }
    const measurement = await measureLoudness(inputPath);
    const plan = planAudioBoost(measurement);
    if (plan.action === "keep") {
      return { changed: false, measurement, reason: plan.reason };
    }
    try {
      await runFfmpegCapturingStderr(
        buildBoostArgs({
          inputPath,
          outputPath,
          gainDb: plan.gainDb,
          format: input.format,
        }),
        BOOST_TIMEOUT_MS,
      );
    } catch (err) {
      return {
        changed: false,
        measurement,
        reason: "boost-failed",
        detail: err instanceof Error ? err.message.slice(0, 500) : String(err),
      };
    }
    const before = source;
    const after = await probeFile(outputPath);
    const durationDrift =
      before.durationMs !== null && after.durationMs !== null
        ? Math.abs(before.durationMs - after.durationMs)
        : null;
    if (
      !after.hasAudio ||
      durationDrift === null ||
      durationDrift > DURATION_TOLERANCE_MS
    ) {
      return {
        changed: false,
        measurement,
        reason: "boost-failed",
        detail: `Boosted file failed verification (audio=${String(after.hasAudio)}, durationDriftMs=${String(durationDrift)}).`,
      };
    }
    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) {
      return {
        changed: false,
        measurement,
        reason: "boost-failed",
        detail: "Boosted file is empty.",
      };
    }
    return { changed: true, bytes, measurement, gainDb: plan.gainDb };
  } finally {
    // observed-write-ok: removes the private temp dir created above.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function audioLevelPendingUploadKey(recordingId: string): string {
  return `recording-audio-level-pending-upload-${recordingId}`;
}

/**
 * An upload whose row update failed in an unclear way. It is not deleted at
 * the time, because the update may still commit. The next run, once the row
 * can be read, deletes it if the row does not point at it.
 */
async function cleanUpPendingUpload(rec: {
  id: string;
  videoUrl: string | null;
  storageMode: "own" | "hosted" | null;
}): Promise<void> {
  const key = audioLevelPendingUploadKey(rec.id);
  const raw = await readAppState(key).catch(() => null);
  const url =
    raw &&
    typeof raw === "object" &&
    typeof (raw as { url?: unknown }).url === "string"
      ? (raw as { url: string }).url
      : null;
  if (!url) return;
  if (url !== rec.videoUrl) {
    const cleanup = await deleteRecordingMediaObjects(
      { id: rec.id, storageMode: rec.storageMode, videoUrl: url },
      { protectedUrls: rec.videoUrl ? [rec.videoUrl] : [] },
    ).catch((err: unknown) => {
      console.warn("[audio-level] could not delete a pending upload", {
        recordingId: rec.id,
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (!cleanup || cleanup.errors.length > 0) return;
  }
  await deleteAppState(key).catch(() => {});
}

export function audioLevelMarkerKey(recordingId: string): string {
  return `recording-audio-level-${recordingId}`;
}

interface AudioLevelMarker {
  videoUrl: string | null;
  mediaUpdatedAt: string | null;
}

async function readMarker(recordingId: string): Promise<AudioLevelMarker> {
  const raw = await readAppState(audioLevelMarkerKey(recordingId)).catch(
    () => null,
  );
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    videoUrl: typeof record.videoUrl === "string" ? record.videoUrl : null,
    mediaUpdatedAt:
      typeof record.mediaUpdatedAt === "string" ? record.mediaUpdatedAt : null,
  };
}

async function writeMarker(input: {
  recordingId: string;
  videoUrl: string;
  mediaUpdatedAt: string;
  status: AudioLevelStatus;
  integratedLufs: number | null;
  gainDb?: number;
}): Promise<void> {
  await writeAppState(audioLevelMarkerKey(input.recordingId), {
    recordingId: input.recordingId,
    videoUrl: input.videoUrl,
    mediaUpdatedAt: input.mediaUpdatedAt,
    status: input.status,
    integratedLufs: input.integratedLufs,
    ...(input.gainDb !== undefined ? { gainDb: input.gainDb } : {}),
    at: new Date().toISOString(),
  });
}

/**
 * Level one recording's audio. Safe to call more than once: a marker keyed on
 * the current media skips clips that were already checked.
 */
export async function ensureRecordingAudioLevel(params: {
  recordingId: string;
  ownerEmail: string;
  force?: boolean;
}): Promise<AudioLevelResult> {
  const { recordingId, ownerEmail, force = false } = params;
  const db = getDb();
  const recRows = await db
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      kind: schema.recordings.kind,
      hasAudio: schema.recordings.hasAudio,
      videoUrl: schema.recordings.videoUrl,
      videoFormat: schema.recordings.videoFormat,
      storageMode: schema.recordings.storageMode,
      sourceAppName: schema.recordings.sourceAppName,
      mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
      videoSizeBytes: schema.recordings.videoSizeBytes,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  const rec = itemAt(recRows, 0);
  if (!rec) return { recordingId, status: "not-found", changed: false };
  if (rec.status !== "ready") {
    return { recordingId, status: "skipped-not-ready", changed: false };
  }
  if (!rec.hasAudio) {
    return { recordingId, status: "skipped-no-audio", changed: false };
  }
  if (isLoomRecordingSource(rec) || isYouTubeEmbedBackedRecording(rec)) {
    return { recordingId, status: "skipped-local-media", changed: false };
  }
  if (!rec.videoUrl) {
    return { recordingId, status: "skipped-no-media", changed: false };
  }
  if (!isRemoteProviderUrl(rec.videoUrl)) {
    return { recordingId, status: "skipped-local-media", changed: false };
  }
  if (rec.videoSizeBytes > AUDIO_LEVEL_MAX_BYTES) {
    return { recordingId, status: "skipped-too-large", changed: false };
  }
  await cleanUpPendingUpload(rec);
  if (!isFfmpegAvailable()) {
    return { recordingId, status: "skipped-no-ffmpeg", changed: false };
  }
  if (!force) {
    const marker = await readMarker(recordingId);
    if (
      marker.videoUrl === rec.videoUrl &&
      marker.mediaUpdatedAt === rec.mediaUpdatedAt
    ) {
      return { recordingId, status: "already-normal", changed: false };
    }
  }

  const fetched = await fetchProviderBytes(rec.videoUrl, {
    recordingId,
    storageMode: rec.storageMode,
  });
  if (!fetched.ok) {
    return { recordingId, status: fetched.reason, changed: false };
  }

  // The stored size can be stale, so the cap is checked on the real bytes too.
  if (fetched.bytes.byteLength > AUDIO_LEVEL_MAX_BYTES) {
    return { recordingId, status: "skipped-too-large", changed: false };
  }
  const format = rec.videoFormat === "mp4" ? "mp4" : "webm";
  const leveled = await withRemuxSlot(() =>
    boostQuietAudio({ mediaBytes: fetched.bytes, format }),
  ).catch((err: unknown) => ({
    changed: false as const,
    measurement: null,
    reason: "unmeasured" as const,
    detail: err instanceof Error ? err.message.slice(0, 500) : String(err),
  }));

  if (!leveled.changed) {
    const integratedLufs = leveled.measurement?.integratedLufs ?? null;
    if (
      leveled.reason === "already-normal" ||
      leveled.reason === "silent" ||
      leveled.reason === "multiple-audio"
    ) {
      const status: AudioLevelStatus =
        leveled.reason === "silent"
          ? "silent"
          : leveled.reason === "multiple-audio"
            ? "skipped-multiple-audio"
            : "already-normal";
      await writeMarker({
        recordingId,
        videoUrl: rec.videoUrl,
        mediaUpdatedAt: rec.mediaUpdatedAt,
        status,
        integratedLufs,
      });
      return { recordingId, status, changed: false, integratedLufs };
    }
    return {
      recordingId,
      status:
        leveled.reason === "boost-failed"
          ? "skipped-boost-failed"
          : "skipped-measure-failed",
      changed: false,
      integratedLufs,
      ...("detail" in leveled && leveled.detail
        ? { detail: leveled.detail }
        : {}),
    };
  }

  // The clip may have been replaced (re-upload, edit burn-in) while ffmpeg ran.
  const currentRows = await db
    .select({
      videoUrl: schema.recordings.videoUrl,
      mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId));
  const current = itemAt(currentRows, 0);
  if (
    current?.videoUrl !== rec.videoUrl ||
    current.mediaUpdatedAt !== rec.mediaUpdatedAt
  ) {
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      integratedLufs: leveled.measurement.integratedLufs,
      detail: "Recording media changed while the audio was being leveled.",
    };
  }

  const mimeType = format === "mp4" ? "video/mp4" : "video/webm";
  const upload = await uploadRecordingMedia({
    recordingId,
    data: leveled.bytes,
    filename: `${recordingId}.${format}`,
    mimeType,
    ownerEmail,
    // A new object, never an overwrite: the compare-and-swap below may still
    // reject this run, and a stable key would already have replaced newer media.
    stableUrl: false,
    recordAsset: false,
  }).catch((err: unknown) => {
    console.warn("[audio-level] leveled media upload failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!upload?.url) {
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      integratedLufs: leveled.measurement.integratedLufs,
    };
  }

  // `mediaUpdatedAt` is left as it is on purpose. Leveling keeps every frame
  // and every word at the same time, so transcripts, chapters and comments
  // made from the clip stay valid; bumping it would make an in-flight
  // transcript reject its own write. Playback is not cached (`/api/video`
  // answers no-store), and own storage hands back a new URL anyway.
  let updated: { videoUrl: string | null }[];
  try {
    updated = await db
      .update(schema.recordings)
      .set({
        videoUrl: upload.url,
        videoSizeBytes: leveled.bytes.byteLength,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.videoUrl, rec.videoUrl),
          eq(schema.recordings.mediaUpdatedAt, rec.mediaUpdatedAt),
        ),
      )
      .returning({ videoUrl: schema.recordings.videoUrl });
  } catch (err) {
    // The update may still commit after this error, so the upload is not
    // deleted now. It is saved as pending; the next run deletes it once the
    // row shows it is not in use.
    await writeAppState(audioLevelPendingUploadKey(recordingId), {
      recordingId,
      url: upload.url,
      at: new Date().toISOString(),
    }).catch((stateErr: unknown) => {
      console.warn("[audio-level] could not save the pending upload", {
        recordingId,
        uploadedUrl: upload.url,
        error: stateErr instanceof Error ? stateErr.message : String(stateErr),
      });
    });
    throw err;
  }

  if (updated.length !== 1 || updated[0]?.videoUrl !== upload.url) {
    await deleteRecordingMediaObjects(
      { id: recordingId, storageMode: rec.storageMode, videoUrl: upload.url },
      { protectedUrls: [rec.videoUrl] },
    );
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      integratedLufs: leveled.measurement.integratedLufs,
      detail: "Recording changed while the leveled media was uploading.",
    };
  }

  // The leveled file is live at this point. A failed cleanup of the replaced
  // original does not undo that, so it is reported in the result and the log
  // instead of turning the run into a failure.
  let replacedOriginalDeleted = true;
  if (upload.url !== rec.videoUrl) {
    // Own storage hands back a new key, so the quiet original would otherwise
    // stay in the bucket with nothing pointing at it.
    if (rec.storageMode === "hosted") {
      replacedOriginalDeleted = await deleteSupersededHostedMedia(
        rec.videoUrl,
        { recordingId, replacementUrl: upload.url },
      );
    } else {
      replacedOriginalDeleted = await deleteStoredMediaUrl(rec.videoUrl, {
        recordingId,
        storageMode: rec.storageMode,
      }).catch((err: unknown) => {
        console.warn("[audio-level] deleting the replaced media failed", {
          recordingId,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      });
      if (!replacedOriginalDeleted) {
        console.warn(
          "[audio-level] could not confirm deletion of the replaced media",
          { recordingId, replacedUrl: rec.videoUrl },
        );
      }
    }
  }
  // The row already points at the leveled file. These writes only save work
  // and nudge open pages, so a failure is logged instead of undoing a
  // successful run.
  await writeMarker({
    recordingId,
    videoUrl: upload.url,
    mediaUpdatedAt: rec.mediaUpdatedAt,
    status: "boosted",
    integratedLufs: leveled.measurement.integratedLufs,
    gainDb: leveled.gainDb,
  }).catch((err: unknown) => {
    console.warn("[audio-level] could not save the leveled marker", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await writeAppState("refresh-signal", { ts: Date.now() }).catch(
    (err: unknown) => {
      console.warn("[audio-level] could not signal a refresh", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );
  console.log("[audio-level] raised quiet recording audio", {
    recordingId,
    integratedLufs: leveled.measurement.integratedLufs,
    gainDb: leveled.gainDb,
  });
  return {
    recordingId,
    status: "boosted",
    changed: true,
    integratedLufs: leveled.measurement.integratedLufs,
    gainDb: leveled.gainDb,
    ...(replacedOriginalDeleted
      ? {}
      : {
          detail:
            "Audio leveled, but deleting the replaced original file could not be confirmed.",
        }),
  };
}
