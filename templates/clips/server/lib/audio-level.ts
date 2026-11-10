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
  deleteSupersededHostedMedia,
} from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import { uploadRecordingMedia } from "./upload-recording-media.js";
import {
  isFfmpegAvailable,
  probeHasAudioStream,
  probeMediaInfo,
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
  | "skipped-upload-failed"
  | "not-found";

export interface AudioLevelResult {
  recordingId: string;
  status: AudioLevelStatus;
  changed: boolean;
  integratedLufs?: number | null;
  gainDb?: number;
  detail?: string;
}

function lastNumberAfter(text: string, label: RegExp): number | null {
  let value: number | null = null;
  for (const match of text.matchAll(label)) {
    const raw = match[1];
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
    child.stderr?.on("data", (chunk: Buffer) => {
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
      reason: "already-normal" | "silent" | "unmeasured" | "boost-failed";
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
    const bytes = new Uint8Array(await readFile(outputPath));
    const [hasAudio, before, after] = await Promise.all([
      probeHasAudioStream(bytes, input.format),
      probeMediaInfo(input.mediaBytes, input.format),
      probeMediaInfo(bytes, input.format),
    ]);
    const durationDrift =
      before.durationMs !== null && after.durationMs !== null
        ? Math.abs(before.durationMs - after.durationMs)
        : 0;
    if (
      hasAudio === false ||
      bytes.byteLength === 0 ||
      durationDrift > DURATION_TOLERANCE_MS
    ) {
      return {
        changed: false,
        measurement,
        reason: "boost-failed",
        detail: `Boosted file failed verification (audio=${String(hasAudio)}, durationDriftMs=${durationDrift}).`,
      };
    }
    return { changed: true, bytes, measurement, gainDb: plan.gainDb };
  } finally {
    // observed-write-ok: removes the private temp dir created above.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
  const [rec] = await db
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
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

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
    if (leveled.reason === "already-normal" || leveled.reason === "silent") {
      const status: AudioLevelStatus =
        leveled.reason === "silent" ? "silent" : "already-normal";
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
  const [current] = await db
    .select({
      videoUrl: schema.recordings.videoUrl,
      mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId));
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
    stableUrl: true,
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

  const now = new Date().toISOString();
  const updated = await db
    .update(schema.recordings)
    .set({
      videoUrl: upload.url,
      videoSizeBytes: leveled.bytes.byteLength,
      mediaUpdatedAt: now,
      updatedAt: now,
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

  if (rec.storageMode === "hosted" && upload.url !== rec.videoUrl) {
    await deleteSupersededHostedMedia(rec.videoUrl, {
      recordingId,
      replacementUrl: upload.url,
    });
  }
  await writeMarker({
    recordingId,
    videoUrl: upload.url,
    mediaUpdatedAt: now,
    status: "boosted",
    integratedLufs: leveled.measurement.integratedLufs,
    gainDb: leveled.gainDb,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
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
  };
}
