import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  waitForAcceptedRecordingAfterFinalizeError,
  waitForReadyRecordingAfterFinalizeError,
} from "../../../shared/finalize-recovery";
import { classifyUploadResponseError } from "../../../shared/recording-core";
import type { LocalRecordingMode } from "../shared/config";
import { createAudioCue, type AudioCue } from "./audio-cue";
import { createCameraCompositeStream } from "./camera-composite";
import { finalizeAfterDurableBackup } from "./finalization-guard";
import {
  createLocalRecordingFolderName,
  exportBlobChunksToLocalRecordingFile,
  prepareLocalRecordingExport,
  type LocalBlobExportResult,
  type LocalRecordingExportHandle,
  type LocalExportedFile,
  type LocalRecordingTarget,
} from "./local-export";
import {
  buildDesktopDisplayMediaOptions,
  getAudioStreamWithFallback,
  getCameraStreamWithFallback,
  shouldRequestSystemAudio,
} from "./media-capture-constraints";
import { planNativeFullscreenWarmOverlap } from "./native-recording-warm";
import {
  createPauseTransitionQueue,
  type PauseTransitionQueue,
} from "./pause-transition";
import { reconcileProcessingBackup } from "./processing-backup-recovery";
import {
  buildCreateRecordingRequestHeaders,
  buildCreateRecordingRequestBody,
  RECORDING_SERVER_UNAVAILABLE,
  RECORDING_SESSION_EXPIRED,
  isStorageSetupFailureMessage,
  type NativeRecordingRequestOptions,
} from "./recording-request";
import {
  boundedCleanup,
  guardRecordingStart,
  RECORDING_START_TIMEOUT_MS,
  RecordingStartCancelledError,
} from "./recording-start-guard";
import { buildCaptureTitle, type CaptureTitleResult } from "./recording-title";
import { prepareRewindRecordingStart } from "./rewind-recording-start";
import { singleFlight } from "./single-flight";
import {
  startTranscriptionCapture,
  shouldStartLocalRecordingTranscription,
  type CapturedTranscript,
  type TranscriptionCapture,
} from "./transcription-capture";
import {
  buildStreamingReplayPlan,
  planStreamingRecovery,
  retryAttemptIdAfterRestartSignal,
  retryAttemptIdAfterResumeResponse,
  retryConflictDelay,
  type UploadResumeResponse,
} from "./upload-recovery";
import {
  parseFinalizeReceipt,
  verifyFinalizeReceipt,
  type FinalizeReceipt,
} from "./upload-verification";
import { shouldResampleVideoForUpload } from "./upload-video-stream";

export type { LocalExportedFile } from "./local-export";
export { planNativeFullscreenWarmOverlap } from "./native-recording-warm";

export type CaptureMode = "screen" | "screen-camera" | "camera";
export type CaptureSource = "full-screen" | "window" | "region";

export interface RegionCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NATIVE_FULLSCREEN_RECORDING_FLAG = "clips:native-fullscreen-recording";
const DEV_SYNTHETIC_CAPTURE_FLAG = "clips:dev-synthetic-capture";
const LEGACY_DEV_REAL_CAPTURE_FLAG = "clips:dev-real-capture";
const LIVE_UPLOAD_CHUNK_MS = 2_000;
const NATIVE_FULLSCREEN_SEGMENT_MS = 5 * 60_000;
const NATIVE_FULLSCREEN_MIME_TYPE = "video/mp4";
const MEDIA_RECORDER_STOP_TIMEOUT_MS = 15_000;
const GCS_CHUNK_ALIGN_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 15 * GCS_CHUNK_ALIGN_BYTES;

type UploadMode = "streaming" | "buffered";
const CLOUD_CAPTURE_FRAME_RATE = 24;
const CLOUD_CAPTURE_MAX_WIDTH = 1920;
const CLOUD_CAPTURE_MAX_HEIGHT = 1080;
const CLOUD_RECORDING_MAX_LONG_EDGE = 1920;
const CLOUD_RECORDING_VIDEO_BITRATE_BPS = 8_000_000;
const CLOUD_RECORDING_AUDIO_BITRATE_BPS = 128_000;
const TRANSCRIPT_SAVE_TIMEOUT_MS = 8_000;
const FINALIZING_RESULT_STORAGE_KEY = "clips-finalizing-result";
const NO_SPEECH_TRANSCRIPT_FAILURE =
  "No speech was captured during this recording. If you spoke or played system audio, check System Audio, Microphone input, Speech Recognition permission, and the selected mic, then retry transcription.";
const TRANSCRIPTION_START_FAILURE =
  "macOS Speech recognition could not start for this recording. Check Speech Recognition, System Audio, and Microphone permissions, then retry transcription.";

function throwIfRecordingStartAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RecordingStartCancelledError();
}

function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // coercion-ok: stopping an already-ended capture track is best-effort cleanup.
    }
  });
}

function startBrowserMicLevelEmitter(stream: MediaStream): () => void {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return () => {};

  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    return () => {};
  }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const data = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  void context.resume().catch(() => {});

  let stopped = false;
  let frame = 0;
  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    emit("voice:audio-level", {
      level: Math.min(1, Math.sqrt(sum / data.length) * 2),
      source: "mic",
    }).catch(() => {});
    frame = window.requestAnimationFrame(tick);
  };
  frame = window.requestAnimationFrame(tick);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    source.disconnect();
    analyser.disconnect();
    void context.close().catch(() => {});
  };
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return /mac/i.test(platform);
}

export function shouldUseNativeFullscreenRecording(
  source: CaptureSource | undefined,
): boolean {
  if (source !== "full-screen" && source !== "region") return false;
  if (typeof localStorage === "undefined") return false;
  const saved = localStorage.getItem(NATIVE_FULLSCREEN_RECORDING_FLAG);
  if (saved !== null) {
    return saved === "1" || saved === "true";
  }
  return isMacPlatform();
}

export function shouldUseNativeWindowRecording(
  source: CaptureSource | undefined,
): boolean {
  return source === "window" && isMacPlatform();
}

function shouldSaveLocalTranscriptionStartupFailure(): boolean {
  return isMacPlatform();
}

function shouldUseDevSyntheticCapture(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof localStorage === "undefined") return false;

  const synthetic = localStorage.getItem(DEV_SYNTHETIC_CAPTURE_FLAG);
  if (synthetic !== null) {
    return synthetic === "1" || synthetic === "true";
  }

  const legacyRealCapture = localStorage.getItem(LEGACY_DEV_REAL_CAPTURE_FLAG);
  return legacyRealCapture === "0" || legacyRealCapture === "false";
}

export interface StartParams {
  serverUrl: string;
  mode: CaptureMode;
  source?: CaptureSource;
  cameraId?: string;
  micId?: string;
  micLabel?: string;
  authToken?: string;
  cookie?: string;
  micOn: boolean;
  cameraOn: boolean;
  systemAudioOn?: boolean;
  voiceCleanupEnabled?: boolean;
  signal?: AbortSignal;
  localRecordingMode?: LocalRecordingMode;
  preAcquiredCameraStream?: MediaStream | null;
  preAcquiredDisplayStream?: MediaStream | null;
  preAcquiredAudioStream?: MediaStream | null;
  preAcquiredCaptureSuspension?: RewindCaptureSuspensionLease | null;
  pendingTranscriptionTeardown?: Promise<void> | null;
}

const REWIND_CLIP_ORIGINS_KEY = "clips.rewindClipOrigins.v1";

export interface RewindClipOrigin {
  recordingId: string;
  startedAt: string;
  includeMicrophone: boolean;
  includeSystemAudio: boolean;
  rememberedAt: string;
}

function readRewindClipOrigins(): Record<string, RewindClipOrigin> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(REWIND_CLIP_ORIGINS_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRewindClipOrigins(
  origins: Record<string, RewindClipOrigin>,
): void {
  try {
    localStorage.setItem(REWIND_CLIP_ORIGINS_KEY, JSON.stringify(origins));
  } catch {
    // Losing optional retrospective metadata must never cancel a live Clip.
  }
}

function rememberRewindClipOrigin(origin: RewindClipOrigin): void {
  const origins = readRewindClipOrigins();
  origins[origin.recordingId] = origin;
  const newest = Object.values(origins)
    .sort((left, right) => right.rememberedAt.localeCompare(left.rememberedAt))
    .slice(0, 50);
  writeRewindClipOrigins(
    Object.fromEntries(newest.map((entry) => [entry.recordingId, entry])),
  );
}

export function getRewindClipOrigin(
  recordingId: string,
): RewindClipOrigin | null {
  return readRewindClipOrigins()[recordingId] ?? null;
}

export function forgetRewindClipOrigin(recordingId: string): void {
  const origins = readRewindClipOrigins();
  if (!origins[recordingId]) return;
  delete origins[recordingId];
  writeRewindClipOrigins(origins);
}

export const RESTART_CAPTURE_ENDED_MESSAGE =
  "Screen sharing ended — start a new recording.";

export interface RestartHandoff {
  displayStream: MediaStream | null;
  audioStream: MediaStream | null;
  transcriptionTornDown?: Promise<void> | null;
}

export interface RecorderHandle {
  stop(): Promise<RecorderStopResult>;
  cancel(): Promise<void>;
  discardForRestart(): Promise<RestartHandoff>;
}

export interface RecorderStopResult {
  recordingId: string;
  viewUrl: string;
  localOnly?: boolean;
  localFolder?: string;
  localFiles?: LocalExportedFile[];
}

export interface PendingBrowserRecordingUpload {
  kind: "browser";
  recordingId: string;
  serverUrl: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  bytes: number;
  hasAudio: boolean;
  hasCamera: boolean;
  savedAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  retryCount: number;
  chunkCount: number;
  mimeType: string;
  uploadAttemptId?: string | null;
}

function streamFromTracks(tracks: MediaStreamTrack[]): MediaStream {
  const stream = new MediaStream();
  tracks.forEach((track) => stream.addTrack(track));
  return stream;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function scaledVideoDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  const scale = Math.min(1, CLOUD_RECORDING_MAX_LONG_EDGE / longSide);
  return {
    width: evenDimension(width * scale),
    height: evenDimension(height * scale),
  };
}

function videoTrackDimensions(stream: MediaStream): {
  width: number | null;
  height: number | null;
} {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return {
    width: positiveNumber(settings?.width) ? Math.round(settings.width) : null,
    height: positiveNumber(settings?.height)
      ? Math.round(settings.height)
      : null,
  };
}

interface UploadOptimizedVideoStream {
  stream: MediaStream;
  cleanup(): void;
}

function createUploadOptimizedVideoStream(
  source: MediaStream,
): UploadOptimizedVideoStream {
  const sourceTrack = source.getVideoTracks()[0];
  if (
    !sourceTrack ||
    typeof document === "undefined" ||
    typeof document.createElement !== "function"
  ) {
    return { stream: source, cleanup() {} };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx || typeof canvas.captureStream !== "function") {
    return { stream: source, cleanup() {} };
  }

  const sourceSize = videoTrackDimensions(source);
  if (
    !shouldResampleVideoForUpload(sourceSize, CLOUD_RECORDING_MAX_LONG_EDGE)
  ) {
    return { stream: source, cleanup() {} };
  }
  const initial = scaledVideoDimensions(
    sourceSize.width ?? 1280,
    sourceSize.height ?? 720,
  );
  canvas.width = initial.width;
  canvas.height = initial.height;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = source;
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  const play = () => video.play().catch(() => undefined);
  video.addEventListener("loadedmetadata", play);
  void play();

  const resizeCanvas = () => {
    const width = positiveNumber(video.videoWidth)
      ? video.videoWidth
      : (videoTrackDimensions(source).width ?? canvas.width);
    const height = positiveNumber(video.videoHeight)
      ? video.videoHeight
      : (videoTrackDimensions(source).height ?? canvas.height);
    const next = scaledVideoDimensions(width, height);
    if (canvas.width !== next.width) canvas.width = next.width;
    if (canvas.height !== next.height) canvas.height = next.height;
  };

  const draw = () => {
    resizeCanvas();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      // Source metadata may not be ready for the first tick.
    }
  };

  const stream = canvas.captureStream(CLOUD_CAPTURE_FRAME_RATE);
  const interval = window.setInterval(
    draw,
    Math.round(1000 / CLOUD_CAPTURE_FRAME_RATE),
  );
  draw();

  return {
    stream,
    cleanup() {
      window.clearInterval(interval);
      stream.getTracks().forEach((track) => track.stop());
      video.removeEventListener("loadedmetadata", play);
      video.pause();
      video.srcObject = null;
      video.remove();
    },
  };
}

function mediaRecorderOptions(
  mimeType: string,
  includeBitrateBudget: boolean,
): MediaRecorderOptions | undefined {
  const options: MediaRecorderOptions = {};
  if (mimeType) options.mimeType = mimeType;
  if (includeBitrateBudget) {
    options.videoBitsPerSecond = CLOUD_RECORDING_VIDEO_BITRATE_BPS;
    options.audioBitsPerSecond = CLOUD_RECORDING_AUDIO_BITRATE_BPS;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function createCloudMediaRecorder(
  stream: MediaStream,
  mimeType: string,
): MediaRecorder {
  let lastError: unknown = null;
  for (const includeBitrateBudget of [true, false]) {
    try {
      return new MediaRecorder(
        stream,
        mediaRecorderOptions(mimeType, includeBitrateBudget),
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface RecordingAudio {
  tracks: MediaStreamTrack[];
  cleanup: () => void;
}

function buildRecordingAudio(
  micTracks: MediaStreamTrack[],
  systemTracks: MediaStreamTrack[],
): RecordingAudio {
  if (!micTracks.length) {
    return {
      tracks: systemTracks,
      cleanup() {},
    };
  }
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    return { tracks: micTracks, cleanup() {} };
  }
  const ctx: AudioContext = new AudioCtx();
  const destination = ctx.createMediaStreamDestination();
  for (const tracks of [micTracks, systemTracks]) {
    if (!tracks.length) continue;
    ctx.createMediaStreamSource(new MediaStream(tracks)).connect(destination);
  }
  return {
    tracks: destination.stream.getAudioTracks(),
    cleanup() {
      ctx.close().catch(() => {});
    },
  };
}

function localRecordingTargetsForMode({
  localRecordingMode,
  displayStream,
  bubbleCameraStream,
  recordingAudio,
  combined,
}: {
  localRecordingMode: Exclude<LocalRecordingMode, "off">;
  displayStream: MediaStream | null;
  bubbleCameraStream: MediaStream | null;
  recordingAudio: RecordingAudio;
  combined: MediaStream;
}): LocalRecordingTarget[] {
  if (localRecordingMode === "composed") {
    return [{ role: "composed", stream: combined }];
  }

  const targets: LocalRecordingTarget[] = [];
  if (displayStream) {
    const desktopTracks = [
      ...displayStream.getVideoTracks(),
      ...recordingAudio.tracks,
    ];
    targets.push({
      role: "desktop",
      stream: streamFromTracks(desktopTracks),
    });
  }
  if (bubbleCameraStream) {
    targets.push({
      role: "camera",
      stream: streamFromTracks(bubbleCameraStream.getVideoTracks()),
    });
  }
  return targets;
}

interface BrowserRecordingBackupMeta extends Omit<
  PendingBrowserRecordingUpload,
  "kind"
> {}

interface BrowserRecordingBackupChunk {
  recordingId: string;
  index: number;
  blob: Blob;
  bytes: number;
  mimeType: string;
  createdAt: string;
}

function chunkUrl(
  serverUrl: string,
  id: string,
  idx: number,
  isFinal: boolean,
  extras: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    index: String(idx),
    total: String(idx + 1),
    isFinal: isFinal ? "1" : "0",
    ...extras,
  });
  return `${serverUrl.replace(/\/+$/, "")}/api/uploads/${id}/chunk?${params}`;
}

const BACKUP_DB_NAME = "clips-desktop-recording-backups";
const BACKUP_DB_VERSION = 1;
const BACKUP_META_STORE = "recordings";
const BACKUP_CHUNK_STORE = "chunks";

function backupDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openBackupDb(): Promise<IDBDatabase> {
  if (!backupDbAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BACKUP_META_STORE)) {
        db.createObjectStore(BACKUP_META_STORE, { keyPath: "recordingId" });
      }
      if (!db.objectStoreNames.contains(BACKUP_CHUNK_STORE)) {
        const chunks = db.createObjectStore(BACKUP_CHUNK_STORE, {
          keyPath: ["recordingId", "index"],
        });
        chunks.createIndex("recordingId", "recordingId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open recording backups"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Recording backup transaction aborted"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("Recording backup transaction failed"));
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Recording backup request failed"));
  });
}

async function putBrowserRecordingBackupMeta(
  meta: BrowserRecordingBackupMeta,
): Promise<void> {
  const db = await openBackupDb();
  try {
    const tx = db.transaction(BACKUP_META_STORE, "readwrite");
    tx.objectStore(BACKUP_META_STORE).put(meta);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

async function getBrowserRecordingBackupMeta(
  recordingId: string,
): Promise<BrowserRecordingBackupMeta | null> {
  const db = await openBackupDb();
  try {
    const tx = db.transaction(BACKUP_META_STORE, "readonly");
    const result = await waitForRequest<BrowserRecordingBackupMeta | undefined>(
      tx.objectStore(BACKUP_META_STORE).get(recordingId),
    );
    await waitForTransaction(tx);
    return result ?? null;
  } finally {
    db.close();
  }
}

async function putBrowserRecordingBackupChunk(
  chunk: BrowserRecordingBackupChunk,
): Promise<void> {
  const db = await openBackupDb();
  try {
    const tx = db.transaction(BACKUP_CHUNK_STORE, "readwrite");
    tx.objectStore(BACKUP_CHUNK_STORE).put(chunk);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

async function getBrowserRecordingBackupChunks(
  recordingId: string,
): Promise<BrowserRecordingBackupChunk[]> {
  const db = await openBackupDb();
  try {
    const tx = db.transaction(BACKUP_CHUNK_STORE, "readonly");
    const chunks = await waitForRequest<BrowserRecordingBackupChunk[]>(
      tx
        .objectStore(BACKUP_CHUNK_STORE)
        .index("recordingId")
        .getAll(recordingId),
    );
    await waitForTransaction(tx);
    return chunks.sort((a, b) => a.index - b.index);
  } finally {
    db.close();
  }
}

function validateBrowserRecordingBackupChunks(
  meta: BrowserRecordingBackupMeta,
  chunks: BrowserRecordingBackupChunk[],
): BrowserRecordingBackupChunk[] {
  if (chunks.length === 0) {
    throw new Error("Local recording backup has no chunks");
  }

  if (!Number.isInteger(meta.chunkCount) || meta.chunkCount <= 0) {
    throw new Error("Local recording backup metadata has no chunk count");
  }
  const expectedCount = meta.chunkCount;
  if (chunks.length !== expectedCount) {
    throw new Error(
      `Local recording backup is incomplete: found ${chunks.length} of ${expectedCount} chunks`,
    );
  }

  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  let totalBytes = 0;
  for (let i = 0; i < expectedCount; i++) {
    const chunk = sorted[i];
    if (!chunk || chunk.index !== i) {
      throw new Error(`Local recording backup is missing chunk ${i}`);
    }
    const blobBytes = chunk.blob?.size ?? 0;
    if (blobBytes <= 0) {
      throw new Error(`Local recording backup chunk ${i} is empty`);
    }
    if (chunk.bytes !== blobBytes) {
      throw new Error(
        `Local recording backup chunk ${i} byte metadata is inconsistent`,
      );
    }
    totalBytes += blobBytes;
  }

  if (meta.bytes > 0 && totalBytes !== meta.bytes) {
    throw new Error(
      `Local recording backup byte total is inconsistent: found ${totalBytes} of ${meta.bytes} bytes`,
    );
  }

  return sorted;
}

async function deleteBrowserRecordingBackup(
  recordingId: string,
): Promise<void> {
  if (!backupDbAvailable()) return;
  const db = await openBackupDb();
  try {
    const tx = db.transaction(
      [BACKUP_META_STORE, BACKUP_CHUNK_STORE],
      "readwrite",
    );
    tx.objectStore(BACKUP_META_STORE).delete(recordingId);
    const chunkIndex = tx.objectStore(BACKUP_CHUNK_STORE).index("recordingId");
    const cursorRequest = chunkIndex.openCursor(IDBKeyRange.only(recordingId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function exportBrowserRecordingBackup(
  recordingId: string,
  folderName?: string,
): Promise<LocalBlobExportResult> {
  const meta = await getBrowserRecordingBackupMeta(recordingId);
  if (!meta) {
    throw new Error("Local recording backup not found");
  }
  const chunks = await getBrowserRecordingBackupChunks(recordingId);
  const validatedChunks = validateBrowserRecordingBackupChunks(meta, chunks);

  return exportBlobChunksToLocalRecordingFile({
    chunks: validatedChunks.map((chunk) => chunk.blob),
    role: "composed",
    mimeType: meta.mimeType || validatedChunks[0]?.mimeType || "video/webm",
    folderName,
    durationMs: meta.durationMs,
    width: meta.width,
    height: meta.height,
  });
}

export async function dismissBrowserRecordingBackup(
  recordingId: string,
): Promise<LocalBlobExportResult> {
  const safeRecordingId =
    recordingId.replace(/[^a-zA-Z0-9_-]/g, "") || `clip-${Date.now()}`;
  const exported = await exportBrowserRecordingBackup(
    recordingId,
    `Drafts/${safeRecordingId}`,
  );
  await deleteBrowserRecordingBackup(recordingId);
  return exported;
}

async function markBrowserRecordingBackupError(
  recordingId: string,
  error: string,
  incrementRetryCount = true,
): Promise<void> {
  const meta = await getBrowserRecordingBackupMeta(recordingId);
  if (!meta) return;
  await putBrowserRecordingBackupMeta({
    ...meta,
    lastAttemptAt: new Date().toISOString(),
    lastError: error,
    retryCount: incrementRetryCount ? meta.retryCount + 1 : meta.retryCount,
  });
}

const MEDIA_VERIFICATION_BACKUP_ERROR =
  "The server could not finish verifying this upload. The local copy is still saved; retry to continue.";

async function flagBrowserBackupAfterProcessing(recordingId: string) {
  await markBrowserRecordingBackupError(
    recordingId,
    MEDIA_VERIFICATION_BACKUP_ERROR,
    false,
  );
  await emit("clips:pending-uploads-changed").catch(() => {});
}

async function flagNativeBackupAfterProcessing(recordingId: string) {
  await invoke("native_fullscreen_recording_mark_upload_error", {
    recordingId,
    error: MEDIA_VERIFICATION_BACKUP_ERROR,
  });
}

function scheduleBrowserBackupCleanupAfterProcessing(args: {
  serverUrl: string;
  recordingId: string;
  authToken?: string;
}): void {
  void reconcileProcessingBackup({
    waitForReady: () =>
      waitForReadyRecordingAfterFinalizeError({
        uploadUrl: chunkUrl(args.serverUrl, args.recordingId, 0, false),
        recordingId: args.recordingId,
        authToken: args.authToken,
        preferAuthenticated: true,
        timeoutMs: 12 * 60 * 1000,
      }),
    onReady: () => deleteBrowserRecordingBackup(args.recordingId),
    onUnresolved: () => flagBrowserBackupAfterProcessing(args.recordingId),
    onPollError: (err) => {
      console.warn(
        "[clips-recorder] background backup cleanup check failed:",
        err,
      );
    },
  }).catch((err) => {
    console.warn("[clips-recorder] background backup flag failed:", err);
  });
}

export function scheduleNativeBackupCleanupAfterProcessing(args: {
  serverUrl: string;
  recordingId: string;
  authToken?: string;
}): void {
  void reconcileProcessingBackup({
    waitForReady: () =>
      waitForReadyRecordingAfterFinalizeError({
        uploadUrl: chunkUrl(args.serverUrl, args.recordingId, 0, false),
        recordingId: args.recordingId,
        authToken: args.authToken,
        preferAuthenticated: true,
        timeoutMs: 12 * 60 * 1000,
      }),
    onReady: () =>
      invoke("native_fullscreen_recording_clear_upload", {
        recordingId: args.recordingId,
      }),
    onUnresolved: () => flagNativeBackupAfterProcessing(args.recordingId),
    onPollError: (err) => {
      console.warn("[clips-recorder] native backup cleanup check failed:", err);
    },
  }).catch((err) => {
    console.warn("[clips-recorder] native backup flag failed:", err);
  });
}

async function recoverAcceptedRecordingAfterFinalizeError({
  serverUrl,
  recordingId,
  authToken,
}: {
  serverUrl: string;
  recordingId: string;
  authToken?: string;
}): Promise<"processing" | "ready" | null> {
  const recovered = await waitForAcceptedRecordingAfterFinalizeError({
    uploadUrl: chunkUrl(serverUrl, recordingId, 0, false),
    recordingId,
    authToken,
    preferAuthenticated: true,
  });
  if (!recovered) return null;
  if (recovered.status === "processing") {
    scheduleBrowserBackupCleanupAfterProcessing({
      serverUrl,
      recordingId,
      authToken,
    });
    return "processing";
  }
  await markBrowserRecordingBackupError(
    recordingId,
    "Upload completed, but its final receipt could not be verified. The local backup was kept.",
  ).catch(() => {});
  return "ready";
}

async function recoverAcceptedNativeRecordingAfterFinalizeError({
  serverUrl,
  recordingId,
  authToken,
}: {
  serverUrl: string;
  recordingId: string;
  authToken?: string;
}): Promise<"processing" | "ready" | null> {
  const recovered = await waitForAcceptedRecordingAfterFinalizeError({
    uploadUrl: chunkUrl(serverUrl, recordingId, 0, false),
    recordingId,
    authToken,
    preferAuthenticated: true,
  });
  if (!recovered) return null;
  if (recovered.status === "processing") {
    scheduleNativeBackupCleanupAfterProcessing({
      serverUrl,
      recordingId,
      authToken,
    });
    return "processing";
  }
  await invoke("native_fullscreen_recording_clear_upload", {
    recordingId,
  }).catch((error) => {
    console.warn("[clips-recorder] native backup cleanup failed:", error);
  });
  return "ready";
}

export async function listBrowserRecordingBackups(): Promise<
  PendingBrowserRecordingUpload[]
> {
  if (!backupDbAvailable()) return [];
  const db = await openBackupDb();
  try {
    const tx = db.transaction(BACKUP_META_STORE, "readonly");
    const metas = await waitForRequest<BrowserRecordingBackupMeta[]>(
      tx.objectStore(BACKUP_META_STORE).getAll(),
    );
    await waitForTransaction(tx);
    return metas
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((meta) => ({ ...meta, kind: "browser" as const }));
  } finally {
    db.close();
  }
}

function buildRetryHeaders(mimeType: string, authToken?: string): Headers {
  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
    "X-Request-Source": "clips-desktop",
  });
  const token = authToken?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

class UploadRestartRequiredError extends Error {
  constructor(
    message: string,
    readonly recoveryEnabled?: boolean,
  ) {
    super(message);
    this.name = "UploadRestartRequiredError";
  }
}

async function postBackupChunk(
  url: string,
  blob: Blob,
  authToken?: string,
  signal?: AbortSignal,
): Promise<FinalizeReceipt | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: buildRetryHeaders(
      blob.type || "application/octet-stream",
      authToken,
    ),
    credentials: "include",
    body: blob,
    signal,
  });
  const body = await res.text().catch(() => "");
  const responseError = classifyUploadResponseError({
    contentType: res.headers.get("content-type"),
    body,
    status: res.status,
    stage: "chunk_upload",
  });
  if (!res.ok) {
    const details = (() => {
      try {
        return JSON.parse(responseError.responseText ?? "") as {
          restartRequired?: unknown;
          recoveryEnabled?: unknown;
        };
      } catch {
        return null;
      }
    })();
    if (details?.restartRequired === true) {
      throw new UploadRestartRequiredError(
        `The prior upload session expired (${res.status})`,
        typeof details.recoveryEnabled === "boolean"
          ? details.recoveryEnabled
          : undefined,
      );
    }
    throw Object.assign(
      new Error(
        responseError.isHtml
          ? `Chunk upload returned an HTML error response (${res.status}).`
          : `Upload retry failed (${res.status}): ${responseError.responseText?.slice(0, 200) ?? ""}`,
      ),
      {
        status: responseError.status,
        failureCode: responseError.failureCode,
        failureStage: responseError.failureStage,
      },
    );
  }
  if (responseError.isHtml) {
    throw Object.assign(
      new Error(
        `Chunk upload returned an HTML error response (${res.status}).`,
      ),
      {
        status: responseError.status,
        failureCode: responseError.failureCode,
        failureStage: responseError.failureStage,
      },
    );
  }
  return parseFinalizeReceipt(body);
}

async function resetBrowserRecordingBackupUpload(
  meta: BrowserRecordingBackupMeta,
  authToken?: string,
  attemptId?: string,
  uploadGenerationId?: string,
  signal?: AbortSignal,
): Promise<{ uploadMode: UploadMode; uploadGenerationId?: string }> {
  const res = await fetch(
    `${meta.serverUrl.replace(/\/+$/, "")}/api/uploads/${meta.recordingId}/reset-chunks`,
    {
      method: "POST",
      headers: buildRetryHeaders("application/json", authToken),
      credentials: "include",
      body: JSON.stringify({
        requestStreaming: true,
        mimeType: meta.mimeType,
        ...(attemptId ? { attemptId } : {}),
        ...(uploadGenerationId ? { uploadGenerationId } : {}),
      }),
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const responseError = classifyUploadResponseError({
      contentType: res.headers.get("content-type"),
      body,
      status: res.status,
      stage: "reset_chunks",
    });
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(responseError.responseText ?? "") as Record<
        string,
        unknown
      >;
    } catch {
      // coercion-ok: preserve the HTTP failure when optional error details are malformed.
      // Reset errors remain HTTP failures when the body is not JSON.
    }
    const failureCode =
      details.failureCode === "multipart_start_failed"
        ? "multipart_start_failed"
        : responseError.isHtml
          ? "chunk_html_error"
          : "upload_failed";
    throw Object.assign(
      new Error(
        responseError.isHtml
          ? `Reset-chunks returned an HTML error response (${res.status}).`
          : typeof details.error === "string"
            ? details.error
            : `Upload retry setup failed (${res.status}): ${responseError.responseText?.slice(0, 200) ?? ""}`,
      ),
      {
        status: res.status,
        failureCode,
        failureStage: responseError.isHtml
          ? "reset_chunks"
          : details.failureStage === "multipart_start"
            ? "multipart_start"
            : "reset_chunks",
      },
    );
  }
  if (res.headers.get("content-type")?.includes("text/html")) {
    throw Object.assign(
      new Error(
        `Reset-chunks returned an HTML error response (${res.status}).`,
      ),
      {
        status: res.status,
        failureCode: "chunk_html_error",
        failureStage: "reset_chunks",
      },
    );
  }
  const body = (await res.json().catch(() => null)) as {
    uploadMode?: unknown;
    uploadGenerationId?: unknown;
  } | null;
  if (attemptId && typeof body?.uploadGenerationId !== "string") {
    throw new Error("Upload retry setup returned no upload generation");
  }
  return {
    uploadMode: body?.uploadMode === "streaming" ? "streaming" : "buffered",
    ...(typeof body?.uploadGenerationId === "string"
      ? { uploadGenerationId: body.uploadGenerationId }
      : {}),
  };
}

async function getBrowserRecordingUploadResume(
  meta: BrowserRecordingBackupMeta,
  attemptId: string,
  authToken?: string,
  onWaiting?: (delayMs: number) => void,
  signal?: AbortSignal,
): Promise<UploadResumeResponse> {
  const resumeUrl = new URL(
    `${meta.serverUrl.replace(/\/+$/, "")}/api/uploads/${meta.recordingId}/resume`,
  );
  resumeUrl.searchParams.set("attemptId", attemptId);
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const res = await fetch(resumeUrl, {
      method: "GET",
      headers: buildRetryHeaders("application/json", authToken),
      credentials: "include",
      signal,
    });
    let body: string;
    try {
      body = await res.text();
    } catch {
      throw new Error("Upload resume check response could not be read");
    }
    let parsed: UploadResumeResponse;
    try {
      parsed = JSON.parse(body) as UploadResumeResponse;
    } catch {
      throw new Error("Upload resume check returned an unreadable response");
    }
    if (!res.ok) {
      const delayMs = retryConflictDelay(parsed);
      if (delayMs !== null && Date.now() + delayMs <= deadline) {
        onWaiting?.(delayMs);
        await abortableWait(delayMs, signal);
        continue;
      }
      if (!parsed.resumable && parsed.reason === "retry_already_active") {
        throw new Error(
          "Another upload retry is still active. Wait a moment and try again.",
        );
      }
      if (
        !parsed.resumable &&
        parsed.reason === "retry_claim_liveness_unavailable"
      ) {
        throw new Error(
          "Clips could not verify whether another retry is active. Your local clip is safe; try again.",
        );
      }
      throw new Error(`Upload resume check failed (${res.status})`);
    }
    if (parsed.resumable && parsed.attemptId !== attemptId) {
      throw new Error("Upload resume check returned a mismatched retry token");
    }
    return parsed;
  }
}

async function replayBrowserBackupToResumableSession(
  meta: BrowserRecordingBackupMeta,
  chunks: BrowserRecordingBackupChunk[],
  authToken?: string,
  attemptId?: string,
  uploadGenerationId?: string,
  resumeFrom: { bytesReceived: number; nextChunkIndex: number } = {
    bytesReceived: 0,
    nextChunkIndex: 0,
  },
  signal?: AbortSignal,
): Promise<FinalizeReceipt | null> {
  const recording = new Blob(
    chunks.map((chunk) => chunk.blob),
    {
      type: meta.mimeType,
    },
  );
  if (recording.size <= 0) {
    throw new Error("Local recording backup is empty");
  }

  const replayPlan = buildStreamingReplayPlan({
    localBytes: recording.size,
    chunkBytes: STREAM_CHUNK_BYTES,
    ...resumeFrom,
  });
  const totalPosts = Math.floor(recording.size / STREAM_CHUNK_BYTES) + 1;

  for (const request of replayPlan.filter((item) => !item.final)) {
    const body = recording.slice(request.start, request.end, meta.mimeType);
    await postBackupChunk(
      chunkUrl(meta.serverUrl, meta.recordingId, request.index, false, {
        total: String(totalPosts),
        mimeType: meta.mimeType,
        ...(attemptId ? { attemptId } : {}),
        ...(uploadGenerationId ? { uploadGenerationId } : {}),
      }),
      body,
      authToken,
      signal,
    );
  }

  const finalRequest = replayPlan[replayPlan.length - 1]!;
  const finalBody = recording.slice(
    finalRequest.start,
    finalRequest.end,
    meta.mimeType,
  );
  return postBackupChunk(
    chunkUrl(meta.serverUrl, meta.recordingId, finalRequest.index, true, {
      total: String(totalPosts),
      mimeType: meta.mimeType,
      durationMs: String(Math.round(meta.durationMs || 0)),
      ...(meta.width ? { width: String(meta.width) } : {}),
      ...(meta.height ? { height: String(meta.height) } : {}),
      hasAudio: meta.hasAudio ? "1" : "0",
      hasCamera: meta.hasCamera ? "1" : "0",
      ...(attemptId ? { attemptId } : {}),
      ...(uploadGenerationId ? { uploadGenerationId } : {}),
    }),
    finalBody,
    authToken,
    signal,
  );
}

export async function retryBrowserRecordingBackup(input: {
  recordingId: string;
  serverUrl?: string;
  authToken?: string;
  signal?: AbortSignal;
  onRecoveryDecision?: (decision: {
    action: "wait" | "resume" | "restart" | "reconcile";
    progress: number;
  }) => void;
}): Promise<{ recordingId: string; viewUrl: string }> {
  let meta = await getBrowserRecordingBackupMeta(input.recordingId);
  if (!meta) {
    throw new Error("Local recording backup not found");
  }
  const serverUrl = input.serverUrl?.trim().replace(/\/+$/, "");
  if (serverUrl) {
    meta = { ...meta, serverUrl };
  }
  const chunks = await getBrowserRecordingBackupChunks(input.recordingId);
  const validatedChunks = validateBrowserRecordingBackupChunks(meta, chunks);
  let activeAttemptId: string | undefined =
    meta.uploadAttemptId || crypto.randomUUID();
  let activeUploadGenerationId: string | undefined;

  try {
    await putBrowserRecordingBackupMeta({
      ...meta,
      uploadAttemptId: activeAttemptId,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    });
    const recordingBytes = validatedChunks.reduce(
      (total, chunk) => total + chunk.blob.size,
      0,
    );
    const resumeResponse = await getBrowserRecordingUploadResume(
      meta,
      activeAttemptId,
      input.authToken,
      () => input.onRecoveryDecision?.({ action: "wait", progress: 0 }),
      input.signal,
    );
    const recoveryPlan = planStreamingRecovery({
      response: resumeResponse,
      localBytes: recordingBytes,
      chunkBytes: STREAM_CHUNK_BYTES,
    });
    activeAttemptId = retryAttemptIdAfterResumeResponse(
      activeAttemptId,
      resumeResponse,
    );
    activeUploadGenerationId = activeAttemptId
      ? resumeResponse.uploadGenerationId
      : undefined;
    if (recoveryPlan.action === "reconcile") {
      input.onRecoveryDecision?.({ action: "reconcile", progress: 1 });
      if (
        await recoverAcceptedRecordingAfterFinalizeError({
          serverUrl: meta.serverUrl,
          recordingId: meta.recordingId,
          authToken: input.authToken,
        })
      ) {
        return {
          recordingId: meta.recordingId,
          viewUrl: `/r/${meta.recordingId}`,
        };
      }
      throw new Error(
        `Upload is ${recoveryPlan.status}, but its accepted media could not be verified`,
      );
    }

    let uploadMode: UploadMode = "streaming";
    let resumeFrom = { bytesReceived: 0, nextChunkIndex: 0 };
    if (recoveryPlan.action === "resume") {
      resumeFrom = recoveryPlan;
      input.onRecoveryDecision?.({
        action: "resume",
        progress: recoveryPlan.progress,
      });
      console.info("[clips-recorder] resuming saved upload", {
        recordingId: meta.recordingId,
        localBytes: recordingBytes,
        serverAcknowledgedBytes: recoveryPlan.bytesReceived,
        nextChunkIndex: recoveryPlan.nextChunkIndex,
        progress: recoveryPlan.progress,
      });
    } else {
      input.onRecoveryDecision?.({ action: "restart", progress: 0 });
      console.info("[clips-recorder] restarting saved upload", {
        recordingId: meta.recordingId,
        localBytes: recordingBytes,
        reason: recoveryPlan.reason,
      });
      const reset = await resetBrowserRecordingBackupUpload(
        meta,
        input.authToken,
        activeAttemptId,
        activeUploadGenerationId,
        input.signal,
      );
      uploadMode = reset.uploadMode;
      activeUploadGenerationId = reset.uploadGenerationId;
    }

    if (uploadMode === "streaming") {
      let receipt: FinalizeReceipt | null = null;
      try {
        receipt = await replayBrowserBackupToResumableSession(
          meta,
          validatedChunks,
          input.authToken,
          activeAttemptId,
          activeUploadGenerationId,
          resumeFrom,
          input.signal,
        );
      } catch (err) {
        if (err instanceof UploadRestartRequiredError) {
          activeAttemptId = retryAttemptIdAfterRestartSignal(
            activeAttemptId,
            err.recoveryEnabled,
          );
          input.onRecoveryDecision?.({ action: "restart", progress: 0 });
          console.info("[clips-recorder] restarting expired upload session", {
            recordingId: meta.recordingId,
            localBytes: recordingBytes,
          });
          const reset = await resetBrowserRecordingBackupUpload(
            meta,
            input.authToken,
            activeAttemptId,
            activeUploadGenerationId,
            input.signal,
          );
          uploadMode = reset.uploadMode;
          activeUploadGenerationId = reset.uploadGenerationId;
          if (uploadMode === "streaming") {
            receipt = await replayBrowserBackupToResumableSession(
              meta,
              validatedChunks,
              input.authToken,
              activeAttemptId,
              activeUploadGenerationId,
              undefined,
              input.signal,
            );
          }
        } else if (
          await recoverAcceptedRecordingAfterFinalizeError({
            serverUrl: meta.serverUrl,
            recordingId: meta.recordingId,
            authToken: input.authToken,
          })
        ) {
          return {
            recordingId: meta.recordingId,
            viewUrl: `/r/${meta.recordingId}`,
          };
        } else {
          throw err;
        }
      }
      if (uploadMode === "streaming") {
        const receiptStatus = verifyFinalizeReceipt(receipt, meta);
        if (receiptStatus === "processing") {
          scheduleBrowserBackupCleanupAfterProcessing({
            serverUrl: meta.serverUrl,
            recordingId: meta.recordingId,
            authToken: input.authToken,
          });
          return {
            recordingId: meta.recordingId,
            viewUrl: `/r/${meta.recordingId}`,
          };
        }
        await deleteBrowserRecordingBackup(meta.recordingId);
        return {
          recordingId: meta.recordingId,
          viewUrl: `/r/${meta.recordingId}`,
        };
      }
    }

    const totalPosts = validatedChunks.length + 1;
    for (const chunk of validatedChunks) {
      await postBackupChunk(
        chunkUrl(meta.serverUrl, meta.recordingId, chunk.index, false, {
          total: String(totalPosts),
          mimeType: meta.mimeType,
          ...(activeAttemptId ? { attemptId: activeAttemptId } : {}),
          ...(activeUploadGenerationId
            ? { uploadGenerationId: activeUploadGenerationId }
            : {}),
        }),
        chunk.blob,
        input.authToken,
        input.signal,
      );
    }

    const finalChunkUrl = chunkUrl(
      meta.serverUrl,
      meta.recordingId,
      validatedChunks.length,
      true,
      {
        total: String(totalPosts),
        mimeType: meta.mimeType,
        durationMs: String(Math.round(meta.durationMs || 0)),
        ...(meta.width ? { width: String(meta.width) } : {}),
        ...(meta.height ? { height: String(meta.height) } : {}),
        hasAudio: meta.hasAudio ? "1" : "0",
        hasCamera: meta.hasCamera ? "1" : "0",
        ...(activeAttemptId ? { attemptId: activeAttemptId } : {}),
        ...(activeUploadGenerationId
          ? { uploadGenerationId: activeUploadGenerationId }
          : {}),
      },
    );
    try {
      const receipt = await postBackupChunk(
        finalChunkUrl,
        new Blob([], { type: meta.mimeType }),
        input.authToken,
        input.signal,
      );
      const receiptStatus = verifyFinalizeReceipt(receipt, meta);
      if (receiptStatus === "processing") {
        scheduleBrowserBackupCleanupAfterProcessing({
          serverUrl: meta.serverUrl,
          recordingId: meta.recordingId,
          authToken: input.authToken,
        });
        return {
          recordingId: meta.recordingId,
          viewUrl: `/r/${meta.recordingId}`,
        };
      }
    } catch (err) {
      if (
        await recoverAcceptedRecordingAfterFinalizeError({
          serverUrl: meta.serverUrl,
          recordingId: meta.recordingId,
          authToken: input.authToken,
        })
      ) {
        return {
          recordingId: meta.recordingId,
          viewUrl: `/r/${meta.recordingId}`,
        };
      }
      throw err;
    }

    await deleteBrowserRecordingBackup(meta.recordingId);
    return { recordingId: meta.recordingId, viewUrl: `/r/${meta.recordingId}` };
  } catch (err) {
    if (
      input.signal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError")
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (
      await recoverAcceptedRecordingAfterFinalizeError({
        serverUrl: meta.serverUrl,
        recordingId: meta.recordingId,
        authToken: input.authToken,
      })
    ) {
      return {
        recordingId: meta.recordingId,
        viewUrl: `/r/${meta.recordingId}`,
      };
    }
    await markBrowserRecordingBackupError(meta.recordingId, message).catch(
      () => {},
    );
    await interruptRecordingUpload(
      meta.serverUrl,
      meta.recordingId,
      message,
      input.authToken,
      activeAttemptId,
      activeUploadGenerationId,
      uploadFailureDiagnostics(err),
    );
    throw err;
  }
}

async function createServerRecording(
  serverUrl: string,
  hasCamera: boolean,
  hasAudio: boolean,
  titleContext?: CaptureTitleResult,
  options?: NativeRecordingRequestOptions & {
    authToken?: string;
    signal?: AbortSignal;
  },
) {
  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/create-recording`;
  console.log("[clips-recorder] POST", url, {
    hasCamera,
    hasAudio,
    title: titleContext?.title,
    requestStreaming: options?.requestStreaming ?? false,
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: buildCreateRecordingRequestHeaders(options?.authToken),
      credentials: "include",
      signal: options?.signal,
      body: JSON.stringify(
        buildCreateRecordingRequestBody(
          hasCamera,
          hasAudio,
          titleContext,
          options,
        ),
      ),
    });
  } catch (err) {
    console.error("[clips-recorder] fetch failed:", url, err);
    if (
      options?.signal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError")
    ) {
      throw err;
    }
    throw new Error(RECORDING_SERVER_UNAVAILABLE);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[clips-recorder] bad response:", url, res.status, body);
    if (res.status === 401 || res.status === 403) {
      throw new Error(RECORDING_SESSION_EXPIRED);
    }
    if (res.status >= 500 && isStorageSetupFailureMessage(body)) {
      throw new Error(body.slice(0, 200));
    }
    if (res.status >= 500) {
      throw new Error(RECORDING_SERVER_UNAVAILABLE);
    }
    throw new Error(`create-recording ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    result?: { id: string; uploadMode?: string };
    id?: string;
    uploadMode?: string;
  };
  const result = data.result ?? data;
  if (!result.id) {
    throw new Error("create-recording did not return an id");
  }
  const uploadMode: UploadMode =
    result.uploadMode === "streaming" ? "streaming" : "buffered";
  return { id: result.id, uploadMode };
}

export async function createPrivateAgentRewindRecording(
  serverUrl: string,
  hasAudio: boolean,
  startedAt: string,
  authToken?: string,
): Promise<{ id: string; uploadMode: UploadMode }> {
  return createServerRecording(
    serverUrl,
    false,
    hasAudio,
    {
      title: `Rewind · ${new Date(startedAt).toLocaleString()}`,
      titleSource: "context",
      sourceAppName: "Clips Rewind",
      sourceWindowTitle: null,
    },
    {
      mimeType: NATIVE_FULLSCREEN_MIME_TYPE,
      requestStreaming: true,
      streamingUploadClient: "desktop-native",
      visibility: "private",
      authToken,
    },
  );
}

interface ActiveWindowContext {
  appName?: string | null;
  windowTitle?: string | null;
  bundleId?: string | null;
  source?: string;
}

async function captureTitleForRecording(params: {
  mode: CaptureMode;
  source?: CaptureSource;
}): Promise<CaptureTitleResult> {
  const context = await invoke<ActiveWindowContext>(
    "active_window_context",
  ).catch(() => null);
  return buildCaptureTitle({
    appName: context?.appName,
    windowTitle: context?.windowTitle,
    displaySurface: params.source === "window" ? "window" : "monitor",
    mode: params.mode,
  });
}

const COUNTDOWN_EVENT_TIMEOUT_MS = 5000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return wait(ms);
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface NativeFullscreenUploadResult {
  recordingId: string;
  durationMs: number;
  width?: number;
  height?: number;
  verificationPending?: boolean;
}

interface NativeFullscreenSaveResult {
  recordingId: string;
  folderPath: string;
  file: LocalExportedFile;
}

async function saveRecordingTranscript(
  serverUrl: string,
  recordingId: string,
  transcript: CapturedTranscript,
  authToken?: string,
): Promise<boolean> {
  const text = transcript.text.trim();
  if (!text) return false;

  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/save-browser-transcript`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildRetryHeaders("application/json", authToken),
      credentials: "include",
      body: JSON.stringify({
        recordingId,
        fullText: text,
        segments: transcript.segments,
        source: transcript.source ?? "whisper",
        ...(transcript.failureReason
          ? { failureReason: transcript.failureReason }
          : {}),
      }),
      signal: AbortSignal.timeout(TRANSCRIPT_SAVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[clips-recorder] save transcript failed:",
        res.status,
        body.slice(0, 200),
      );
      return false;
    }
    console.log("[clips-recorder] native transcript saved", {
      recordingId,
      source: transcript.source ?? "whisper",
      chars: text.length,
      segments: transcript.segments.length,
    });
    return true;
  } catch (err) {
    console.warn("[clips-recorder] save transcript failed:", err);
    return false;
  }
}

async function saveRecordingTranscriptFailure(
  serverUrl: string,
  recordingId: string,
  failureReason: string,
  authToken?: string,
): Promise<boolean> {
  const reason = failureReason.trim();
  if (!reason) return false;

  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/save-browser-transcript`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildRetryHeaders("application/json", authToken),
      credentials: "include",
      body: JSON.stringify({
        recordingId,
        fullText: "",
        source: "whisper",
        failureReason: reason,
      }),
      signal: AbortSignal.timeout(TRANSCRIPT_SAVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[clips-recorder] save native transcript failure failed:",
        res.status,
        body.slice(0, 200),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[clips-recorder] save native transcript failure failed:",
      err,
    );
    return false;
  }
}

let inFlightChunks = 0;
function incChunkBusy(): void {
  inFlightChunks += 1;
  (window as unknown as { clipsChunkBusy?: boolean }).clipsChunkBusy = true;
}
function decChunkBusy(): void {
  inFlightChunks = Math.max(0, inFlightChunks - 1);
  if (inFlightChunks === 0) {
    (window as unknown as { clipsChunkBusy?: boolean }).clipsChunkBusy = false;
  }
}

const CHUNK_UPLOAD_MAX_ATTEMPTS = 3;
const CHUNK_UPLOAD_RETRY_BASE_MS = 250;
const CHUNK_UPLOAD_TIMEOUT_MS = 60_000;
const FINALIZE_UPLOAD_TIMEOUT_MS = 180_000;

function isRetriableChunkStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function uploadChunk(url: string, blob: Blob): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= CHUNK_UPLOAD_MAX_ATTEMPTS; attempt++) {
    incChunkBusy();
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        credentials: "include",
        body: blob,
        signal: AbortSignal.timeout(CHUNK_UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      decChunkBusy();
    }

    if (res) {
      if (res.ok) {
        let htmlResponse =
          res.headers.get("content-type")?.includes("text/html") === true;
        try {
          const body = await res.text();
          htmlResponse ||= /^\s*(?:<!doctype html|<html\b)/i.test(body);
        } catch {
          // ignore — body drain is best-effort
        }
        if (htmlResponse) {
          throw Object.assign(
            new Error(
              `Chunk upload returned an HTML error response (${res.status}).`,
            ),
            {
              status: res.status,
              failureCode: "chunk_html_error",
              failureStage: "chunk_upload",
            },
          );
        }
        console.log(
          "[clips-recorder] chunk ok:",
          res.status,
          blob.size,
          "bytes",
        );
        return;
      }
      const body = await res.text().catch(() => "");
      const htmlResponse =
        res.headers.get("content-type")?.includes("text/html") === true ||
        /^\s*(?:<!doctype html|<html\b)/i.test(body);
      lastError = Object.assign(
        new Error(
          htmlResponse
            ? `Chunk upload returned an HTML error response (${res.status}).`
            : `chunk ${res.status}: ${body.slice(0, 200)}`,
        ),
        {
          status: res.status,
          failureCode: htmlResponse ? "chunk_html_error" : "upload_failed",
          ...(htmlResponse ? { failureStage: "chunk_upload" } : {}),
        },
      );
      if (!isRetriableChunkStatus(res.status)) {
        console.error(
          "[clips-recorder] chunk failed:",
          res.status,
          htmlResponse ? "HTML error response" : body.slice(0, 200),
        );
        throw lastError;
      }
      console.warn(
        "[clips-recorder] chunk retriable failure:",
        res.status,
        `attempt ${attempt}/${CHUNK_UPLOAD_MAX_ATTEMPTS}`,
      );
    } else {
      console.warn(
        "[clips-recorder] chunk network error:",
        lastError?.message,
        `attempt ${attempt}/${CHUNK_UPLOAD_MAX_ATTEMPTS}`,
      );
    }

    if (attempt < CHUNK_UPLOAD_MAX_ATTEMPTS) {
      await wait(CHUNK_UPLOAD_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError ?? new Error("chunk upload failed");
}

async function abortRecordingUpload(
  serverUrl: string,
  recordingId: string,
  reason: string,
  failureCode = "upload_failed",
  failureStage?: string,
  httpStatus?: number,
): Promise<void> {
  try {
    await fetch(
      `${serverUrl.replace(/\/+$/, "")}/api/uploads/${recordingId}/abort`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason, failureCode, failureStage, httpStatus }),
      },
    );
  } catch (err) {
    console.warn("[clips-recorder] abort upload failed:", err);
  }
}

function uploadFailureDiagnostics(error: unknown) {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    failureCode:
      details.failureCode === "chunk_html_error" ||
      details.failureCode === "multipart_start_failed"
        ? details.failureCode
        : "upload_failed",
    ...(details.failureStage === "chunk_upload" ||
    details.failureStage === "reset_chunks" ||
    details.failureStage === "multipart_start"
      ? { failureStage: details.failureStage }
      : {}),
    ...(typeof details.status === "number" && Number.isInteger(details.status)
      ? { httpStatus: details.status }
      : {}),
  };
}

async function interruptRecordingUpload(
  serverUrl: string,
  recordingId: string,
  detail: string,
  authToken?: string,
  attemptId?: string,
  uploadGenerationId?: string,
  diagnostics?: ReturnType<typeof uploadFailureDiagnostics>,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= CHUNK_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/api/uploads/${recordingId}/interrupt`,
        {
          method: "POST",
          headers: buildRetryHeaders("application/json", authToken),
          credentials: "include",
          body: JSON.stringify({
            detail,
            ...(diagnostics?.failureCode === "chunk_html_error"
              ? diagnostics
              : {}),
            ...(attemptId ? { attemptId } : {}),
            ...(uploadGenerationId ? { uploadGenerationId } : {}),
          }),
        },
      );
      if (res.ok) {
        console.info("[clips-recorder] upload interruption recorded", {
          recordingId,
          attempt,
        });
        return;
      }
      lastError = new Error(`Upload interruption failed (${res.status}).`);
      if (!isRetriableChunkStatus(res.status)) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < CHUNK_UPLOAD_MAX_ATTEMPTS) {
      await wait(CHUNK_UPLOAD_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  console.warn(
    "[clips-recorder] upload interruption could not be recorded:",
    lastError,
  );
}

async function trashRecording(
  serverUrl: string,
  recordingId: string,
): Promise<void> {
  try {
    const res = await fetch(
      `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/trash-recording`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: recordingId }),
      },
    );
    if (!res.ok) {
      console.warn(
        "[clips-recorder] trash recording failed:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.warn("[clips-recorder] trash recording failed:", err);
  }
}

async function cleanupCancelledRemoteRecording(
  serverUrl: string,
  recordingId: string,
): Promise<void> {
  await abortRecordingUpload(
    serverUrl,
    recordingId,
    "Recording cancelled by user",
    "user_cancelled",
  );
  await trashRecording(serverUrl, recordingId);
}

class CountdownCancelledError extends Error {
  constructor() {
    super("Recording cancelled during countdown");
    this.name = "AbortError";
  }
}

class RegionSelectionCancelledError extends Error {
  constructor() {
    super("Recording region selection cancelled");
    this.name = "AbortError";
  }
}

function isCountdownCancelledError(err: unknown) {
  return (
    err instanceof Error &&
    err.name === "AbortError" &&
    /countdown/i.test(err.message)
  );
}

function normalizeRegionCaptureRect(value: unknown): RegionCaptureRect | null {
  if (!value || typeof value !== "object") return null;
  const rect = value as Partial<RegionCaptureRect>;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

function waitForRegionSelection(): {
  promise: Promise<RegionCaptureRect>;
  cleanup: () => void;
} {
  let settled = false;
  const unlistens: UnlistenFn[] = [];

  const cleanup = () => {
    settled = true;
    for (const unlisten of unlistens.splice(0)) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
  };

  const promise = new Promise<RegionCaptureRect>((resolve, reject) => {
    const finish = (result: RegionCaptureRect | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result) resolve(result);
      else reject(new RegionSelectionCancelledError());
    };

    const track = (listener: Promise<UnlistenFn>) => {
      listener
        .then((unlisten) => {
          if (settled) {
            try {
              unlisten();
            } catch {
              // ignore
            }
            return;
          }
          unlistens.push(unlisten);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        });
    };

    track(
      listen<unknown>("clips:region-capture-selected", (event) => {
        const rect = normalizeRegionCaptureRect(event.payload);
        if (!rect) {
          finish(null);
          return;
        }
        finish(rect);
      }),
    );
    track(
      listen("clips:region-capture-cancelled", () => {
        finish(null);
      }),
    );
  });

  return { promise, cleanup };
}

async function selectRegionForRecording(): Promise<RegionCaptureRect> {
  const selection = waitForRegionSelection();
  try {
    await invoke("show_region_capture_selector");
    return await selection.promise;
  } catch (err) {
    selection.cleanup();
    throw err;
  }
}

class MonitorPickerCancelledError extends Error {
  constructor() {
    super("Full-screen monitor selection cancelled");
    this.name = "AbortError";
  }
}

const MONITOR_PICKER_SELECTION_TIMEOUT_MS = 5 * 60_000;

export function deferCaptureUntilDisplaySelection<T>(
  displaySelection: Promise<unknown> | null,
  acquire: () => Promise<T>,
): Promise<T> {
  return displaySelection ? displaySelection.then(acquire) : acquire();
}

export interface MonitorPickerSelectionWaiter {
  promise: Promise<number | null>;
  listenersReady: Promise<void>;
  cleanup: () => void;
}

export function waitForMonitorPickerSelection(
  register: typeof listen = listen,
): MonitorPickerSelectionWaiter {
  let settled = false;
  const unlistens: UnlistenFn[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveSelection!: (displayId: number | null) => void;
  let rejectSelection!: (error: unknown) => void;

  const cleanup = () => {
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const unlisten of unlistens.splice(0)) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
  };

  const promise = new Promise<number | null>((resolve, reject) => {
    resolveSelection = resolve;
    rejectSelection = reject;
  });
  void promise.catch(() => {});

  const finish = (cancelled: boolean, displayId: number | null) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (cancelled) rejectSelection(new MonitorPickerCancelledError());
    else resolveSelection(displayId);
  };

  timer = setTimeout(() => {
    finish(true, null);
  }, MONITOR_PICKER_SELECTION_TIMEOUT_MS);

  const selected = register<{ displayId?: number | null }>(
    "clips:monitor-picker-selected",
    (event) => {
      const raw = event.payload?.displayId;
      const displayId =
        typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
      finish(false, displayId);
    },
  );
  const cancelled = register("clips:monitor-picker-cancelled", () => {
    finish(true, null);
  });

  const listenersReady = Promise.all([selected, cancelled])
    .then((registered) => {
      registered.forEach((unlisten) => {
        if (settled) {
          try {
            unlisten();
          } catch {
            // coercion-ok: listener teardown is best-effort after selection settles.
            // ignore
          }
          return;
        }
        unlistens.push(unlisten);
      });
    })
    .then(() => undefined)
    .catch((err) => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectSelection(err);
      }
      throw err;
    });

  return { promise, listenersReady, cleanup };
}

export async function pickFullscreenRecordingDisplay(): Promise<void> {
  const selection = waitForMonitorPickerSelection();
  let shown: boolean;
  try {
    await selection.listenersReady;
    shown = await invoke<boolean>("show_monitor_picker");
  } catch (err) {
    selection.cleanup();
    throw err;
  }
  if (!shown) {
    selection.cleanup();
    return;
  }
  let displayId: number | null = null;
  try {
    displayId = await selection.promise;
  } catch (err) {
    selection.cleanup();
    await invoke("close_monitor_picker").catch(() => {});
    throw err;
  }
  try {
    await invoke("set_recording_display_override", { displayId });
  } finally {
    selection.cleanup();
    await invoke("close_monitor_picker").catch(() => {});
  }
}

async function prepareCountdownEventWaiter(
  timeoutMs = 4000,
  signal?: AbortSignal,
): Promise<{
  event: Promise<string>;
  cleanup: () => void;
}> {
  let resolveEvent!: (cause: string) => void;
  let rejectEvent!: (error: Error) => void;
  const event = new Promise<string>((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unlistens: UnlistenFn[] = [];
  let done = false;
  const onKeyDown = (keyboardEvent: KeyboardEvent) => {
    if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== "Escape") {
      return;
    }
    keyboardEvent.preventDefault();
    const cancelled = keyboardEvent.key === "Escape";
    void emit(cancelled ? "clips:countdown-cancel" : "clips:countdown-done", {
      cause: cancelled ? "escape" : "return",
    });
  };
  window.addEventListener("keydown", onKeyDown);

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown);
    signal?.removeEventListener("abort", onAbort);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const unlisten of unlistens.splice(0)) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
  };
  const finish = (kind: "done" | "cancel", cause = "unknown") => {
    if (done) return;
    done = true;
    cleanup();
    if (kind === "cancel") {
      rejectEvent(new CountdownCancelledError());
    } else {
      resolveEvent(cause);
    }
  };
  const onAbort = () => finish("cancel", "abort");
  if (signal?.aborted) {
    onAbort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }

  const [doneUnlisten, cancelUnlisten] = await Promise.all([
    listen<{ cause?: string }>("clips:countdown-done", (event) =>
      finish("done", event.payload?.cause),
    ),
    listen<{ cause?: string }>("clips:countdown-cancel", (event) =>
      finish("cancel", event.payload?.cause),
    ),
  ]);
  if (done) {
    doneUnlisten();
    cancelUnlisten();
  } else {
    unlistens.push(doneUnlisten, cancelUnlisten);
    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      rejectEvent(new Error("timeout waiting for clips:countdown-done"));
    }, timeoutMs);
  }

  return { event, cleanup };
}

async function showRegionGuidesForRecording(wantsScreen: boolean) {
  if (!wantsScreen) return;
  await invoke("show_region_guides").catch((err) => {
    console.warn("[clips-recorder] show_region_guides failed:", err);
  });
}

async function showRegionRecordBorder(region: RegionCaptureRect | null) {
  if (!region) return;
  await invoke("show_region_record_border", {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  }).catch((err) => {
    console.warn("[clips-recorder] show_region_record_border failed:", err);
  });
}

async function runRecordingCountdown(
  wantsScreen: boolean,
  signal?: AbortSignal,
) {
  const countdown = await prepareCountdownEventWaiter(
    COUNTDOWN_EVENT_TIMEOUT_MS,
    signal,
  );
  throwIfRecordingStartAborted(signal);
  await showRegionGuidesForRecording(wantsScreen);
  let countdownGeneration: number;
  try {
    countdownGeneration = await invoke<number>("show_countdown");
    await invoke("toolbar_set_visible", { visible: true }).catch(() => {});
  } catch (err) {
    console.error("[clips-recorder] show_countdown failed:", err);
    countdown.cleanup();
    throw err;
  }
  try {
    const cause = await countdown.event;
    console.log(`[rewind-latency] countdown completion cause=${cause}`);
  } catch (err) {
    if (isCountdownCancelledError(err)) {
      await emit("clips:toolbar-hidden").catch(() => {});
      await invoke("hide_recording_chrome").catch(() => {});
      throw err;
    }
    console.warn("[clips-recorder] countdown timed out — proceeding");
    return;
  } finally {
    countdown.cleanup();
    await invoke("finish_countdown_shortcuts", {
      generation: countdownGeneration,
    }).catch(() => {});
  }
}

function showFinalizingFeedback() {
  try {
    window.localStorage.removeItem(FINALIZING_RESULT_STORAGE_KEY);
  } catch {
    // Storage is a best-effort event-race fallback only.
  }
  // The recording pill renders the completion card in place — it holds its
  // window open via `set_toolbar_finishing` before emitting stop and consumes
  // the same upload progress/finished events — so the separate finalizing
  // window is no longer shown here.
}

function emitRecorderSession(
  serverUrl: string | null,
  recordingId: string | null,
  localOnly: boolean,
  microphoneEnabled: boolean,
) {
  const viewUrl =
    serverUrl && recordingId
      ? `${serverUrl.replace(/\/+$/, "")}/r/${recordingId}`
      : null;
  emit("clips:recorder-session", {
    viewUrl,
    recordingId,
    localOnly,
    microphoneEnabled,
  }).catch(() => {});
}

async function clearRecordingState() {
  await invoke("set_recording_state", { active: false }).catch((err) =>
    console.error("[clips-recorder] clear recording state failed:", err),
  );
}

async function publishFinalizingResult(params: {
  recordingId: string;
  viewUrl: string;
  ok: boolean;
  error?: string;
}) {
  const payload = {
    recordingId: params.recordingId,
    viewUrl: params.viewUrl,
    ok: params.ok,
    error: params.error ?? null,
    localFilePath: null,
  };
  let persisted = false;
  try {
    window.localStorage.setItem(
      FINALIZING_RESULT_STORAGE_KEY,
      JSON.stringify(payload),
    );
    persisted = true;
  } catch {
    // The event remains the normal delivery path when storage is unavailable.
  }
  await emit("clips:native-upload-finished", payload).catch((err) => {
    console.error("[clips-recorder] finalizing result event failed:", err);
    if (!persisted) {
      void invoke("hide_finalizing").catch(() => {});
    }
  });
}

function abortCreatedRecordingOnCountdownCancel(
  err: unknown,
  recordingPromise: Promise<{ id: string }>,
  serverUrl: string,
) {
  if (!isCountdownCancelledError(err)) return;
  void recordingPromise
    .then((recording) =>
      abortRecordingUpload(
        serverUrl,
        recording.id,
        "Recording cancelled during countdown",
        "user_cancelled",
      ),
    )
    .catch(() => {});
}

interface RewindClipBackendStatus {
  compatibility: "compatible" | "not-compatible";
  active: boolean;
  paused: boolean;
  retrospectiveSeconds: number;
  sources: Array<"screen" | "system-audio" | "microphone" | "camera">;
}

export interface RewindCaptureSuspensionLease {
  leaseId: string | null;
  suspendedRewind: boolean;
}

function acquireRewindCaptureSuspension(options: {
  requiresScreen: boolean;
  requiresMicrophone: boolean;
}): Promise<RewindCaptureSuspensionLease> {
  return invoke<RewindCaptureSuspensionLease>(
    "rewind_capture_suspension_acquire",
    options,
  );
}

function captureSuspensionReleaser(
  lease: RewindCaptureSuspensionLease,
): () => Promise<void> {
  let releasePromise: Promise<void> | null = null;
  return () => {
    if (!lease.leaseId) return Promise.resolve();
    releasePromise ??= invoke("rewind_capture_suspension_release", {
      leaseId: lease.leaseId,
    });
    return releasePromise;
  };
}

export function recorderWithCaptureSuspension(
  handle: RecorderHandle,
  release: () => Promise<void>,
): RecorderHandle {
  const stop = handle.stop.bind(handle);
  const cancel = handle.cancel.bind(handle);
  const discardForRestart = handle.discardForRestart.bind(handle);
  let stopPromise: Promise<RecorderStopResult> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let discardPromise: Promise<RestartHandoff> | null = null;
  handle.stop = async () => {
    if (stopPromise) return stopPromise;
    if (cancelPromise) {
      await cancelPromise;
      throw new Error("Recording was already cancelled");
    }
    if (discardPromise) {
      await discardPromise;
      throw new Error("Recording was already discarded for a restart");
    }
    stopPromise = (async () => {
      try {
        return await stop();
      } finally {
        await release();
      }
    })();
    return stopPromise;
  };
  handle.cancel = async () => {
    if (cancelPromise) return cancelPromise;
    if (stopPromise) {
      await stopPromise;
      return;
    }
    cancelPromise = (async () => {
      try {
        const handoff = await discardPromise;
        await cancel();
        [handoff?.displayStream, handoff?.audioStream].forEach((stream) =>
          stream?.getTracks().forEach((track) => track.stop()),
        );
      } finally {
        await release();
      }
    })();
    return cancelPromise;
  };
  handle.discardForRestart = async () => {
    if (discardPromise) return discardPromise;
    if (stopPromise) {
      await stopPromise;
      throw new Error("Recording was already stopped");
    }
    if (cancelPromise) {
      await cancelPromise;
      throw new Error("Recording was already cancelled");
    }
    discardPromise = (async () => {
      const handoff = await discardForRestart();
      await release().catch((err) =>
        console.error(
          "[clips-recorder] capture suspension release failed after restart discard:",
          err,
        ),
      );
      return handoff;
    })();
    return discardPromise;
  };
  return handle;
}

async function tryStartRewindFullscreenRecording(
  params: StartParams,
  wantsCamera: boolean,
  wantsAudio: boolean,
  audioCue: AudioCue,
): Promise<RecorderHandle | null> {
  if (
    params.mode === "camera" ||
    (wantsCamera && params.localRecordingMode === "separate") ||
    (params.source ?? "window") !== "full-screen"
  ) {
    return null;
  }
  const status = await invoke<RewindClipBackendStatus>(
    "rewind_clip_status",
  ).catch(() => null);
  if (!status || status.compatibility !== "compatible" || status.active) {
    return null;
  }

  const localRecordingMode = params.localRecordingMode ?? "off";
  const localOnly = localRecordingMode !== "off";
  const folderName = localOnly ? createLocalRecordingFolderName() : "";
  const includeMic = wantsAudio;
  const includeSystemAudio = params.systemAudioOn !== false;
  const hasAudio = includeMic || includeSystemAudio;
  let id = folderName;
  let uploadMode: UploadMode = "buffered";
  let transcriptionCapture: TranscriptionCapture | null = null;
  let transcriptionAborted = false;
  let transcriptFailureSaved = false;
  const saveTranscriptFailure = async (
    failureReason: string,
  ): Promise<boolean> => {
    if (localOnly || !hasAudio || transcriptFailureSaved || !id) return false;
    transcriptFailureSaved = true;
    return saveRecordingTranscriptFailure(
      params.serverUrl,
      id,
      failureReason,
      params.authToken,
    );
  };
  const canTranscribeLocally = !localOnly && includeMic;
  const startRewindTranscription = async () => {
    if (!canTranscribeLocally || transcriptionCapture) return;
    await params.pendingTranscriptionTeardown;
    if (transcriptionAborted) return;
    const capture = await startTranscriptionCapture(
      { deviceId: params.micId, label: params.micLabel },
      includeSystemAudio,
      { voiceProcessing: false },
    ).catch((err) => {
      if (params.signal?.aborted) throw err;
      console.warn("[clips-recorder] rewind transcription start failed:", err);
      return null;
    });
    if (transcriptionAborted) {
      await capture?.cancel().catch(() => {});
      return;
    }
    transcriptionCapture = capture;
    if (!capture && shouldSaveLocalTranscriptionStartupFailure()) {
      void saveTranscriptFailure(TRANSCRIPTION_START_FAILURE);
    }
  };
  const recordingPromise = localOnly
    ? Promise.resolve<{ id: string; uploadMode: UploadMode }>({
        id: folderName,
        uploadMode: "buffered",
      })
    : (async () => {
        const title = await captureTitleForRecording({
          mode: params.mode,
          source: params.source,
        });
        return createServerRecording(
          params.serverUrl,
          wantsCamera,
          hasAudio,
          title,
          {
            mimeType: NATIVE_FULLSCREEN_MIME_TYPE,
            requestStreaming: true,
            streamingUploadClient: "desktop-native",
            authToken: params.authToken,
            signal: params.signal,
          },
        );
      })();
  const countdownAbort = new AbortController();
  const abortCountdown = () => countdownAbort.abort();
  if (params.signal?.aborted) abortCountdown();
  else params.signal?.addEventListener("abort", abortCountdown, { once: true });
  try {
    const recording = await prepareRewindRecordingStart({
      async prepare() {
        const preparedRecording = await recordingPromise;
        throwIfRecordingStartAborted(params.signal);
        id = preparedRecording.id;
        uploadMode = preparedRecording.uploadMode ?? "buffered";
        await guardRecordingStart(
          invoke<RewindClipBackendStatus>("rewind_clip_prepare", {
            artifactLabel: id,
            serverUrl: localOnly ? null : params.serverUrl,
            recordingId: localOnly ? null : id,
            authToken: localOnly ? null : (params.authToken ?? ""),
            cookie: localOnly ? null : (params.cookie ?? ""),
            includeMic,
            includeSystemAudio,
            hasCamera: wantsCamera,
          }),
          { signal: params.signal },
        );
        await startRewindTranscription();
        return preparedRecording;
      },
      async countdown() {
        console.log("[rewind-latency] countdown shown; preparation overlapped");
        await runRecordingCountdown(true, countdownAbort.signal);
        console.log("[rewind-latency] countdown completed");
      },
      cancelCountdown() {
        abortCountdown();
        void emit("clips:countdown-cancel", { cause: "prepare-failed" });
      },
      async activate(preparedRecording) {
        const activationStarted = performance.now();
        await guardRecordingStart(
          invoke<RewindClipBackendStatus>("rewind_clip_start"),
          { signal: params.signal },
        );
        console.log(
          `[rewind-latency] countdown completion to start acknowledgement ${Math.round(performance.now() - activationStarted)}ms`,
        );
        await transcriptionCapture?.resetTimeline().catch((err) => {
          console.warn(
            "[clips-recorder] transcription timeline reset failed:",
            err,
          );
        });
        return preparedRecording;
      },
      onActivated() {
        void audioCue.playBeforeCapture();
      },
    });
    params.signal?.removeEventListener("abort", abortCountdown);
    id = recording.id;
    const originalStartedAt = new Date().toISOString();
    if (!localOnly) {
      rememberRewindClipOrigin({
        recordingId: id,
        startedAt: originalStartedAt,
        includeMicrophone: includeMic,
        includeSystemAudio,
        rememberedAt: originalStartedAt,
      });
    }
  } catch (err) {
    params.signal?.removeEventListener("abort", abortCountdown);
    transcriptionAborted = true;
    await (transcriptionCapture as TranscriptionCapture | null)
      ?.cancel()
      .catch(() => {});
    if (id) forgetRewindClipOrigin(id);
    await invoke("rewind_clip_cancel").catch(() => {});
    audioCue.cleanup();
    if (!localOnly) {
      abortCreatedRecordingOnCountdownCancel(
        err,
        recordingPromise,
        params.serverUrl,
      );
    }
    if (!localOnly && id && !isCountdownCancelledError(err)) {
      const diagnostics = uploadFailureDiagnostics(err);
      await abortRecordingUpload(
        params.serverUrl,
        id,
        err instanceof Error ? err.message : String(err),
        diagnostics.failureCode,
        diagnostics.failureStage,
        diagnostics.httpStatus,
      );
    }
    throw err;
  }

  let stopped = false;
  let stopPromise: Promise<RecorderStopResult> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let discardPromise: Promise<RestartHandoff> | null = null;
  let stateUnlistens: UnlistenFn[] = [];
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let pausedAt: number | null = null;
  let pauseRequestedAt: number | null = null;
  let accumulatedPauseMs = 0;
  const startedAt = Date.now();
  let pauseQueue: PauseTransitionQueue | null = null;

  const emitState = (
    paused = pauseQueue?.getDesiredPaused() ?? pausedAt !== null,
  ) => {
    const now = Date.now();
    const pauseStart = pausedAt ?? (paused ? pauseRequestedAt : null);
    emit("clips:recorder-state", {
      paused,
      elapsedMs: Math.max(
        0,
        now -
          startedAt -
          accumulatedPauseMs -
          (paused && pauseStart !== null ? now - pauseStart : 0),
      ),
    }).catch(() => {});
  };
  const cleanupUi = () => {
    pauseQueue?.dispose();
    if (tickHandle) window.clearInterval(tickHandle);
    tickHandle = null;
    stateUnlistens.forEach((unlisten) => unlisten());
    stateUnlistens = [];
  };

  const endSession = async () => {
    await invoke("hide_overlays").catch(() => {});
    await clearRecordingState();
  };

  const discardTake = async (forRestart: boolean): Promise<RestartHandoff> => {
    stopped = true;
    cleanupUi();
    transcriptionAborted = true;
    const transcriptionTornDown = transcriptionCapture
      ?.cancel()
      .catch((err) => {
        console.warn("[clips-recorder] transcription cancel failed:", err);
      });
    await invoke("rewind_clip_cancel").catch(() => {});
    audioCue.cleanup();
    if (forRestart) {
      await invoke("hide_recording_chrome").catch(() => {});
    } else {
      await endSession();
    }
    if (!localOnly && id) {
      forgetRewindClipOrigin(id);
      void cleanupCancelledRemoteRecording(params.serverUrl, id).catch(
        (err) => {
          console.warn(
            "[clips-recorder] cancelled recording cleanup failed:",
            err,
          );
        },
      );
    }
    return {
      displayStream: null,
      audioStream: null,
      transcriptionTornDown: forRestart
        ? (transcriptionTornDown ?? null)
        : null,
    };
  };

  const handle: RecorderHandle = {
    async stop() {
      if (stopPromise) return stopPromise;
      if (cancelPromise) {
        await cancelPromise;
        throw new Error("Recording was already cancelled");
      }
      if (discardPromise) {
        await discardPromise;
        throw new Error("Recording was already discarded for a restart");
      }
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopPromise = (async () => {
        stopped = true;
        cleanupUi();
        if (!localOnly) showFinalizingFeedback();
        try {
          if (localOnly) {
            const savePromise = invoke<NativeFullscreenSaveResult>(
              "rewind_clip_stop_and_save",
              {
                folderName,
                fileRole: "desktop",
                includeMic,
                includeSystemAudio,
              },
            );
            savePromise.catch(() => {});
            await invoke("hide_recording_chrome").catch(() => {});
            if (wantsCamera) await invoke("close_bubble").catch(() => {});
            const saved = await savePromise;
            return {
              recordingId: saved.recordingId,
              viewUrl: "",
              localOnly: true,
              localFolder: saved.folderPath,
              localFiles: [saved.file],
            };
          }

          const viewUrl = `/r/${id}`;
          const stopStarted = performance.now();
          const uploadPromise = invoke<NativeFullscreenUploadResult>(
            "rewind_clip_stop_and_upload",
            {
              serverUrl: params.serverUrl,
              recordingId: id,
              authToken: params.authToken ?? "",
              cookie: params.cookie ?? "",
              uploadMode,
              includeMic,
              includeSystemAudio,
              hasCamera: wantsCamera,
            },
          );
          console.log(
            `[rewind-latency] stop command dispatched in ${Math.round(performance.now() - stopStarted)}ms`,
          );
          uploadPromise.catch(() => {});
          const capturedTranscript = await transcriptionCapture
            ?.stop()
            .catch((err) => {
              console.warn("[clips-recorder] transcript stop failed:", err);
              return null;
            });
          const transcriptSavePromise = capturedTranscript?.text.trim()
            ? saveRecordingTranscript(
                params.serverUrl,
                id,
                capturedTranscript,
                params.authToken,
              )
            : hasAudio
              ? saveTranscriptFailure(NO_SPEECH_TRANSCRIPT_FAILURE)
              : Promise.resolve(true);
          await invoke("hide_recording_chrome").catch(() => {});
          if (wantsCamera) await invoke("close_bubble").catch(() => {});
          try {
            const uploaded = await uploadPromise;
            if (uploaded.verificationPending) {
              scheduleNativeBackupCleanupAfterProcessing({
                serverUrl: params.serverUrl,
                recordingId: id,
                authToken: params.authToken,
              });
            }
            if (
              !(await transcriptSavePromise) &&
              capturedTranscript?.text.trim()
            ) {
              void saveRecordingTranscript(
                params.serverUrl,
                id,
                capturedTranscript,
                params.authToken,
              );
            }
            return { recordingId: uploaded.recordingId, viewUrl };
          } catch (err) {
            if (
              await recoverAcceptedNativeRecordingAfterFinalizeError({
                serverUrl: params.serverUrl,
                recordingId: id,
                authToken: params.authToken,
              })
            ) {
              return { recordingId: id, viewUrl };
            }
            await interruptRecordingUpload(
              params.serverUrl,
              id,
              err instanceof Error ? err.message : String(err),
              params.authToken,
              undefined,
              undefined,
              uploadFailureDiagnostics(err),
            );
            throw err;
          }
        } finally {
          audioCue.cleanup();
          await clearRecordingState();
        }
      })();
      return stopPromise;
    },
    async cancel() {
      if (cancelPromise) return cancelPromise;
      if (discardPromise) {
        cancelPromise = discardPromise.then(endSession);
        return cancelPromise;
      }
      if (stopped) return;
      cancelPromise = discardTake(false).then(() => {});
      return cancelPromise;
    },
    async discardForRestart() {
      if (discardPromise) return discardPromise;
      if (cancelPromise) {
        await cancelPromise;
        throw new Error("Recording was already cancelled");
      }
      if (stopped) {
        throw new Error("Recording already finished — nothing to restart");
      }
      discardPromise = discardTake(true);
      return discardPromise;
    },
  };

  pauseQueue = createPauseTransitionQueue({
    apply: (paused) =>
      invoke(paused ? "rewind_clip_pause" : "rewind_clip_resume"),
    onRequested(paused) {
      if (paused && pausedAt === null) pauseRequestedAt = Date.now();
      emitState(paused);
    },
    onApplied(paused) {
      if (paused) {
        pausedAt = pauseRequestedAt ?? Date.now();
      } else {
        if (pausedAt !== null) accumulatedPauseMs += Date.now() - pausedAt;
        pausedAt = null;
      }
      pauseRequestedAt = null;
      void (
        paused ? transcriptionCapture?.pause() : transcriptionCapture?.resume()
      )?.catch(() => {});
      emitState(paused);
    },
    onError(_err, _attemptedPaused) {
      pauseRequestedAt = null;
      emitState(pauseQueue?.getAppliedPaused() ?? pausedAt !== null);
    },
  });
  stateUnlistens = await Promise.all([
    listen("clips:recorder-pause", () => pauseQueue?.request(true)),
    listen("clips:recorder-resume", () => pauseQueue?.request(false)),
    listen("clips:recorder-toggle-pause", () =>
      pauseQueue?.request(
        !(pauseQueue?.getDesiredPaused() ?? pausedAt !== null),
      ),
    ),
    listen("clips:recorder-stop", () => {
      void handle.stop().catch((error) => {
        console.error("[clips-recorder] Rewind handle.stop() threw:", error);
      });
    }),
    listen("clips:recorder-cancel", () => {
      void handle.cancel().catch((error) => {
        console.error("[clips-recorder] Rewind handle.cancel() threw:", error);
      });
    }),
    listen("clips:toolbar-ready", () => {
      emit("clips:toolbar-enabled", !stopped).catch(() => {});
      emitRecorderSession(
        localOnly ? null : params.serverUrl,
        id || null,
        localOnly,
        params.micOn,
      );
      emitState();
    }),
  ]);
  tickHandle = window.setInterval(emitState, 500);
  emit("clips:toolbar-sync").catch(() => {});
  emit("clips:toolbar-enabled", true).catch(() => {});
  emitRecorderSession(
    localOnly ? null : params.serverUrl,
    id || null,
    localOnly,
    params.micOn,
  );
  emitState();
  return handle;
}

async function startNativeFullscreenRecording(
  params: StartParams,
  wantsCamera: boolean,
  wantsAudio: boolean,
  audioCue: AudioCue,
): Promise<RecorderHandle> {
  console.log("[clips-recorder] using native macOS capture");
  const localRecordingMode = params.localRecordingMode ?? "off";
  const localOnly = localRecordingMode !== "off";
  const localFolderName = localOnly ? createLocalRecordingFolderName() : "";
  const streamCleanups: Array<() => void> = [() => audioCue.cleanup()];
  let id = "";
  let uploadMode: UploadMode = "buffered";
  let localCameraExport: LocalRecordingExportHandle | null = null;
  let localCameraStream: MediaStream | null = null;
  let localOwnsCameraStream = false;
  let bubbleCaptureExcluded = false;
  let captureRegion: RegionCaptureRect | null = null;
  let transcriptionCapture: TranscriptionCapture | null = null;
  let countdownPromise: Promise<void> | null = null;
  let startupFailed = false;
  const assertStartupActive = () => {
    throwIfRecordingStartAborted(params.signal);
    if (startupFailed) throw new RecordingStartCancelledError();
  };
  let startedAt = 0;
  let nativeTranscriptFailureSaved = false;
  const wantsSystemAudio = shouldRequestSystemAudio(true, params.systemAudioOn);
  const wantsRecordedAudio = wantsAudio || wantsSystemAudio;
  const canTranscribeLocally =
    shouldStartLocalRecordingTranscription(wantsAudio);
  const micDeviceLabel = params.micLabel?.trim() || null;
  const saveTranscriptFailure = async (
    failureReason: string,
  ): Promise<boolean> => {
    if (!wantsRecordedAudio || nativeTranscriptFailureSaved || !id)
      return false;
    nativeTranscriptFailureSaved = true;
    return saveRecordingTranscriptFailure(
      params.serverUrl,
      id,
      failureReason,
      params.authToken,
    );
  };
  const startNativeTranscriptionBeforeRecording = async () => {
    if (localOnly || !canTranscribeLocally || transcriptionCapture) return;
    await params.pendingTranscriptionTeardown;
    assertStartupActive();
    transcriptionCapture = await guardRecordingStart(
      startTranscriptionCapture(
        {
          deviceId: params.micId,
          label: micDeviceLabel,
        },
        wantsSystemAudio,
        { voiceProcessing: false },
      ),
      {
        signal: params.signal,
        onLateResolve: (capture) => {
          void capture?.cancel().catch(() => {});
        },
      },
    );
    if (params.signal?.aborted || startupFailed) {
      await transcriptionCapture?.cancel().catch(() => {});
      transcriptionCapture = null;
      throw new RecordingStartCancelledError();
    }
    if (
      canTranscribeLocally &&
      !transcriptionCapture &&
      shouldSaveLocalTranscriptionStartupFailure()
    ) {
      void saveTranscriptFailure(TRANSCRIPTION_START_FAILURE);
    }
  };

  try {
    throwIfRecordingStartAborted(params.signal);
    await invoke("park_popover_offscreen").catch(() => {});
    emit("clips:popover-visible", false).catch(() => {});

    if (params.source === "region") {
      captureRegion = await selectRegionForRecording();
      await showRegionRecordBorder(captureRegion);
    }
    countdownPromise = runRecordingCountdown(true, params.signal);
    void countdownPromise.catch(() => {
      startupFailed = true;
    });

    if (localOnly && localRecordingMode === "separate" && wantsCamera) {
      localCameraStream =
        params.preAcquiredCameraStream ??
        (await getCameraStreamWithFallback(params.cameraId));
      localOwnsCameraStream =
        localCameraStream !== params.preAcquiredCameraStream;
      localCameraExport = await prepareLocalRecordingExport(
        [
          {
            role: "camera",
            stream: streamFromTracks(localCameraStream.getVideoTracks()),
          },
        ],
        { folderName: localFolderName },
      );
      await invoke("set_bubble_capture_excluded", {
        excluded: true,
      }).catch((err) => {
        console.warn(
          "[clips-recorder] could not exclude bubble from native local desktop capture:",
          err,
        );
      });
      bubbleCaptureExcluded = true;
    }

    console.log(
      localOnly
        ? "[clips-recorder] invoking show_countdown for native local recording"
        : "[clips-recorder] invoking show_countdown + createServerRecording",
    );
    const captureAudioParams = {
      includeAudio: wantsAudio,
      captureSystemAudio: wantsSystemAudio,
      micDeviceId: params.micId || null,
      micDeviceLabel,
      captureRegion,
    };
    const warmMic = async (recordingId: string) => {
      assertStartupActive();
      // never let begin race a warm invoke that is still creating its stream.
      await guardRecordingStart(
        invoke("native_fullscreen_recording_warm", {
          recordingId,
          ...captureAudioParams,
        }),
        { signal: params.signal },
      );
      assertStartupActive();
    };
    const clickStartedAt = Date.now();
    if (localOnly) {
      id = localFolderName;
      const warmPromise = (async () => {
        const warmStartedAt = Date.now();
        await warmMic(id);
        console.log(
          `[clips-recorder] native warm durations: warmMs=${Date.now() - warmStartedAt}`,
        );
      })();
      await Promise.all([countdownPromise, warmPromise]);
    } else {
      const captureTitlePromise = captureTitleForRecording({
        mode: params.mode,
        source: params.source,
      });
      const recordingPromise = (async () => {
        const captureTitle = await captureTitlePromise;
        assertStartupActive();
        const createStartedAt = Date.now();
        try {
          return await createServerRecording(
            params.serverUrl,
            wantsCamera,
            wantsRecordedAudio,
            captureTitle,
            {
              mimeType: NATIVE_FULLSCREEN_MIME_TYPE,
              requestStreaming: true,
              streamingUploadClient: "desktop-native",
              authToken: params.authToken,
              signal: params.signal,
            },
          );
        } finally {
          console.log(
            `[clips-recorder] createServerRecording durationMs=${Date.now() - createStartedAt}`,
          );
        }
      })();
      const warmAndId = planNativeFullscreenWarmOverlap({
        createRecording: async () => {
          const createRes = await recordingPromise;
          uploadMode = createRes.uploadMode;
          id = createRes.id;
          return createRes;
        },
        startTranscription: async () => {
          const transcriptionStartedAt = Date.now();
          try {
            await startNativeTranscriptionBeforeRecording();
          } finally {
            console.log(
              `[clips-recorder] transcription warm durationMs=${Date.now() - transcriptionStartedAt}`,
            );
          }
        },
        warmMic: async (recordingId) => {
          const warmStartedAt = Date.now();
          try {
            await warmMic(recordingId);
          } finally {
            console.log(
              `[clips-recorder] native warm durationMs=${Date.now() - warmStartedAt}`,
            );
          }
        },
      });
      try {
        const [, createRes] = await Promise.all([countdownPromise, warmAndId]);
        id = createRes.id;
        uploadMode = createRes.uploadMode ?? uploadMode;
      } catch (err) {
        abortCreatedRecordingOnCountdownCancel(
          err,
          recordingPromise,
          params.serverUrl,
        );
        throw err;
      }
    }

    await audioCue.playBeforeCapture();
    assertStartupActive();
    const beginStartedAt = Date.now();
    await guardRecordingStart(
      invoke("native_fullscreen_recording_begin", {
        recordingId: id,
        ...captureAudioParams,
        localOnly,
        hasCamera: wantsCamera,
      }),
      { signal: params.signal },
    );
    assertStartupActive();
    console.log(
      `[clips-recorder] native begin durationMs=${Date.now() - beginStartedAt} clickToLiveMs=${Date.now() - clickStartedAt}`,
    );
    await (transcriptionCapture as TranscriptionCapture | null)
      ?.resetTimeline()
      .catch((err) => {
        console.warn(
          "[clips-recorder] transcription timeline reset failed:",
          err,
        );
      });
    assertStartupActive();
    startedAt = Date.now();
    emit("clips:toolbar-enabled", true).catch(() => {});
    emitRecorderSession(
      localOnly ? null : params.serverUrl,
      id || null,
      localOnly,
      params.micOn,
    );
    emit("clips:recorder-state", {
      paused: false,
      elapsedMs: 0,
    }).catch(() => {});
    localCameraExport?.start(2_000);
  } catch (err) {
    startupFailed = true;
    if (countdownPromise) {
      await emit("clips:countdown-cancel").catch(() => {});
      await countdownPromise.catch(() => {});
    }
    await localCameraExport?.cancel().catch(() => {});
    await (transcriptionCapture as TranscriptionCapture | null)
      ?.cancel()
      .catch((cancelErr) => {
        console.warn(
          "[clips-recorder] native transcription cancel after start failure failed:",
          cancelErr,
        );
      });
    await invoke("native_fullscreen_recording_cancel").catch(() => {});
    if (bubbleCaptureExcluded) {
      await invoke("set_bubble_capture_excluded", {
        excluded: false,
      }).catch(() => {});
    }
    if (localOwnsCameraStream) {
      localCameraStream?.getTracks().forEach((track) => track.stop());
    }
    streamCleanups.forEach((cleanup) => cleanup());
    if (!localOnly && id) {
      const diagnostics = uploadFailureDiagnostics(err);
      await abortRecordingUpload(
        params.serverUrl,
        id,
        err instanceof Error ? err.message : String(err),
        diagnostics.failureCode,
        diagnostics.failureStage,
        diagnostics.httpStatus,
      );
    }
    throw err;
  }

  let stopped = false;
  let stopPromise: Promise<RecorderStopResult> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let discardPromise: Promise<RestartHandoff> | null = null;
  let stateUnlistens: UnlistenFn[] = [];
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let segmentRotateHandle: ReturnType<typeof setInterval> | null = null;
  let segmentRotateInFlight = false;
  let pausedAt: number | null = null;
  let pauseRequestedAt: number | null = null;
  let accumulatedPauseMs = 0;
  let pauseQueue: PauseTransitionQueue | null = null;

  function clearSegmentRotator() {
    if (segmentRotateHandle) {
      clearInterval(segmentRotateHandle);
      segmentRotateHandle = null;
    }
  }

  function startSegmentRotator() {
    clearSegmentRotator();
    segmentRotateHandle = setInterval(() => {
      if (
        stopped ||
        pauseQueue?.getDesiredPaused() ||
        pausedAt !== null ||
        segmentRotateInFlight
      ) {
        return;
      }
      segmentRotateInFlight = true;
      invoke("native_fullscreen_recording_rotate_segment")
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[clips-recorder] native segment rotation failed:", err);
          if (
            !stopped &&
            pausedAt === null &&
            message.includes("paused recording")
          ) {
            pausedAt = Date.now();
            pauseQueue?.synchronize(true);
            emitState();
          }
        })
        .finally(() => {
          segmentRotateInFlight = false;
        });
    }, NATIVE_FULLSCREEN_SEGMENT_MS);
  }

  function emitState(
    paused = pauseQueue?.getDesiredPaused() ?? pausedAt !== null,
  ) {
    const now = Date.now();
    const displayedPauseStartedAt =
      pausedAt ?? (paused ? pauseRequestedAt : null);
    const pausedNowMs =
      paused && displayedPauseStartedAt !== null
        ? now - displayedPauseStartedAt
        : 0;
    const elapsedMs = Math.max(
      0,
      now - startedAt - accumulatedPauseMs - pausedNowMs,
    );
    emit("clips:recorder-state", {
      paused,
      elapsedMs,
    }).catch(() => {});
  }

  const endSession = async () => {
    await invoke("hide_overlays").catch(() => {});
  };

  const discardTake = async (forRestart: boolean): Promise<RestartHandoff> => {
    stopped = true;
    clearSegmentRotator();
    pauseQueue?.dispose();
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    stateUnlistens.forEach((u) => u());
    stateUnlistens = [];
    const transcriptionTornDown = transcriptionCapture
      ?.cancel()
      .catch((err) => {
        console.warn(
          "[clips-recorder] native transcription cancel failed:",
          err,
        );
      });
    await localCameraExport?.cancel().catch(() => {});
    await invoke("native_fullscreen_recording_cancel", {
      preserveDisplayOverride: forRestart,
      preserveWindowOverride: forRestart,
    }).catch((err) =>
      console.warn("[clips-recorder] native fullscreen cancel failed:", err),
    );
    if (bubbleCaptureExcluded) {
      await invoke("set_bubble_capture_excluded", { excluded: false }).catch(
        () => {},
      );
      bubbleCaptureExcluded = false;
    }
    if (localOwnsCameraStream) {
      localCameraStream?.getTracks().forEach((track) => track.stop());
    }
    streamCleanups.forEach((cleanup) => cleanup());
    if (forRestart) {
      await invoke("hide_recording_chrome", {
        preserveDisplayOverride: true,
        preserveWindowOverride: true,
      }).catch(() => {});
    } else {
      await endSession();
    }
    if (!localOnly && id) {
      void cleanupCancelledRemoteRecording(params.serverUrl, id).catch(
        (err) => {
          console.warn(
            "[clips-recorder] cancelled recording cleanup failed:",
            err,
          );
        },
      );
    }
    return {
      displayStream: null,
      audioStream: null,
      transcriptionTornDown: forRestart
        ? (transcriptionTornDown ?? null)
        : null,
    };
  };

  const handle: RecorderHandle = {
    async stop() {
      if (stopPromise) return stopPromise;
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopPromise = (async () => {
        stopped = true;
        console.log("[clips-recorder] native full-screen stop requested");
        if (!localOnly) showFinalizingFeedback();
        await invoke("hide_recording_chrome").catch((err) =>
          console.error(
            "[clips-recorder] immediate hide_recording_chrome after stop failed:",
            err,
          ),
        );
        if (wantsCamera) {
          await invoke("close_bubble").catch((err) =>
            console.error(
              "[clips-recorder] immediate close_bubble after stop failed:",
              err,
            ),
          );
        }
        clearSegmentRotator();
        pauseQueue?.dispose();
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        stateUnlistens.forEach((u) => u());
        stateUnlistens = [];
        if (pausedAt != null) {
          accumulatedPauseMs += Date.now() - pausedAt;
          pausedAt = null;
        }

        if (localOnly) {
          const durationMs = Math.max(0, Date.now() - startedAt);
          try {
            const [nativeResult, cameraFiles] = await Promise.all([
              invoke<NativeFullscreenSaveResult>(
                "native_fullscreen_recording_stop_and_save",
                {
                  folderName: localFolderName,
                  fileRole:
                    localRecordingMode === "composed" ? "composed" : "desktop",
                },
              ),
              localCameraExport
                ? localCameraExport.stop(durationMs)
                : Promise.resolve([]),
            ]);
            await invoke("hide_recording_chrome").catch((err) =>
              console.error(
                "[clips-recorder] hide_recording_chrome failed:",
                err,
              ),
            );
            return {
              recordingId: nativeResult.recordingId,
              viewUrl: "",
              localOnly: true,
              localFolder: nativeResult.folderPath,
              localFiles: [nativeResult.file, ...cameraFiles],
            };
          } finally {
            if (bubbleCaptureExcluded) {
              await invoke("set_bubble_capture_excluded", {
                excluded: false,
              }).catch(() => {});
              bubbleCaptureExcluded = false;
            }
            if (localOwnsCameraStream) {
              localCameraStream?.getTracks().forEach((track) => track.stop());
            }
            streamCleanups.forEach((cleanup) => cleanup());
          }
        }

        let uploadResult: NativeFullscreenUploadResult | null = null;
        const viewUrl = `/r/${id}`;

        let signalRecorderFinalized: () => void = () => {};
        const recorderFinalized = new Promise<void>((resolve) => {
          signalRecorderFinalized = resolve;
        });
        const unlistenFinalized = await listen<string>(
          "clips:native-recording-finalized",
          (event) => {
            if (!event.payload || event.payload === id) {
              signalRecorderFinalized();
            }
          },
        );

        const uploadPromise = invoke<NativeFullscreenUploadResult>(
          "native_fullscreen_recording_stop_and_upload",
          {
            serverUrl: params.serverUrl,
            recordingId: id,
            authToken: params.authToken ?? "",
            cookie: params.cookie ?? "",
            uploadMode,
            hasAudio: wantsRecordedAudio,
            hasCamera: wantsCamera,
          },
        );
        uploadPromise.catch(() => {});
        try {
          await Promise.race([
            recorderFinalized,
            new Promise<void>((resolve) => window.setTimeout(resolve, 15000)),
          ]);
          unlistenFinalized();

          const capturedTranscript = await transcriptionCapture
            ?.stop()
            .catch((err) => {
              console.warn("[clips-recorder] transcript stop failed:", err);
              return null;
            });
          const transcriptSavePromise = capturedTranscript?.text.trim()
            ? saveRecordingTranscript(
                params.serverUrl,
                id,
                capturedTranscript,
                params.authToken,
              )
            : wantsRecordedAudio
              ? saveTranscriptFailure(NO_SPEECH_TRANSCRIPT_FAILURE)
              : Promise.resolve(true);

          await invoke("hide_recording_chrome").catch((err) =>
            console.error(
              "[clips-recorder] hide_recording_chrome failed:",
              err,
            ),
          );
          try {
            uploadResult = await uploadPromise;
          } catch (err) {
            if (
              await recoverAcceptedNativeRecordingAfterFinalizeError({
                serverUrl: params.serverUrl,
                recordingId: id,
                authToken: params.authToken,
              })
            ) {
              return { recordingId: id, viewUrl };
            }
            await interruptRecordingUpload(
              params.serverUrl,
              id,
              err instanceof Error ? err.message : String(err),
              params.authToken,
              undefined,
              undefined,
              uploadFailureDiagnostics(err),
            );
            throw err;
          }
          if (uploadResult.verificationPending) {
            scheduleNativeBackupCleanupAfterProcessing({
              serverUrl: params.serverUrl,
              recordingId: id,
              authToken: params.authToken,
            });
          }
          const transcriptSaved = await transcriptSavePromise;
          if (!transcriptSaved && capturedTranscript?.text.trim()) {
            void saveRecordingTranscript(
              params.serverUrl,
              id,
              capturedTranscript,
              params.authToken,
            );
          }

          return {
            recordingId: uploadResult.recordingId,
            viewUrl,
          };
        } finally {
          streamCleanups.forEach((cleanup) => cleanup());
          await clearRecordingState();
        }
      })();
      return stopPromise;
    },

    async cancel() {
      if (cancelPromise) return cancelPromise;
      if (discardPromise) {
        cancelPromise = discardPromise.then(endSession);
        return cancelPromise;
      }
      if (stopped) return;
      cancelPromise = discardTake(false).then(() => {});
      return cancelPromise;
    },

    async discardForRestart() {
      if (discardPromise) return discardPromise;
      if (cancelPromise) {
        await cancelPromise;
        throw new Error("Recording was already cancelled");
      }
      if (stopped) {
        throw new Error("Recording already finished — nothing to restart");
      }
      discardPromise = discardTake(true);
      return discardPromise;
    },
  };

  pauseQueue = createPauseTransitionQueue({
    apply: (paused) =>
      invoke(
        paused
          ? "native_fullscreen_recording_pause"
          : "native_fullscreen_recording_resume",
      ),
    onRequested(paused) {
      if (paused && pausedAt === null && pauseRequestedAt === null) {
        pauseRequestedAt = Date.now();
      }
      emitState(paused);
    },
    onApplied(paused) {
      if (paused) {
        pausedAt = pauseRequestedAt ?? Date.now();
        pauseRequestedAt = null;
        console.log("[clips-recorder] native pause: pausing transcription");
        void transcriptionCapture?.pause().catch(() => {});
      } else {
        if (pausedAt !== null) {
          accumulatedPauseMs += Date.now() - pausedAt;
        }
        pausedAt = null;
        pauseRequestedAt = null;
        console.log("[clips-recorder] native resume: resuming transcription");
        void transcriptionCapture?.resume().catch(() => {});
      }
      emitState(pauseQueue?.getDesiredPaused() ?? paused);
    },
    onError(err, attemptedPaused) {
      pauseRequestedAt = null;
      emitState(pauseQueue?.getAppliedPaused() ?? pausedAt !== null);
      console.warn(
        `[clips-recorder] native ${attemptedPaused ? "pause" : "resume"} failed:`,
        err,
      );
    },
  });

  const toolbarUnlistens = await Promise.all([
    listen("clips:recorder-pause", () => {
      pauseQueue?.request(true);
    }),
    listen("clips:recorder-resume", () => {
      pauseQueue?.request(false);
    }),
    listen("clips:recorder-toggle-pause", () => {
      pauseQueue?.request(
        !(pauseQueue?.getDesiredPaused() ?? pausedAt !== null),
      );
    }),
    listen("clips:recorder-stop", () => {
      console.log("[clips-recorder] native stop event received");
      handle.stop().catch((err) => {
        console.error("[clips-recorder] native handle.stop() threw:", err);
      });
    }),
    listen("clips:recorder-cancel", () => {
      console.log("[clips-recorder] native cancel event received");
      handle.cancel().catch((err) => {
        console.error("[clips-recorder] native handle.cancel() threw:", err);
      });
    }),
    listen("clips:toolbar-ready", () => {
      emit("clips:toolbar-enabled", !stopped).catch(() => {});
      emitRecorderSession(
        localOnly ? null : params.serverUrl,
        id || null,
        localOnly,
        params.micOn,
      );
      emitState();
    }),
  ]);
  stateUnlistens = toolbarUnlistens;
  tickHandle = setInterval(emitState, 500);
  startSegmentRotator();
  emit("clips:toolbar-sync").catch(() => {});
  emit("clips:toolbar-enabled", true).catch(() => {});
  emitRecorderSession(
    localOnly ? null : params.serverUrl,
    id || null,
    localOnly,
    params.micOn,
  );
  emitState();

  if (!localOnly) {
    if (pausedAt != null && transcriptionCapture) {
      console.log(
        "[clips-recorder] native: paused during startup, pausing transcription",
      );
      void (transcriptionCapture as TranscriptionCapture)
        .pause()
        .catch(() => {});
    }
  }

  return handle;
}

function createSyntheticScreenStream(): {
  stream: MediaStream;
  cleanup: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.captureStream !== "function") {
    throw new Error("Synthetic capture unavailable in this WebView");
  }
  const startedAt = Date.now();
  const draw = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const hue = (elapsed * 24) % 360;
    ctx.fillStyle = `hsl(${hue}, 70%, 16%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(i * 120 - ((elapsed * 8) % 120), 0, 52, canvas.height);
    }
    ctx.fillStyle = "white";
    ctx.font = "700 54px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText("Clips desktop synthetic capture", 64, 112);
    ctx.font = "500 32px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(`Elapsed ${elapsed.toString().padStart(2, "0")}s`, 64, 170);
    ctx.font = "400 24px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText("Dev synthetic capture is enabled for this session.", 64, 220);
    ctx.fillText(
      'Disable localStorage "clips:dev-synthetic-capture" to record your screen.',
      64,
      258,
    );
  };
  draw();
  const interval = window.setInterval(draw, 250);
  const stream = canvas.captureStream(CLOUD_CAPTURE_FRAME_RATE);
  return {
    stream,
    cleanup: () => {
      window.clearInterval(interval);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

function createSyntheticAudioStream(): {
  stream: MediaStream;
  cleanup: () => void;
} | null {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.015;
    oscillator.connect(gain);
    gain.connect(dest);
    oscillator.start();
    return {
      stream: dest.stream,
      cleanup: () => {
        try {
          oscillator.stop();
        } catch {
          // ignore
        }
        dest.stream.getTracks().forEach((track) => track.stop());
        ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    console.warn("[clips-recorder] synthetic audio unavailable:", err);
    return null;
  }
}

function bubbleSizeRatioForName(size: string | null | undefined): number {
  return size === "medium" ? 0.24 : 0.18;
}

export async function startRecording(
  params: StartParams,
): Promise<RecorderHandle> {
  const startController = new AbortController();
  const cancelStartup = () => {
    startController.abort();
    void emit("clips:countdown-cancel").catch(() => {});
    void invoke("native_fullscreen_recording_cancel").catch(() => {});
    void invoke("hide_recording_chrome").catch(() => {});
  };
  const startPromise = startRecordingInner({
    ...params,
    signal: startController.signal,
  });
  try {
    return await guardRecordingStart(startPromise, {
      signal: params.signal,
      timeoutMs: RECORDING_START_TIMEOUT_MS,
      onCancel: cancelStartup,
      onLateResolve: (handle) => {
        void handle.cancel().catch((err) => {
          console.warn("[clips-recorder] late start cleanup failed:", err);
        });
      },
    });
  } catch (err) {
    await boundedCleanup(invoke("hide_recording_chrome"));
    const e = err as { name?: string; message?: string } | null;
    console.error(
      "[clips-recorder] startRecording threw:",
      e?.name,
      e?.message,
      err,
    );
    throw err;
  }
}

export function resolveRestartHandoff(
  params: StartParams,
  wantsScreen: boolean,
  wantsAudio: boolean,
): RestartHandoff {
  const stopStream = (stream: MediaStream | null) =>
    stream?.getTracks().forEach((track) => track.stop());
  const isLive = (stream: MediaStream) =>
    stream.getTracks().length > 0 &&
    stream.getTracks().every((track) => track.readyState === "live");

  let displayStream = params.preAcquiredDisplayStream ?? null;
  let audioStream = params.preAcquiredAudioStream ?? null;

  if (displayStream && !wantsScreen) {
    stopStream(displayStream);
    displayStream = null;
  }
  if (audioStream && (!wantsAudio || !isLive(audioStream))) {
    stopStream(audioStream);
    audioStream = null;
  }

  if (displayStream && !isLive(displayStream)) {
    stopStream(displayStream);
    stopStream(audioStream);
    throw new Error(RESTART_CAPTURE_ENDED_MESSAGE);
  }
  return {
    displayStream,
    audioStream,
    transcriptionTornDown: params.pendingTranscriptionTeardown,
  };
}

async function startRecordingInner(
  params: StartParams,
): Promise<RecorderHandle> {
  const wantsScreen = params.mode !== "camera";
  const wantsCamera = params.mode !== "screen" && params.cameraOn;
  const wantsAudio = params.micOn;
  const restartHandoff = resolveRestartHandoff(params, wantsScreen, wantsAudio);
  const wantsSystemAudio = shouldRequestSystemAudio(
    wantsScreen,
    params.systemAudioOn,
  );
  const wantsRecordedAudio = wantsAudio || wantsSystemAudio;
  const canTranscribeLocally =
    shouldStartLocalRecordingTranscription(wantsAudio);
  const audioCue = createAudioCue();
  const captureSource = params.source ?? "window";
  const localRecordingMode = params.localRecordingMode ?? "off";
  console.log("[clips-recorder] startRecording", {
    serverUrl: params.serverUrl,
    mode: params.mode,
    source: captureSource,
    localRecordingMode,
    wantsScreen,
    wantsCamera,
    wantsAudio,
    wantsSystemAudio,
  });

  const nativeFullscreenCapture =
    shouldUseNativeFullscreenRecording(captureSource);
  const nativeWindowCapture = shouldUseNativeWindowRecording(captureSource);
  if (wantsScreen && (nativeFullscreenCapture || nativeWindowCapture)) {
    const rewindRecorder = nativeFullscreenCapture
      ? await tryStartRewindFullscreenRecording(
          params,
          wantsCamera,
          wantsAudio,
          audioCue,
        )
      : null;
    if (rewindRecorder) return rewindRecorder;
    const suspension =
      params.preAcquiredCaptureSuspension ??
      (nativeFullscreenCapture || nativeWindowCapture
        ? await acquireRewindCaptureSuspension({
            requiresScreen: true,
            requiresMicrophone: wantsAudio,
          })
        : null);
    const releaseSuspension = suspension
      ? captureSuspensionReleaser(suspension)
      : null;
    try {
      const recorder = await startNativeFullscreenRecording(
        params,
        wantsCamera,
        wantsAudio,
        audioCue,
      );
      return releaseSuspension
        ? recorderWithCaptureSuspension(recorder, releaseSuspension)
        : recorder;
    } catch (err) {
      await releaseSuspension?.();
      throw err;
    }
  }

  if (wantsCamera) {
    console.log(
      "[clips-recorder] acquiring camera in popover (owner for bubble overlay)",
    );
  }
  if (wantsScreen) {
    console.log("[clips-recorder] requesting display media");
  }
  if (wantsAudio) {
    console.log("[clips-recorder] acquiring audioStream (mic only)");
  }
  const streamCleanups: Array<() => void> = [() => audioCue.cleanup()];
  const devSyntheticCapture = shouldUseDevSyntheticCapture();

  const resumedDisplayStream = restartHandoff.displayStream;
  const resumedAudioStream = restartHandoff.audioStream;
  if (resumedDisplayStream || resumedAudioStream) {
    console.log("[clips-recorder] reusing handed-off capture streams", {
      display: Boolean(resumedDisplayStream),
      audio: Boolean(resumedAudioStream),
    });
  }
  const displayStreamPromise: Promise<MediaStream> | null = resumedDisplayStream
    ? Promise.resolve(resumedDisplayStream)
    : wantsScreen
      ? (() => {
          if (!devSyntheticCapture) {
            return navigator.mediaDevices.getDisplayMedia(
              buildDesktopDisplayMediaOptions({
                audio: wantsSystemAudio,
                frameRate: CLOUD_CAPTURE_FRAME_RATE,
                maxWidth: CLOUD_CAPTURE_MAX_WIDTH,
                maxHeight: CLOUD_CAPTURE_MAX_HEIGHT,
              }),
            );
          }
          console.warn(
            "[clips-recorder] using opt-in dev synthetic screen capture; remove localStorage clips:dev-synthetic-capture to use the native picker",
          );
          const syntheticDisplay = createSyntheticScreenStream();
          streamCleanups.push(syntheticDisplay.cleanup);
          return Promise.resolve(syntheticDisplay.stream);
        })()
      : null;

  const suspensionPromise = deferCaptureUntilDisplaySelection(
    displayStreamPromise,
    () =>
      acquireRewindCaptureSuspension({
        requiresScreen: wantsScreen,
        requiresMicrophone: wantsAudio,
      }),
  );

  const reusedCameraStream =
    wantsCamera && params.preAcquiredCameraStream
      ? params.preAcquiredCameraStream
      : null;
  if (reusedCameraStream) {
    console.log(
      "[clips-recorder] reusing pre-acquired camera stream from popover preview",
    );
  }
  const bubbleCameraStreamPromise: Promise<MediaStream> | null =
    wantsCamera && !reusedCameraStream
      ? deferCaptureUntilDisplaySelection(displayStreamPromise, () =>
          getCameraStreamWithFallback(params.cameraId),
        )
      : null;
  const audioStreamPromise: Promise<MediaStream> | null = resumedAudioStream
    ? Promise.resolve(resumedAudioStream)
    : wantsAudio
      ? deferCaptureUntilDisplaySelection(displayStreamPromise, () =>
          getAudioStreamWithFallback(
            params.micId,
            params.micLabel,
            params.voiceCleanupEnabled,
          ),
        )
      : null;

  const pendingCaptureStreams = new Set<MediaStream>();
  const trackCapturePromise = (
    promise: Promise<MediaStream> | null,
  ): Promise<MediaStream> | null => {
    if (!promise) return null;
    return promise.then((stream) => {
      if (params.signal?.aborted) {
        stopMediaStream(stream);
      } else {
        pendingCaptureStreams.add(stream);
      }
      return stream;
    });
  };
  const trackedDisplayStreamPromise = trackCapturePromise(displayStreamPromise);
  const trackedCameraStreamPromise = trackCapturePromise(
    bubbleCameraStreamPromise,
  );
  const trackedAudioStreamPromise = trackCapturePromise(audioStreamPromise);
  const pendingCaptureAbort = () => {
    pendingCaptureStreams.forEach(stopMediaStream);
    pendingCaptureStreams.clear();
  };
  params.signal?.addEventListener("abort", pendingCaptureAbort, {
    once: true,
  });
  const clearPendingCaptureTracking = () => {
    params.signal?.removeEventListener("abort", pendingCaptureAbort);
    pendingCaptureStreams.clear();
  };
  let captureStartCleaned = false;
  const cleanupUnstartedCapture = () => {
    if (captureStartCleaned) return;
    captureStartCleaned = true;
    pendingCaptureAbort();
    clearPendingCaptureTracking();
    streamCleanups.forEach((cleanup) => cleanup());
  };
  const trackedCapturePromises = [
    trackedDisplayStreamPromise,
    trackedCameraStreamPromise,
    trackedAudioStreamPromise,
  ];

  let captureSuspension: RewindCaptureSuspensionLease;
  try {
    captureSuspension = await guardRecordingStart(suspensionPromise, {
      signal: params.signal,
      onLateResolve: (lease) => {
        if (!lease.leaseId) return;
        void invoke("rewind_capture_suspension_release", {
          leaseId: lease.leaseId,
        }).catch(() => {});
      },
    });
  } catch (err) {
    cleanupUnstartedCapture();
    void Promise.allSettled(
      trackedCapturePromises.map((promise) => Promise.resolve(promise)),
    ).then((streams) => {
      streams.forEach((result) => {
        if (result.status === "fulfilled") stopMediaStream(result.value);
      });
    });
    throw err;
  }
  const releaseCaptureSuspension = captureSuspensionReleaser(captureSuspension);

  try {
    console.log("[clips-recorder] allSettled IN — streams dispatched");
    const settled = await guardRecordingStart(
      Promise.allSettled(
        trackedCapturePromises.map((promise) => Promise.resolve(promise)),
      ),
      { signal: params.signal },
    );
    console.log(
      "[clips-recorder] allSettled OUT — settled statuses:",
      settled.map((s) => s.status),
    );
    const firstRejectionIndex = settled.findIndex(
      (s) => s.status === "rejected",
    );
    const firstRejection =
      firstRejectionIndex >= 0
        ? (settled[firstRejectionIndex] as PromiseRejectedResult)
        : null;
    if (firstRejection) {
      const canUseSyntheticScreen =
        devSyntheticCapture &&
        wantsScreen &&
        displayStreamPromise != null &&
        firstRejectionIndex === 0;
      if (!canUseSyntheticScreen) {
        for (const s of settled) {
          if (s.status === "fulfilled" && s.value) {
            try {
              s.value.getTracks().forEach((t) => t.stop());
            } catch {
              // ignore — best-effort cleanup
            }
          }
        }
        const rejErr = firstRejection.reason;
        console.error(
          "[clips-recorder] stream acquisition failed:",
          (rejErr as { name?: string })?.name,
          (rejErr as { message?: string })?.message,
          rejErr,
        );
        throw firstRejection.reason;
      }
      console.warn(
        "[clips-recorder] continuing with opt-in dev synthetic capture after stream acquisition failed:",
        firstRejection.reason,
      );
    }
    let displayStream =
      settled[0].status === "fulfilled"
        ? (settled[0].value as MediaStream | null)
        : null;
    let freshlyAcquiredCameraStream =
      settled[1].status === "fulfilled"
        ? (settled[1].value as MediaStream | null)
        : null;
    let audioStream =
      settled[2].status === "fulfilled"
        ? (settled[2].value as MediaStream | null)
        : null;
    if (
      firstRejection &&
      firstRejectionIndex === 0 &&
      devSyntheticCapture &&
      wantsScreen &&
      !displayStream
    ) {
      [displayStream, freshlyAcquiredCameraStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((track) => track.stop()),
      );
      const syntheticDisplay = createSyntheticScreenStream();
      displayStream = syntheticDisplay.stream;
      streamCleanups.push(syntheticDisplay.cleanup);
      if (wantsAudio && !audioStream) {
        const syntheticAudio = createSyntheticAudioStream();
        if (syntheticAudio) {
          audioStream = syntheticAudio.stream;
          streamCleanups.push(syntheticAudio.cleanup);
        }
      }
      freshlyAcquiredCameraStream = null;
    }
    const bubbleCameraStream =
      reusedCameraStream ?? freshlyAcquiredCameraStream ?? null;

    if (displayStream) {
      console.log(
        "[clips-recorder] display media acquired",
        displayStream.getTracks().map((t) => t.kind),
      );
    }
    if (bubbleCameraStream) {
      const vtrack = bubbleCameraStream.getVideoTracks()[0];
      console.log("[clips-recorder] camera acquired", {
        label: vtrack?.label,
        readyState: vtrack?.readyState,
        muted: vtrack?.muted,
      });
    }
    if (audioStream) {
      console.log(
        "[clips-recorder] audioStream acquired",
        audioStream.getAudioTracks().map((t) => ({
          label: t.label,
          readyState: t.readyState,
        })),
      );
    }
    if (audioStream && wantsAudio) {
      streamCleanups.push(startBrowserMicLevelEmitter(audioStream));
    }

    await invoke("park_popover_offscreen").catch(() => {});
    emit("clips:popover-visible", false).catch(() => {});
    const captureTitle = await captureTitleForRecording({
      mode: params.mode,
      source: captureSource,
    });
    let transcriptionCapture: TranscriptionCapture | null = null;

    const recordedScreenCameraStream =
      localRecordingMode !== "separate" &&
      params.mode === "screen-camera" &&
      displayStream &&
      bubbleCameraStream
        ? createCameraCompositeStream({
            displayStream,
            cameraStream: bubbleCameraStream,
            bubbleSizeRatio: bubbleSizeRatioForName(
              await invoke<string>("load_bubble_size").catch(() => "small"),
            ),
          })
        : null;
    if (recordedScreenCameraStream) {
      streamCleanups.push(() => recordedScreenCameraStream.cleanup());
      console.log("[clips-recorder] compositing camera into recorded video");
    }

    const primaryVideo =
      recordedScreenCameraStream?.stream ??
      displayStream ??
      (params.mode === "camera" ? bubbleCameraStream : null);
    if (!primaryVideo) throw new Error("No video stream available");

    const combined = new MediaStream();
    primaryVideo.getVideoTracks().forEach((t) => combined.addTrack(t));
    const recordingAudio = buildRecordingAudio(
      audioStream?.getAudioTracks() ?? [],
      displayStream?.getAudioTracks() ?? [],
    );
    streamCleanups.push(recordingAudio.cleanup);
    recordingAudio.tracks.forEach((t) => combined.addTrack(t));

    const popoverOwnsCamera = bubbleCameraStream === reusedCameraStream;

    if (localRecordingMode !== "off") {
      console.log("[clips-recorder] starting local-only recording", {
        localRecordingMode,
      });
      const targets = localRecordingTargetsForMode({
        localRecordingMode,
        displayStream,
        bubbleCameraStream,
        recordingAudio,
        combined,
      });

      const countdownPromise = runRecordingCountdown(
        wantsScreen,
        params.signal,
      );
      const localExportPromise = prepareLocalRecordingExport(targets);
      let localExport: Awaited<ReturnType<typeof prepareLocalRecordingExport>>;
      try {
        [, localExport] = await Promise.all([
          countdownPromise,
          localExportPromise,
        ]);
      } catch (err) {
        cleanupUnstartedCapture();
        throw err;
      }

      const id = `local-${Date.now().toString(36)}`;
      let startedAt = 0;
      let pausedAt: number | null = null;
      let accumulatedPauseMs = 0;
      let stopped = false;
      let stateUnlistens: UnlistenFn[] = [];
      let tickHandle: ReturnType<typeof setInterval> | null = null;

      function emitState(paused: boolean) {
        const now = Date.now();
        const pausedNowMs = paused && pausedAt ? now - pausedAt : 0;
        const elapsedMs =
          startedAt > 0
            ? now - startedAt - accumulatedPauseMs - pausedNowMs
            : 0;
        emit("clips:recorder-state", {
          paused,
          elapsedMs,
        }).catch(() => {});
      }

      const toolbarUnlistens = await Promise.all([
        listen("clips:recorder-pause", () => {
          localExport.pause();
          pausedAt = Date.now();
          emitState(true);
        }),
        listen("clips:recorder-resume", () => {
          localExport.resume();
          if (pausedAt) accumulatedPauseMs += Date.now() - pausedAt;
          pausedAt = null;
          emitState(false);
        }),
        listen("clips:recorder-toggle-pause", () => {
          if (pausedAt) {
            localExport.resume();
            accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
            emitState(false);
          } else {
            localExport.pause();
            pausedAt = Date.now();
            emitState(true);
          }
        }),
        listen("clips:recorder-stop", () => {
          console.log("[clips-recorder] local stop event received");
          handle.stop().catch((err) => {
            console.error("[clips-recorder] local handle.stop() threw:", err);
          });
        }),
        listen("clips:recorder-cancel", () => {
          console.log("[clips-recorder] local cancel event received");
          handle.cancel().catch((err) => {
            console.error("[clips-recorder] local handle.cancel() threw:", err);
          });
        }),
        listen("clips:toolbar-ready", () => {
          emit("clips:toolbar-enabled", startedAt > 0 && !stopped).catch(
            () => {},
          );
          emitRecorderSession(null, null, true, params.micOn);
          emitState(pausedAt != null);
        }),
      ]);
      stateUnlistens = toolbarUnlistens;
      emit("clips:toolbar-sync").catch(() => {});

      await showRegionGuidesForRecording(wantsScreen);
      await audioCue.playBeforeCapture();
      localExport.start(2_000);
      startedAt = Date.now();
      tickHandle = setInterval(() => emitState(pausedAt != null), 500);
      emit("clips:toolbar-enabled", true).catch(() => {});
      emitRecorderSession(null, null, true, params.micOn);
      emitState(false);

      const detachCombinedStream = () => {
        try {
          combined.getTracks().forEach((track) => combined.removeTrack(track));
        } catch {
          // ignore — best-effort
        }
        for (const target of targets) {
          try {
            target.stream
              .getTracks()
              .forEach((track) => target.stream.removeTrack(track));
          } catch {
            // ignore — best-effort
          }
        }
      };

      const stopOwnedStreams = (keepCaptureStreams = false) => {
        if (!keepCaptureStreams) {
          [displayStream, audioStream].forEach((stream) =>
            stream?.getTracks().forEach((track) => track.stop()),
          );
        }
        streamCleanups.forEach((cleanup) => cleanup());
        if (!popoverOwnsCamera) {
          bubbleCameraStream?.getTracks().forEach((track) => track.stop());
        }
      };

      const hideChrome = async () => {
        await invoke("hide_recording_chrome").catch((err) =>
          console.error(`[clips-recorder] hide_recording_chrome failed:`, err),
        );
      };

      const discardTake = async (
        keepCaptureStreams: boolean,
      ): Promise<RestartHandoff> => {
        const handsOff = keepCaptureStreams && !devSyntheticCapture;
        stopped = true;
        if (tickHandle) clearInterval(tickHandle);
        stateUnlistens.forEach((unlisten) => unlisten());
        stateUnlistens = [];
        await localExport.cancel();
        detachCombinedStream();
        stopOwnedStreams(handsOff);
        await hideChrome();
        return handsOff
          ? { displayStream, audioStream }
          : { displayStream: null, audioStream: null };
      };

      const handle: RecorderHandle = {
        async stop() {
          if (stopped) {
            return {
              recordingId: id,
              viewUrl: "",
              localOnly: true,
              localFolder: localExport.folderPath,
              localFiles: [],
            };
          }
          stopped = true;
          if (tickHandle) clearInterval(tickHandle);
          stateUnlistens.forEach((unlisten) => unlisten());
          stateUnlistens = [];
          const durationMs = Math.max(
            0,
            Math.round(Date.now() - startedAt - accumulatedPauseMs),
          );
          let files: LocalExportedFile[] = [];
          try {
            files = await localExport.stop(durationMs);
          } finally {
            detachCombinedStream();
            stopOwnedStreams();
            await hideChrome();
          }
          return {
            recordingId: id,
            viewUrl: "",
            localOnly: true,
            localFolder: localExport.folderPath,
            localFiles: files,
          };
        },

        async cancel() {
          if (stopped) return;
          await discardTake(false);
        },

        async discardForRestart() {
          if (stopped) {
            throw new Error("Recording already finished — nothing to restart");
          }
          return discardTake(true);
        },
      };

      const wrappedHandle = recorderWithCaptureSuspension(
        handle,
        releaseCaptureSuspension,
      );
      clearPendingCaptureTracking();
      return wrappedHandle;
    }

    const uploadPrimaryVideo = createUploadOptimizedVideoStream(primaryVideo);
    streamCleanups.push(() => uploadPrimaryVideo.cleanup());

    const uploadCombined = new MediaStream();
    uploadPrimaryVideo.stream
      .getVideoTracks()
      .forEach((track) => uploadCombined.addTrack(track));
    recordingAudio.tracks.forEach((track) => uploadCombined.addTrack(track));

    const mimeCandidates = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ];
    const mimeType =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

    console.log(
      "[clips-recorder] invoking show_countdown + createServerRecording",
    );
    const countdownPromise = runRecordingCountdown(wantsScreen, params.signal);
    console.time("[clips-recorder] createServerRecording duration");
    const recordingPromise = createServerRecording(
      params.serverUrl,
      wantsCamera,
      recordingAudio.tracks.length > 0,
      captureTitle,
      {
        mimeType: mimeType || "video/webm",
        requestStreaming: true,
        authToken: params.authToken,
        signal: params.signal,
      },
    ).finally(() => {
      console.timeEnd("[clips-recorder] createServerRecording duration");
    });
    console.log("[clips-recorder] awaiting countdown + createServerRecording");
    let createRes: Awaited<ReturnType<typeof createServerRecording>>;
    try {
      [, createRes] = await Promise.all([countdownPromise, recordingPromise]);
    } catch (err) {
      abortCreatedRecordingOnCountdownCancel(
        err,
        recordingPromise,
        params.serverUrl,
      );
      throw err;
    }
    const { id, uploadMode } = createRes;
    console.log(
      "[clips-recorder] countdown + createServerRecording both resolved, id=",
      id,
    );
    console.log("[clips-recorder] recording row created", { id, uploadMode });
    let nativeTranscriptFailureSaved = false;
    const saveTranscriptFailure = async (
      failureReason: string,
    ): Promise<boolean> => {
      if (!wantsRecordedAudio || nativeTranscriptFailureSaved) return false;
      nativeTranscriptFailureSaved = true;
      return saveRecordingTranscriptFailure(
        params.serverUrl,
        id,
        failureReason,
        params.authToken,
      );
    };

    const recorder = createCloudMediaRecorder(uploadCombined, mimeType);
    let chunkIndex = 0;
    let failed: Error | null = null;
    let backupBytes = 0;
    let backupChunkCount = 0;
    const streamMimeType = mimeType || "video/webm";
    let backupMeta: BrowserRecordingBackupMeta = {
      recordingId: id,
      serverUrl: params.serverUrl.replace(/\/+$/, ""),
      durationMs: 0,
      width: null,
      height: null,
      bytes: 0,
      hasAudio: uploadCombined.getAudioTracks().length > 0,
      hasCamera: wantsCamera,
      savedAt: new Date().toISOString(),
      lastAttemptAt: null,
      lastError: null,
      retryCount: 0,
      chunkCount: 0,
      mimeType: mimeType || "video/webm",
    };
    const persistBackupMeta = async (
      patch: Partial<BrowserRecordingBackupMeta> = {},
    ) => {
      backupMeta = { ...backupMeta, ...patch };
      await putBrowserRecordingBackupMeta(backupMeta);
    };
    let backupFailure: Error | null = null;
    const backupWrites = new Set<Promise<void>>();
    let initialBackupWrite: Promise<void>;
    initialBackupWrite = persistBackupMeta()
      .catch((err) => {
        backupFailure = err instanceof Error ? err : new Error(String(err));
        console.warn("[clips-recorder] local backup metadata failed:", err);
      })
      .finally(() => {
        backupWrites.delete(initialBackupWrite);
      });
    backupWrites.add(initialBackupWrite);

    const backupChunkLocally = (blob: Blob): Promise<void> => {
      const backupIdx = backupChunkCount++;
      backupBytes += blob.size;
      const chunkMimeType = blob.type || streamMimeType;
      let w: Promise<void>;
      w = (async () => {
        try {
          await putBrowserRecordingBackupChunk({
            recordingId: id,
            index: backupIdx,
            blob,
            bytes: blob.size,
            mimeType: chunkMimeType,
            createdAt: new Date().toISOString(),
          });
          await persistBackupMeta({
            bytes: backupBytes,
            chunkCount: backupChunkCount,
            mimeType: chunkMimeType,
          });
        } catch (err) {
          backupFailure = err instanceof Error ? err : new Error(String(err));
          console.warn("[clips-recorder] local chunk backup failed:", err);
        }
      })().finally(() => {
        backupWrites.delete(w);
      });
      backupWrites.add(w);
      return w;
    };
    const inflight = new Set<Promise<void>>();

    let pendingStreamBlobs: Blob[] = [];
    let pendingStreamBytes = 0;
    let streamQueue: Promise<void> = Promise.resolve();

    const queueStreamChunk = (blob: Blob, idx: number) => {
      const url = chunkUrl(params.serverUrl, id, idx, false, {
        mimeType: streamMimeType,
      });
      streamQueue = streamQueue.then(async () => {
        if (failed) return;
        try {
          await uploadChunk(url, blob);
        } catch (err) {
          failed ??= err instanceof Error ? err : new Error(String(err));
        }
      });
    };

    const flushAlignedStreamChunks = () => {
      while (pendingStreamBytes >= STREAM_CHUNK_BYTES) {
        const combined = new Blob(pendingStreamBlobs, { type: streamMimeType });
        const head = combined.slice(0, STREAM_CHUNK_BYTES, streamMimeType);
        const tail = combined.slice(
          STREAM_CHUNK_BYTES,
          combined.size,
          streamMimeType,
        );
        pendingStreamBlobs = tail.size > 0 ? [tail] : [];
        pendingStreamBytes = tail.size;
        queueStreamChunk(head, chunkIndex++);
      }
    };

    recorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;

      void backupChunkLocally(ev.data);

      if (uploadMode === "streaming") {
        pendingStreamBlobs.push(ev.data);
        pendingStreamBytes += ev.data.size;
        flushAlignedStreamChunks();
        return;
      }

      const idx = chunkIndex++;
      const chunkMimeType = ev.data.type || mimeType || "video/webm";
      const url = chunkUrl(params.serverUrl, id, idx, false, {
        mimeType: chunkMimeType,
      });
      let p: Promise<void>;
      p = uploadChunk(url, ev.data)
        .catch((err) => {
          failed ??= err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => {
          inflight.delete(p);
        });
      inflight.add(p);
    };

    let startedAt = 0;
    let pausedAt: number | null = null;
    let accumulatedPauseMs = 0;
    let stopped = false;
    let stateUnlistens: UnlistenFn[] = [];
    let tickHandle: ReturnType<typeof setInterval> | null = null;

    function emitState(paused: boolean) {
      const now = Date.now();
      const pausedNowMs = paused && pausedAt ? now - pausedAt : 0;
      const elapsedMs =
        startedAt > 0 ? now - startedAt - accumulatedPauseMs - pausedNowMs : 0;
      emit("clips:recorder-state", {
        paused,
        elapsedMs,
      }).catch(() => {});
    }

    const toolbarUnlistens = await Promise.all([
      listen("clips:recorder-pause", () => {
        if (recorder.state === "recording") {
          try {
            recorder.pause();
            pausedAt = Date.now();
            emitState(true);
            console.log(
              "[clips-recorder] recorder pause: pausing transcription",
            );
            void transcriptionCapture?.pause().catch(() => {});
          } catch (error) {
            console.warn("[clips-recorder] recorder pause failed", error);
          }
        }
      }),
      listen("clips:recorder-resume", () => {
        if (recorder.state === "paused") {
          try {
            recorder.resume();
            if (pausedAt) accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
            emitState(false);
            console.log(
              "[clips-recorder] recorder resume: resuming transcription",
            );
            void transcriptionCapture?.resume().catch(() => {});
          } catch (error) {
            console.warn("[clips-recorder] recorder resume failed", error);
          }
        }
      }),
      listen("clips:recorder-toggle-pause", () => {
        if (recorder.state === "recording") {
          try {
            recorder.pause();
            pausedAt = Date.now();
            emitState(true);
            void transcriptionCapture?.pause().catch(() => {});
          } catch (error) {
            console.warn(
              "[clips-recorder] recorder toggle pause failed",
              error,
            );
          }
        } else if (recorder.state === "paused") {
          try {
            recorder.resume();
            if (pausedAt) accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
            emitState(false);
            void transcriptionCapture?.resume().catch(() => {});
          } catch (error) {
            console.warn(
              "[clips-recorder] recorder toggle resume failed",
              error,
            );
          }
        }
      }),
      listen("clips:recorder-stop", () => {
        console.log("[clips-recorder] stop event received");
        handle.stop().catch((err) => {
          console.error("[clips-recorder] handle.stop() threw:", err);
        });
      }),
      listen("clips:recorder-cancel", () => {
        console.log("[clips-recorder] cancel event received");
        handle.cancel().catch((err) => {
          console.error("[clips-recorder] handle.cancel() threw:", err);
        });
      }),
      listen("clips:toolbar-ready", () => {
        emit("clips:toolbar-enabled", startedAt > 0 && !stopped).catch(
          () => {},
        );
        emitRecorderSession(params.serverUrl, id, false, params.micOn);
        emitState(pausedAt != null);
      }),
    ]);
    stateUnlistens = toolbarUnlistens;
    emit("clips:toolbar-sync").catch(() => {});

    await showRegionGuidesForRecording(wantsScreen);
    await audioCue.playBeforeCapture();
    recorder.start(LIVE_UPLOAD_CHUNK_MS);
    startedAt = Date.now();
    tickHandle = setInterval(() => emitState(pausedAt != null), 500);
    emit("clips:toolbar-enabled", true).catch(() => {});
    emitRecorderSession(params.serverUrl, id, false, params.micOn);
    emitState(false);

    if (canTranscribeLocally) await restartHandoff.transcriptionTornDown;
    transcriptionCapture = canTranscribeLocally
      ? await startTranscriptionCapture(
          {
            deviceId: params.micId,
            label: params.micLabel,
          },
          wantsSystemAudio,
          { voiceProcessing: false },
        )
      : null;
    if (stopped && transcriptionCapture) {
      void transcriptionCapture.cancel().catch(() => {});
      transcriptionCapture = null;
    } else if (pausedAt != null && transcriptionCapture) {
      console.log(
        "[clips-recorder] recorder: paused during startup, pausing transcription",
      );
      void transcriptionCapture.pause().catch(() => {});
    } else if (
      canTranscribeLocally &&
      !transcriptionCapture &&
      shouldSaveLocalTranscriptionStartupFailure()
    ) {
      void saveTranscriptFailure(TRANSCRIPTION_START_FAILURE);
    }


    const performStop = async (): Promise<RecorderStopResult> => {
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopped = true;
      let stoppedAt = 0;
      const viewUrl = `/r/${id}`;
      const absoluteViewUrl = `${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`;
      console.log("[clips-recorder] stop requested");
      showFinalizingFeedback();
      if (tickHandle) clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];

      const recorderStopped = new Promise<void>((resolve) => {
        if (recorder.state === "inactive") {
          stoppedAt = Date.now();
          resolve();
          return;
        }
        recorder.addEventListener(
          "stop",
          () => {
            stoppedAt = Date.now();
            resolve();
          },
          { once: true },
        );
        try {
          if (recorder.state === "paused") {
            recorder.resume();
            if (pausedAt) accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
          }
        } catch {
          // ignore
        }
        try {
          recorder.requestData();
        } catch {
          // ignore
        }
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      });
      const recorderStopTimedOut = await Promise.race([
        recorderStopped.then(() => false),
        wait(MEDIA_RECORDER_STOP_TIMEOUT_MS).then(() => true),
      ]);
      if (recorderStopTimedOut) {
        stoppedAt = Date.now();
        failed ??= new Error(
          "The recorder did not finish stopping. Your local backup was kept so you can retry or download it from Clips.",
        );
        void transcriptionCapture?.cancel().catch((err) => {
          console.warn(
            "[clips-recorder] transcription cancel after stop timeout failed:",
            err,
          );
        });
      }

      const videoSettings = uploadPrimaryVideo.stream
        .getVideoTracks()[0]
        ?.getSettings();
      const displaySettings = displayStream?.getVideoTracks()[0]?.getSettings();
      const durationMs = Math.max(
        0,
        Math.round(stoppedAt - startedAt - accumulatedPauseMs),
      );
      const width =
        typeof videoSettings?.width === "number"
          ? videoSettings.width
          : typeof displaySettings?.width === "number"
            ? displaySettings.width
            : null;
      const height =
        typeof videoSettings?.height === "number"
          ? videoSettings.height
          : typeof displaySettings?.height === "number"
            ? displaySettings.height
            : null;
      const finalMimeType = mimeType || backupMeta.mimeType || "video/webm";
      try {
        await persistBackupMeta({
          durationMs,
          width,
          height,
          bytes: backupBytes,
          hasAudio: uploadCombined.getAudioTracks().length > 0,
          hasCamera: wantsCamera,
          chunkCount: backupChunkCount,
          mimeType: finalMimeType,
          lastError: null,
        });
      } catch (err) {
        backupFailure = err instanceof Error ? err : new Error(String(err));
        console.warn(
          "[clips-recorder] local backup final metadata failed:",
          err,
        );
      }

      if (!recorderStopTimedOut) {
        const capturedTranscript = await transcriptionCapture
          ?.stop()
          .catch((err) => {
            console.warn("[clips-recorder] transcript stop failed:", err);
            return null;
          });
        if (capturedTranscript?.text.trim()) {
          await saveRecordingTranscript(
            params.serverUrl,
            id,
            capturedTranscript,
            params.authToken,
          );
        } else if (wantsRecordedAudio) {
          await saveTranscriptFailure(NO_SPEECH_TRANSCRIPT_FAILURE);
        }
      }
      if (popoverOwnsCamera) {
        console.log("[clips-recorder] releasing popover camera");
        emit("clips:release-camera").catch(() => {});
      }

      recorder.ondataavailable = null;
      try {
        uploadCombined
          .getTracks()
          .forEach((t) => uploadCombined.removeTrack(t));
        combined.getTracks().forEach((t) => combined.removeTrack(t));
      } catch {
        // ignore — best-effort
      }

      [displayStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }

      console.log("[clips-recorder] hiding recording chrome");
      await invoke("hide_recording_chrome").catch((err) =>
        console.error(`[clips-recorder] hide_recording_chrome failed:`, err),
      );

      const pending = Array.from(inflight);
      if (uploadMode === "streaming") {
        await streamQueue;
      } else {
        await Promise.allSettled(pending);
      }
      inflight.clear();
      if (failed) {
        try {
          await Promise.allSettled([...backupWrites]);
          console.error("[clips-recorder] chunk upload failed:", failed);
          await markBrowserRecordingBackupError(id, failed.message).catch(
            () => {},
          );
          await interruptRecordingUpload(
            params.serverUrl,
            id,
            failed.message,
            params.authToken,
            undefined,
            undefined,
            uploadFailureDiagnostics(failed),
          );
        } finally {
          await clearRecordingState();
          await publishFinalizingResult({
            recordingId: id,
            viewUrl: absoluteViewUrl,
            ok: false,
            error: failed.message,
          });
        }
        throw failed;
      }

      const finalBody =
        uploadMode === "streaming"
          ? new Blob(pendingStreamBlobs, { type: finalMimeType })
          : new Blob([], { type: finalMimeType });
      pendingStreamBlobs = [];
      pendingStreamBytes = 0;

      const finalizeUrl = chunkUrl(params.serverUrl, id, chunkIndex, true, {
        mimeType: finalMimeType,
        durationMs: String(durationMs),
        ...(width ? { width: String(width) } : {}),
        ...(height ? { height: String(height) } : {}),
        hasAudio: backupMeta.hasAudio ? "1" : "0",
        hasCamera: wantsCamera ? "1" : "0",
      });
      console.log("[clips-recorder] finalize POST", finalizeUrl, {
        chunksSent: chunkIndex,
        inflightAtFinalize: pending.length,
        finalBodyBytes: finalBody.size,
        uploadMode,
        anyFailed: !!failed,
      });
      try {
        const result = await finalizeAfterDurableBackup({
          ensureBackupDurable: async () => {
            await Promise.all([...backupWrites]);
            if (backupFailure) throw backupFailure;
            await persistBackupMeta({
              durationMs,
              width,
              height,
              bytes: backupBytes,
              hasAudio: uploadCombined.getAudioTracks().length > 0,
              hasCamera: wantsCamera,
              chunkCount: backupChunkCount,
              mimeType: finalMimeType,
              lastError: null,
            });
          },
          attemptFinalize: async () => {
            try {
              const finalRes = await fetch(finalizeUrl, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                credentials: "include",
                body: finalBody,
                signal: AbortSignal.timeout(FINALIZE_UPLOAD_TIMEOUT_MS),
              });
              const bodyText = await finalRes.text().catch(() => "");
              const responseError = classifyUploadResponseError({
                contentType: finalRes.headers.get("content-type"),
                body: bodyText,
                status: finalRes.status,
                stage: "chunk_upload",
              });
              console.log(
                "[clips-recorder] finalize response:",
                finalRes.status,
                responseError.isHtml ? "HTML error response" : "received",
              );
              if (!finalRes.ok || responseError.isHtml) {
                throw Object.assign(
                  new Error(
                    responseError.isHtml
                      ? `Chunk upload returned an HTML error response (${finalRes.status}).`
                      : `Finalize failed (${finalRes.status}): ${responseError.responseText?.slice(0, 200) ?? ""}`,
                  ),
                  {
                    status: responseError.status,
                    failureCode: responseError.failureCode,
                    failureStage: responseError.failureStage,
                  },
                );
              }
              const receipt = parseFinalizeReceipt(bodyText);
              const receiptStatus = verifyFinalizeReceipt(receipt, {
                bytes: backupBytes,
                durationMs,
              });
              if (receiptStatus === "processing") {
                scheduleBrowserBackupCleanupAfterProcessing({
                  serverUrl: params.serverUrl,
                  recordingId: id,
                  authToken: params.authToken,
                });
                return { recordingId: id, viewUrl };
              }
            } catch (err) {
              console.error("[clips-recorder] finalize fetch failed:", err);
              const error = err instanceof Error ? err : new Error(String(err));
              if (
                await recoverAcceptedRecordingAfterFinalizeError({
                  serverUrl: params.serverUrl,
                  recordingId: id,
                  authToken: params.authToken,
                })
              ) {
                return { recordingId: id, viewUrl };
              }
              await markBrowserRecordingBackupError(id, error.message).catch(
                () => {},
              );
              await interruptRecordingUpload(
                params.serverUrl,
                id,
                error.message,
                params.authToken,
                undefined,
                undefined,
                uploadFailureDiagnostics(error),
              );
              throw error;
            }
            await deleteBrowserRecordingBackup(id).catch((err) => {
              console.warn(
                "[clips-recorder] local backup cleanup failed:",
                err,
              );
            });

            return { recordingId: id, viewUrl };
          },
          releaseGuard: clearRecordingState,
        });
        await publishFinalizingResult({
          recordingId: id,
          viewUrl: absoluteViewUrl,
          ok: true,
        });
        return result;
      } catch (err) {
        await publishFinalizingResult({
          recordingId: id,
          viewUrl: absoluteViewUrl,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };

    const discardTake = async (
      keepCaptureStreams: boolean,
    ): Promise<RestartHandoff> => {
      const handsOff = keepCaptureStreams && !devSyntheticCapture;
      stopped = true;
      if (tickHandle) clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];
      const transcriptionTornDown = transcriptionCapture
        ?.cancel()
        .catch((err) => {
          console.warn("[clips-recorder] transcription cancel failed:", err);
        });
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
        // coercion-ok: the take is already discarded — a MediaRecorder that refuses to stop has nothing left to report
      } catch {
        // ignore
      }
      try {
        uploadCombined
          .getTracks()
          .forEach((t) => uploadCombined.removeTrack(t));
        combined.getTracks().forEach((t) => combined.removeTrack(t));
        // coercion-ok: detaching tracks is bookkeeping; the streams below are stopped or handed over either way
      } catch {
        // ignore
      }
      if (!handsOff) {
        [displayStream, audioStream].forEach((s) =>
          s?.getTracks().forEach((t) => t.stop()),
        );
      }
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }
      inflight.clear();
      await invoke("hide_recording_chrome").catch(() => {});
      if (id) {
        void cleanupCancelledRemoteRecording(params.serverUrl, id).catch(
          (err) => {
            console.warn("[clips-recorder] abort failed (non-fatal):", err);
          },
        );
      }
      await deleteBrowserRecordingBackup(id).catch((err) => {
        console.warn("[clips-recorder] local backup cleanup failed:", err);
      });
      const handedTranscriptionTeardown = keepCaptureStreams
        ? (transcriptionTornDown ?? null)
        : null;
      return handsOff
        ? {
            displayStream,
            audioStream,
            transcriptionTornDown: handedTranscriptionTeardown,
          }
        : {
            displayStream: null,
            audioStream: null,
            transcriptionTornDown: handedTranscriptionTeardown,
          };
    };

    const handle: RecorderHandle = {
      stop: singleFlight(performStop),

      async cancel() {
        if (stopped) return;
        await discardTake(false);
      },

      async discardForRestart() {
        if (stopped) {
          throw new Error("Recording already finished — nothing to restart");
        }
        return discardTake(true);
      },
    };

    const wrappedHandle = recorderWithCaptureSuspension(
      handle,
      releaseCaptureSuspension,
    );
    clearPendingCaptureTracking();
    return wrappedHandle;
  } catch (err) {
    cleanupUnstartedCapture();
    await releaseCaptureSuspension();
    throw err;
  }
}
