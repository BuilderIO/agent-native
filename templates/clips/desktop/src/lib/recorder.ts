/**
 * Native-first recording driver for the Clips tray.
 *
 * Orchestrates the full capture lifecycle without ever rendering a browser
 * window to the user:
 *
 *   1. request getDisplayMedia / getUserMedia (mic, optionally camera)
 *   2. spawn the countdown overlay window, wait for `clips:countdown-done`
 *   3. start MediaRecorder; POST each chunk to /api/uploads/:id/chunk
 *   4. spawn the toolbar overlay (bubble is already visible — owned by the
 *      popover's session effect, not the recorder)
 *   5. relay pause/resume/stop from the toolbar to MediaRecorder, with
 *      live `clips:recorder-state` updates back to the toolbar for the
 *      timer + paused styling
 *   6. on stop: isFinal=1 chunk → server finalizes the recording; pop the
 *      recording page open in the user's default browser for playback +
 *      sharing.
 *
 * Everything after step 1 happens off the tray popover: screen-only mode
 * never even needs the popover focused. This is what makes the UX feel
 * native instead of "app-in-a-tab".
 *
 * ## Camera bubble architecture
 *
 * WebKit enforces a single-page capture-exclusion policy: when one page
 * calls `getDisplayMedia`/`getUserMedia`, WebKit MUTES all capture sources
 * in other pages in the same process (see WebKit bugs 179363, 237359,
 * 212040, 238456; changeset 271154). Tauri v2's macOS backend shares one
 * WebKit process across all webview windows. So if the bubble window
 * called `getUserMedia` itself, its camera track would stay
 * `readyState="live"` but frames would stop arriving — WebKit's documented
 * behavior, not fixable with retry loops.
 *
 * Fix for browser/window capture: the POPOVER owns the camera for the entire
 * session — both before recording (so the user sees their face in the bubble
 * the moment they open the popover) and during recording. A session-long
 * effect in `app.tsx` calls `getUserMedia`, invokes `show_bubble`, and runs
 * the relay (see `bubble-pump.ts`). When the user clicks Start Recording, the
 * live `MediaStream` is handed to `startRecording` via
 * `preAcquiredCameraStream` so the recorder can composite it into the
 * captured video instead of calling `getUserMedia` a second time.
 *
 * Native full-screen capture is different: Rust records the screen directly,
 * not through WebKit `getDisplayMedia`, so the bubble overlay can own its own
 * local camera stream and the native screen recording captures that overlay.
 *
 * The recorder does NOT start its own frame pump — the app-level bubble
 * session owns whichever display path is appropriate.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { waitForReadyRecordingAfterFinalizeError } from "../../../shared/finalize-recovery";
import type { LocalRecordingMode } from "../shared/config";
import { createAudioCue, type AudioCue } from "./audio-cue";
import { createCameraCompositeStream } from "./camera-composite";
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
} from "./media-capture-constraints";
import { buildCaptureTitle, type CaptureTitleResult } from "./recording-title";
import {
  startTranscriptionCapture,
  type CapturedTranscript,
  type TranscriptionCapture,
} from "./transcription-capture";

export type { LocalExportedFile } from "./local-export";

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
const LIVE_UPLOAD_CHUNK_MS = 1_000;
const NATIVE_FULLSCREEN_SEGMENT_MS = 5 * 60_000;
const NATIVE_FULLSCREEN_MIME_TYPE = "video/mp4";
// GCS resumable uploads require every non-final chunk to be a multiple of
// 256 KiB. MediaRecorder emits arbitrary blob sizes, so on the streaming path
// we buffer raw blobs and only PUT aligned slices; the unaligned remainder is
// held and sent as the final chunk on stop.
const GCS_CHUNK_ALIGN_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 15 * GCS_CHUNK_ALIGN_BYTES; // 3.75 MiB

// How the client delivers recorded data to the server.
//  - "streaming" — server has a resumable session; flush aligned chunks live.
//  - "buffered"  — per-blob chunks staged server-side, assembled on finalize.
type UploadMode = "streaming" | "buffered";
type StreamingUploadClient = "desktop-native";
const CLOUD_CAPTURE_FRAME_RATE = 24;
const CLOUD_CAPTURE_MAX_WIDTH = 1920;
const CLOUD_CAPTURE_MAX_HEIGHT = 1080;
// Crisp capture for the desktop browser MediaRecorder fallback. Files are no
// longer shrunk client-side and the upload provider streams large files, so we
// keep full 1080p (was downscaled to a 1280 long edge) and a sharp bitrate (was
// 900 kbps, which left UI and text fuzzy). Dial down if file size matters.
const CLOUD_RECORDING_MAX_LONG_EDGE = 1920;
const CLOUD_RECORDING_VIDEO_BITRATE_BPS = 8_000_000;
const CLOUD_RECORDING_AUDIO_BITRATE_BPS = 128_000;

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
  // Full-screen mode should be one-click on macOS. The native recorder avoids
  // WebKit's old screen/window picker entirely. Set this flag to "0" locally
  // to fall back to getDisplayMedia while debugging that path.
  return isMacPlatform();
}

function shouldSaveLocalTranscriptionStartupFailure(): boolean {
  // Local Whisper/SFSpeech capture is macOS-only today. Non-mac desktop builds
  // should wait for upload transcription instead of publishing a misleading
  // native-transcription failure before `request-transcript` runs.
  return isMacPlatform();
}

function shouldUseDevSyntheticCapture(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof localStorage === "undefined") return false;

  const synthetic = localStorage.getItem(DEV_SYNTHETIC_CAPTURE_FLAG);
  if (synthetic !== null) {
    return synthetic === "1" || synthetic === "true";
  }

  // Back-compat for local dev sessions that explicitly opted out of real
  // capture before `clips:dev-synthetic-capture` existed. Missing legacy state
  // now means "try the real picker" so permission failures can surface.
  const legacyRealCapture = localStorage.getItem(LEGACY_DEV_REAL_CAPTURE_FLAG);
  return legacyRealCapture === "0" || legacyRealCapture === "false";
}

export interface StartParams {
  serverUrl: string; // e.g. http://localhost:8080
  mode: CaptureMode;
  source?: CaptureSource;
  cameraId?: string;
  micId?: string;
  micLabel?: string;
  authToken?: string;
  cookie?: string;
  micOn: boolean;
  cameraOn: boolean;
  /** Record + transcribe system/desktop audio. Default true. */
  systemAudioOn?: boolean;
  localRecordingMode?: LocalRecordingMode;
  /**
   * Pre-acquired camera stream owned by the popover's session effect. The
   * popover keeps the camera open + the bubble visible + the frame pump
   * running for the FULL camera session — we just borrow the video track
   * for MediaRecorder. Re-acquiring the same device rapidly is the
   * documented WebKit capture-exclusion footgun (the 2nd acquire can
   * silently mute the 1st) — reusing the live stream sidesteps it and
   * means the bubble never goes black during the preview → recording
   * transition.
   *
   * Ownership stays with the popover. The recorder must NOT stop these
   * tracks on stop/cancel — the popover's session effect decides when
   * the stream lives and dies (it stops when the user closes the popover
   * or turns the camera off).
   */
  preAcquiredCameraStream?: MediaStream | null;
}

export interface RecorderHandle {
  /** Stop the recording and resolve once the server has finalized. */
  stop(): Promise<RecorderStopResult>;
  /** Discard the recording without saving. */
  cancel(): Promise<void>;
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
  play();

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

/**
 * Build the audio track(s) for the recording. When BOTH a mic track and a
 * system/display-audio track are present they're mixed into a single track via
 * WebAudio (one audio track keeps players + our finalize step happy). With only
 * one source we pass it through untouched.
 */
function buildRecordingAudio(
  micTracks: MediaStreamTrack[],
  systemTracks: MediaStreamTrack[],
): RecordingAudio {
  if (!micTracks.length || !systemTracks.length) {
    // 0 or 1 source — no mixing needed (prefer mic when it's the only one).
    return {
      tracks: micTracks.length ? micTracks : systemTracks,
      cleanup() {},
    };
  }
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    // No WebAudio — fall back to mic only.
    return { tracks: micTracks, cleanup() {} };
  }
  const ctx: AudioContext = new AudioCtx();
  const destination = ctx.createMediaStreamDestination();
  for (const tracks of [micTracks, systemTracks]) {
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

export async function discardBrowserRecordingBackup(
  recordingId: string,
): Promise<void> {
  await deleteBrowserRecordingBackup(recordingId);
}

export async function exportBrowserRecordingBackup(
  recordingId: string,
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
    durationMs: meta.durationMs,
    width: meta.width,
    height: meta.height,
  });
}

async function markBrowserRecordingBackupError(
  recordingId: string,
  error: string,
): Promise<void> {
  const meta = await getBrowserRecordingBackupMeta(recordingId);
  if (!meta) return;
  await putBrowserRecordingBackupMeta({
    ...meta,
    lastAttemptAt: new Date().toISOString(),
    lastError: error,
    retryCount: meta.retryCount + 1,
  });
}

async function recoverReadyRecordingAfterFinalizeError({
  serverUrl,
  recordingId,
  authToken,
}: {
  serverUrl: string;
  recordingId: string;
  authToken?: string;
}): Promise<boolean> {
  const recovered = await waitForReadyRecordingAfterFinalizeError({
    uploadUrl: chunkUrl(serverUrl, recordingId, 0, false),
    recordingId,
    authToken,
    preferAuthenticated: true,
  });
  if (!recovered) return false;
  await deleteBrowserRecordingBackup(recordingId).catch((err) => {
    console.warn("[clips-recorder] recovered backup cleanup failed:", err);
  });
  return true;
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

async function postBackupChunk(
  url: string,
  blob: Blob,
  authToken?: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: buildRetryHeaders(
      blob.type || "application/octet-stream",
      authToken,
    ),
    credentials: "include",
    body: blob,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Upload retry failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  await res.text().catch(() => {});
}

async function resetBrowserRecordingBackupUpload(
  meta: BrowserRecordingBackupMeta,
  authToken?: string,
): Promise<void> {
  const res = await fetch(
    `${meta.serverUrl.replace(/\/+$/, "")}/api/uploads/${meta.recordingId}/reset-chunks`,
    {
      method: "POST",
      headers: buildRetryHeaders("application/json", authToken),
      credentials: "include",
      body: "{}",
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Upload retry setup failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

export async function retryBrowserRecordingBackup(input: {
  recordingId: string;
  serverUrl?: string;
  authToken?: string;
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

  try {
    await putBrowserRecordingBackupMeta({
      ...meta,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    });
    await resetBrowserRecordingBackupUpload(meta, input.authToken);

    const totalPosts = validatedChunks.length + 1;
    for (const chunk of validatedChunks) {
      await postBackupChunk(
        chunkUrl(meta.serverUrl, meta.recordingId, chunk.index, false, {
          total: String(totalPosts),
          mimeType: meta.mimeType,
        }),
        chunk.blob,
        input.authToken,
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
      },
    );
    try {
      await postBackupChunk(
        finalChunkUrl,
        new Blob([], { type: meta.mimeType }),
        input.authToken,
      );
    } catch (err) {
      if (
        await recoverReadyRecordingAfterFinalizeError({
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
    const message = err instanceof Error ? err.message : String(err);
    await markBrowserRecordingBackupError(meta.recordingId, message).catch(
      () => {},
    );
    throw err;
  }
}

async function createServerRecording(
  serverUrl: string,
  hasCamera: boolean,
  hasAudio: boolean,
  titleContext?: CaptureTitleResult,
  options?: {
    mimeType?: string;
    requestStreaming?: boolean;
    streamingUploadClient?: StreamingUploadClient;
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
      headers: { "Content-Type": "application/json" },
      // Tauri webview is a different origin from the clips server. The dev
      // CORS middleware is permissive for "*" but won't accept credentialed
      // requests without Allow-Credentials — and dev auth is bypassed, so
      // cookies aren't needed.
      credentials: "include",
      body: JSON.stringify({
        hasCamera,
        hasAudio,
        spaceIds: [],
        visibility: "public",
        ...(options?.requestStreaming
          ? {
              requestStreaming: true,
              mimeType: options.mimeType,
              streamingUploadClient: options.streamingUploadClient,
            }
          : {}),
        ...(titleContext
          ? {
              title: titleContext.title,
              titleSource: titleContext.titleSource,
              sourceAppName: titleContext.sourceAppName,
              sourceWindowTitle: titleContext.sourceWindowTitle,
            }
          : {}),
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[clips-recorder] fetch failed:", url, err);
    throw new Error(
      `Can't reach Clips server at ${url} — ${msg}. Is the dev server running on that port?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[clips-recorder] bad response:", url, res.status, body);
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
const COUNTDOWN_OVERLAY_SETTLE_MS = 120;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface NativeFullscreenUploadResult {
  recordingId: string;
  durationMs: number;
  width?: number;
  height?: number;
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
): Promise<void> {
  const text = transcript.text.trim();
  if (!text) return;

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
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[clips-recorder] save transcript failed:",
        res.status,
        body.slice(0, 200),
      );
    }
  } catch (err) {
    console.warn("[clips-recorder] save transcript failed:", err);
  }
}

async function saveRecordingTranscriptFailure(
  serverUrl: string,
  recordingId: string,
  failureReason: string,
  authToken?: string,
): Promise<void> {
  const reason = failureReason.trim();
  if (!reason) return;

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
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[clips-recorder] save native transcript failure failed:",
        res.status,
        body.slice(0, 200),
      );
    }
  } catch (err) {
    console.warn(
      "[clips-recorder] save native transcript failure failed:",
      err,
    );
  }
}

const THUMBNAIL_PROBE_WIDTH = 40;
const THUMBNAIL_MIN_MEAN_LUMA = 8;
const THUMBNAIL_MIN_MAX_LUMA = 28;
const THUMBNAIL_MIN_VISIBLE_PIXEL_RATIO = 0.005;

function canvasHasVisibleContent(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return false;

  const width = THUMBNAIL_PROBE_WIDTH;
  const height = Math.max(
    1,
    Math.round((canvas.height / canvas.width) * width),
  );
  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;

  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;

  try {
    ctx.drawImage(canvas, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let totalLuma = 0;
    let maxLuma = 0;
    let visiblePixels = 0;
    const pixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const luma =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) *
        alpha;
      totalLuma += luma;
      maxLuma = Math.max(maxLuma, luma);
      if (luma >= THUMBNAIL_MIN_MAX_LUMA) visiblePixels++;
    }

    const meanLuma = totalLuma / Math.max(1, pixels);
    const visibleRatio = visiblePixels / Math.max(1, pixels);
    return (
      meanLuma >= THUMBNAIL_MIN_MEAN_LUMA ||
      (maxLuma >= THUMBNAIL_MIN_MAX_LUMA &&
        visibleRatio >= THUMBNAIL_MIN_VISIBLE_PIXEL_RATIO)
    );
  } catch {
    return true;
  }
}

async function waitForVideoDimensions(
  video: HTMLVideoElement,
  timeoutMs = 1600,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return video.videoWidth > 0 && video.videoHeight > 0;
}

async function captureStreamThumbnailBlob(
  stream: MediaStream | null,
): Promise<Blob | null> {
  if (!stream?.getVideoTracks().some((track) => track.readyState === "live")) {
    return null;
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";

  try {
    document.body.appendChild(video);
    await video.play().catch(() => {});
    if (!(await waitForVideoDimensions(video))) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (!canvasHasVisibleContent(canvas)) return null;

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
    });
  } finally {
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}

async function captureAndUploadRecordingThumbnail(params: {
  serverUrl: string;
  recordingId: string;
  stream: MediaStream | null;
  authToken?: string;
}): Promise<void> {
  const blob = await captureStreamThumbnailBlob(params.stream);
  if (!blob) {
    console.warn("[clips-recorder] no visible thumbnail frame captured");
    return;
  }

  const url = `${params.serverUrl.replace(
    /\/+$/,
    "",
  )}/api/recordings/${params.recordingId}/thumbnail`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildRetryHeaders(blob.type || "image/jpeg", params.authToken),
    credentials: "include",
    body: blob,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Thumbnail upload failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  console.log("[clips-recorder] thumbnail uploaded", {
    recordingId: params.recordingId,
    bytes: blob.size,
  });
}

/**
 * Counter of in-flight chunk POSTs. The bubble frame pump reads
 * `window.clipsChunkBusy` and SKIPS frame encoding while it's truthy,
 * so the pump and the chunk fetch don't fight for the same microtask
 * queue. Using a counter (rather than a boolean) handles overlapping
 * uploads correctly — WebKit's fetch can pipeline the last chunk's
 * body serializer with the next chunk's request, so the flag must
 * stay true until ALL chunks settle.
 *
 * The flag is attached to `window` so the pump can read it without
 * an import cycle (the pump lives in a separate module that must not
 * depend on the recorder).
 */
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

// Bounded retry for live chunk uploads. A brief network blip (Wi-Fi roam, DNS
// hiccup, a single 5xx) should not fail the whole recording into the manual
// backup-replay path when the very next attempt would land
const CHUNK_UPLOAD_MAX_ATTEMPTS = 3;
const CHUNK_UPLOAD_RETRY_BASE_MS = 250;
// A hung connection (server accepts the TCP connection but never responds)
// would otherwise stall a chunk upload — and the stop()/finalize flow that
// awaits all in-flight chunks — indefinitely. Bound each attempt so a stall
// is treated as a retryable failure instead.
const CHUNK_UPLOAD_TIMEOUT_MS = 60_000;
const FINALIZE_UPLOAD_TIMEOUT_MS = 180_000;

// Only transient server responses are worth retrying inline; a 4xx (bad
// request, auth, not found) won't fix itself on the next attempt.
function isRetriableChunkStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function uploadChunk(url: string, blob: Blob): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= CHUNK_UPLOAD_MAX_ATTEMPTS; attempt++) {
    // Signal to the bubble frame pump that a chunk is being uploaded, but only
    // around the actual network call. The pump's tick loop checks this flag and
    // yields its slot to the fetch for the ~150-300ms the POST takes to
    // serialize and land. Released before any backoff wait so the pump can
    // encode frames while we sit idle between attempts.
    incChunkBusy();
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        // Tauri webview runs on localhost:1420 (dev) or tauri://localhost (prod);
        // the clips server is a different origin. The framework's dev CORS is
        // permissive for "*" but won't accept credentialed requests without
        // Allow-Credentials — and in dev auth is bypassed anyway, so we don't
        // need cookies.
        credentials: "include",
        body: blob,
        signal: AbortSignal.timeout(CHUNK_UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (offline, connection reset, DNS) or a timeout
      // abort from AbortSignal.timeout — both transient.
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      decChunkBusy();
    }

    if (res) {
      if (res.ok) {
        // Drain the response body even on success. If we don't consume the
        // body, WebKit can keep the network buffer resident until GC — that's
        // extra retention on top of the ~1MB Blob we just uploaded. Reading
        // and discarding is cheap (the body is usually tiny for a chunk ack)
        // and makes the memory footprint predictable.
        try {
          await res.text();
        } catch {
          // ignore — body drain is best-effort
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
      lastError = new Error(`chunk ${res.status}: ${body.slice(0, 200)}`);
      if (!isRetriableChunkStatus(res.status)) {
        console.error(
          "[clips-recorder] chunk failed:",
          res.status,
          body.slice(0, 200),
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
): Promise<void> {
  try {
    await fetch(
      `${serverUrl.replace(/\/+$/, "")}/api/uploads/${recordingId}/abort`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      },
    );
  } catch (err) {
    console.warn("[clips-recorder] abort upload failed:", err);
  }
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

function isRegionSelectionCancelledError(err: unknown) {
  return (
    err instanceof Error &&
    err.name === "AbortError" &&
    /region selection/i.test(err.message)
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

function waitForCountdownEvent(timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlistens: UnlistenFn[] = [];
    // Flag so that if the timeout fires BEFORE `listen()` resolves we can
    // still call the unlisten the instant it arrives — otherwise the
    // event handler closure stays registered for the life of the webview
    // (leaks the `resolve` / `reject` closures + anything they pin).
    let done = false;

    const cleanup = () => {
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
    const finish = (kind: "done" | "cancel") => {
      if (done) return;
      done = true;
      cleanup();
      if (kind === "cancel") {
        reject(new CountdownCancelledError());
      } else {
        resolve();
      }
    };
    const track = (listener: Promise<UnlistenFn>) => {
      listener
        .then((u) => {
          if (done) {
            try {
              u();
            } catch {
              // ignore
            }
            return;
          }
          unlistens.push(u);
        })
        .catch((err) => {
          if (done) return;
          done = true;
          cleanup();
          reject(err);
        });
    };

    track(listen("clips:countdown-done", () => finish("done")));
    track(listen("clips:countdown-cancel", () => finish("cancel")));

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("timeout waiting for clips:countdown-done"));
    }, timeoutMs);
  });
}

async function showRegionGuidesForRecording(wantsScreen: boolean) {
  if (!wantsScreen) return;
  await invoke("show_region_guides").catch((err) => {
    console.warn("[clips-recorder] show_region_guides failed:", err);
  });
}

// Frame the chosen screen region with a live border so the user can see exactly
// what's being captured throughout the countdown and recording. The overlay is
// capture-excluded and draws its stroke outside the captured pixels, so it never
// lands in the video. Torn down with the rest of the recording chrome on stop.
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

async function runRecordingCountdown(wantsScreen: boolean) {
  // The recording-start chime is intentionally NOT played here. It fires from
  // `audioCue.playBeforeCapture()` at the real capture-start (right before the
  // recorder/native capture is kicked off) so the beep lines up with the moment
  // recording actually begins — not one second early on the countdown's "1".
  const countdownEvent = waitForCountdownEvent(COUNTDOWN_EVENT_TIMEOUT_MS);
  await showRegionGuidesForRecording(wantsScreen);
  try {
    await invoke("show_countdown");
  } catch (err) {
    console.error("[clips-recorder] show_countdown failed:", err);
  }
  try {
    await countdownEvent;
  } catch (err) {
    if (isCountdownCancelledError(err)) {
      await invoke("hide_recording_chrome").catch(() => {});
      throw err;
    }
    console.warn("[clips-recorder] countdown timed out — proceeding");
    return;
  }
  // The countdown webview emits before it finishes closing. Give macOS a
  // brief beat to remove the overlay and any shortcut handling before capture
  // starts, so the first frame/audio sample is the real recording.
  await wait(COUNTDOWN_OVERLAY_SETTLE_MS);
}

function showFinalizingFeedback() {
  invoke("show_finalizing").catch((err) =>
    console.error("[clips-recorder] show_finalizing failed:", err),
  );
}

async function claimNativeUploadOpen(recordingId: string): Promise<boolean> {
  return invoke<boolean>("native_fullscreen_claim_upload_open", {
    recordingId,
  }).catch(() => true);
}

async function openNativeUploadUrl(
  recordingId: string,
  url: string,
): Promise<void> {
  if (!(await claimNativeUploadOpen(recordingId))) return;
  try {
    await openExternal(url);
  } catch (err) {
    console.error("[clips-recorder] openExternal failed:", err);
  }
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
      ),
    )
    .catch(() => {});
}

async function startNativeFullscreenRecording(
  params: StartParams,
  wantsCamera: boolean,
  wantsAudio: boolean,
  audioCue: AudioCue,
): Promise<RecorderHandle> {
  console.log("[clips-recorder] using native full-screen capture");
  const localRecordingMode = params.localRecordingMode ?? "off";
  const localOnly = localRecordingMode !== "off";
  const localFolderName = localOnly ? createLocalRecordingFolderName() : "";
  const streamCleanups: Array<() => void> = [audioCue.cleanup];
  let id = "";
  let uploadMode: UploadMode = "buffered";
  let localCameraExport: LocalRecordingExportHandle | null = null;
  let localCameraStream: MediaStream | null = null;
  let localOwnsCameraStream = false;
  let bubbleCaptureExcluded = false;
  let captureRegion: RegionCaptureRect | null = null;
  let transcriptionCapture: TranscriptionCapture | null = null;
  // Timer baseline for the toolbar/pill elapsed clock. Stamped the instant
  // native capture goes live (right after the start invoke resolves), not after
  // the region-guide / transcription spin-up — which would push the displayed
  // clock and the toolbar-enable behind the real recording start.
  let startedAt = 0;
  let nativeTranscriptFailureSaved = false;
  const wantsSystemAudio = params.systemAudioOn !== false;
  const wantsRecordedAudio = wantsAudio || wantsSystemAudio;
  let micDeviceLabel: string | null = params.micLabel || null;
  const saveTranscriptFailure = async (failureReason: string) => {
    if (!wantsRecordedAudio || nativeTranscriptFailureSaved || !id) return;
    nativeTranscriptFailureSaved = true;
    await saveRecordingTranscriptFailure(
      params.serverUrl,
      id,
      failureReason,
      params.authToken,
    );
  };
  const startNativeTranscriptionBeforeRecording = async () => {
    if (localOnly || !wantsRecordedAudio || transcriptionCapture) return;
    transcriptionCapture = await startTranscriptionCapture(
      {
        deviceId: params.micId,
        label: micDeviceLabel,
      },
      wantsSystemAudio,
      { voiceProcessing: false },
    );
    if (
      wantsRecordedAudio &&
      !transcriptionCapture &&
      shouldSaveLocalTranscriptionStartupFailure()
    ) {
      void saveTranscriptFailure(
        "macOS Speech recognition could not start for this recording. Check Speech Recognition, System Audio, and Microphone permissions, then retry transcription.",
      );
    }
  };

  try {
    await invoke("park_popover_offscreen").catch(() => {});
    emit("clips:popover-visible", false).catch(() => {});

    if (params.source === "region") {
      captureRegion = await selectRegionForRecording();
      // Frame the selected area now so it stays visible through the countdown
      // and the whole recording. hide_recording_chrome / hide_overlays tear it
      // down on stop, cancel, and the error paths below.
      await showRegionRecordBorder(captureRegion);
    }

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
    // Resolve the mic's REAL device name before native setup. WebKit's deviceId
    // is a salted hash that never equals CoreAudio's device UID, so any native
    // path that needs a mic can only pin the input by NAME. The stored label can
    // be stale or empty (device list locked when picked, or a rotated deviceId
    // salt after an app update), so a one-shot getUserMedia gives the exact
    // current device name.
    if (wantsAudio && params.micId) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: params.micId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
        const liveLabel = probe.getAudioTracks()[0]?.label?.trim();
        probe.getTracks().forEach((track) => track.stop());
        if (liveLabel) micDeviceLabel = liveLabel;
        console.log(
          `[clips-recorder] mic resolve: id=${params.micId} storedLabel=${JSON.stringify(params.micLabel ?? null)} liveLabel=${JSON.stringify(liveLabel ?? null)} -> using=${JSON.stringify(micDeviceLabel)}`,
        );
      } catch (probeErr) {
        // Probe failed (rotated/stale deviceId, device unplugged, or denied) —
        // fall back to the stored label, which the Rust side name-matches.
        console.warn(
          `[clips-recorder] mic probe failed: id=${params.micId} storedLabel=${JSON.stringify(params.micLabel ?? null)} err=${probeErr instanceof Error ? probeErr.name : String(probeErr)} -> falling back to stored label`,
        );
      }
    }
    // Audio config shared by the warm + begin phases — built once so the two
    // phases can't drift.
    const captureAudioParams = {
      includeAudio: wantsAudio,
      captureSystemAudio: wantsSystemAudio,
      micDeviceId: params.micId || null,
      micDeviceLabel,
      captureRegion,
    };
    // Warm ScreenCaptureKit DURING the countdown without recording frames yet.
    // This keeps the capture start off the critical path while letting `begin`
    // attach the recording output at the exact start moment. No-op when SCK is
    // unavailable — `begin` then does a normal immediate start.
    const warmMic = (recordingId: string) =>
      invoke("native_fullscreen_recording_warm", {
        recordingId,
        ...captureAudioParams,
      }).catch((err) => {
        console.warn("[clips-recorder] mic warm failed:", err);
      });
    const countdownPromise = runRecordingCountdown(true);
    if (localOnly) {
      id = localFolderName;
      await Promise.all([countdownPromise, warmMic(id)]);
    } else {
      const captureTitle = await captureTitleForRecording({
        mode: params.mode,
        source: params.source,
      });
      console.time("[clips-recorder] createServerRecording duration");
      const recordingPromise = createServerRecording(
        params.serverUrl,
        wantsCamera,
        wantsRecordedAudio,
        captureTitle,
        {
          mimeType: NATIVE_FULLSCREEN_MIME_TYPE,
          requestStreaming: true,
          streamingUploadClient: "desktop-native",
        },
      ).finally(() => {
        console.timeEnd("[clips-recorder] createServerRecording duration");
      });
      // The recording id usually lands well before the countdown ends — warm
      // native capture as soon as it does so setup overlaps the 3-2-1.
      const warmAndId = (async () => {
        const createRes = await recordingPromise;
        uploadMode = createRes.uploadMode;
        id = createRes.id;
        // Start the live transcription mic tap before SCK attaches its
        // recording output. On macOS, opening AVAudioEngine after SCK has
        // started writing can reconfigure the shared input device and leave
        // SCK's microphone leg near-silent while Whisper still hears audio.
        await startNativeTranscriptionBeforeRecording();
        await warmMic(createRes.id);
        return createRes.id;
      })();
      try {
        const [, warmedId] = await Promise.all([countdownPromise, warmAndId]);
        id = warmedId;
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
    // Phase 2: attach the recording output now that the mic is warm (or do a
    // normal immediate start if warming was skipped/failed).
    await invoke("native_fullscreen_recording_begin", {
      recordingId: id,
      ...captureAudioParams,
    });
    await transcriptionCapture?.resetTimeline().catch((err) => {
      console.warn(
        "[clips-recorder] transcription timeline reset failed:",
        err,
      );
    });
    // Capture is now live — after rebasing the transcript timeline, stamp the
    // timer baseline so the toolbar clock lines up with the real start.
    startedAt = Date.now();
    localCameraExport?.start(2_000);
  } catch (err) {
    await localCameraExport?.cancel().catch(() => {});
    await transcriptionCapture?.cancel().catch((cancelErr) => {
      console.warn(
        "[clips-recorder] native transcription cancel after start failure failed:",
        cancelErr,
      );
    });
    // Tear down any capture started by the warm phase — on a countdown cancel
    // (or a `begin` failure) the SCStream is already running with the mic live,
    // and without this it would keep capturing after the aborted start.
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
      await abortRecordingUpload(
        params.serverUrl,
        id,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }

  let stopped = false;
  let stopPromise: Promise<RecorderStopResult> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let stateUnlistens: UnlistenFn[] = [];
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let segmentRotateHandle: ReturnType<typeof setInterval> | null = null;
  let segmentRotateInFlight = false;
  // Pause/resume tracking. The Rust side actually stops the SCStream on
  // pause and starts a new segment on resume; on stop it concatenates
  // segments via AVFoundation. We keep the JS-side timer in sync so the
  // toolbar / pill show the right paused state and elapsed time.
  let pausedAt: number | null = null;
  let accumulatedPauseMs = 0;

  function clearSegmentRotator() {
    if (segmentRotateHandle) {
      clearInterval(segmentRotateHandle);
      segmentRotateHandle = null;
    }
  }

  function startSegmentRotator() {
    clearSegmentRotator();
    segmentRotateHandle = setInterval(() => {
      if (stopped || pausedAt != null || segmentRotateInFlight) return;
      segmentRotateInFlight = true;
      invoke("native_fullscreen_recording_rotate_segment")
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[clips-recorder] native segment rotation failed:", err);
          if (
            !stopped &&
            pausedAt == null &&
            message.includes("paused recording")
          ) {
            pausedAt = Date.now();
            emitState();
          }
        })
        .finally(() => {
          segmentRotateInFlight = false;
        });
    }, NATIVE_FULLSCREEN_SEGMENT_MS);
  }

  function emitState() {
    const now = Date.now();
    const pausedNowMs = pausedAt != null ? now - pausedAt : 0;
    const elapsedMs = Math.max(
      0,
      now - startedAt - accumulatedPauseMs - pausedNowMs,
    );
    emit("clips:recorder-state", {
      paused: pausedAt != null,
      elapsedMs,
    }).catch(() => {});
  }

  const handle: RecorderHandle = {
    async stop() {
      if (stopPromise) return stopPromise;
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopPromise = (async () => {
        stopped = true;
        console.log("[clips-recorder] native full-screen stop requested");
        if (!localOnly) showFinalizingFeedback();
        clearSegmentRotator();
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        stateUnlistens.forEach((u) => u());
        stateUnlistens = [];
        // If the user hits Stop while paused, account for the open pause
        // interval so the reported elapsed/duration excludes it.
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

        // A native recording runs two ScreenCaptureKit streams: the screen
        // recorder and the whisper system-audio recognizer (system_audio.rs
        // opens its own SCStream with captures_audio). Tearing the transcription
        // stream down while the recorder is flushing its final `moov` atom
        // interrupts ScreenCaptureKit (RPRecordingErrorDomain -5814,
        // "Application connection interrupted"), so the recorder's
        // SCRecordingOutput aborts before the moov is written and the MP4 is left
        // permanently corrupt. The teardowns must be sequenced: recorder first,
        // transcription second.
        //
        // We also must not delay the recorder stop, or the clip keeps capturing
        // past the Stop click (Rust measures duration when the stop command
        // runs, and transcriptionCapture.stop() blocks on a ~1.5s settle).
        //
        // So: start the native finalize+upload now, which stops the recorder
        // capture immediately; wait for Rust to emit that the recorder has
        // finalized (moov written); only then tear the transcription stream
        // down. A timeout longer than the Rust finalize ceiling
        // (SCK_FINALIZE_TIMEOUT) guards against a lost event so Stop can never
        // hang.
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
          await invoke("set_recording_state", { active: false }).catch(
            () => {},
          );

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
            await saveTranscriptFailure(
              "No speech was captured during this recording. If you spoke or played system audio, check System Audio, Microphone input, Speech Recognition permission, and the selected mic, then retry transcription.",
            );
          }

          const chromeCmd = wantsCamera
            ? "hide_recording_chrome"
            : "hide_overlays";
          await invoke(chromeCmd).catch((err) =>
            console.error(`[clips-recorder] ${chromeCmd} failed:`, err),
          );
          await invoke("native_fullscreen_capture_thumbnail", {
            serverUrl: params.serverUrl,
            recordingId: id,
            authToken: params.authToken ?? "",
            cookie: params.cookie ?? "",
          }).catch((err) => {
            console.warn(
              "[clips-recorder] native thumbnail capture/upload failed:",
              err,
            );
          });

          try {
            uploadResult = await uploadPromise;
          } catch (err) {
            if (
              await recoverReadyRecordingAfterFinalizeError({
                serverUrl: params.serverUrl,
                recordingId: id,
                authToken: params.authToken,
              })
            ) {
              await openNativeUploadUrl(
                id,
                `${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`,
              );
              return { recordingId: id, viewUrl };
            }
            await abortRecordingUpload(
              params.serverUrl,
              id,
              err instanceof Error ? err.message : String(err),
            );
            // Still take the user to the clip status page. If the server
            // marked the upload failed, that page shows the failure state; if
            // the abort request could not land, it keeps polling instead of
            // leaving the user on an empty desktop.
            try {
              await openExternal(
                `${params.serverUrl.replace(
                  /\/+$/,
                  "",
                )}${viewUrl}?saveFailed=1`,
              );
            } catch (openErr) {
              console.error("[clips-recorder] openExternal failed:", openErr);
            }
            throw err;
          }

          await openNativeUploadUrl(
            uploadResult.recordingId,
            `${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`,
          );
          return {
            recordingId: uploadResult.recordingId,
            viewUrl,
          };
        } finally {
          streamCleanups.forEach((cleanup) => cleanup());
          invoke("hide_finalizing").catch((err) =>
            console.error("[clips-recorder] hide_finalizing failed:", err),
          );
        }
      })();
      return stopPromise;
    },

    async cancel() {
      if (cancelPromise) return cancelPromise;
      if (stopped) return;
      cancelPromise = (async () => {
        stopped = true;
        clearSegmentRotator();
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        stateUnlistens.forEach((u) => u());
        stateUnlistens = [];
        void transcriptionCapture?.cancel().catch((err) => {
          console.warn(
            "[clips-recorder] native transcription cancel failed:",
            err,
          );
        });
        await localCameraExport?.cancel().catch(() => {});
        await invoke("native_fullscreen_recording_cancel").catch((err) =>
          console.warn(
            "[clips-recorder] native fullscreen cancel failed:",
            err,
          ),
        );
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
        await invoke("hide_overlays").catch(() => {});
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
      })();
      return cancelPromise;
    },
  };

  const toolbarUnlistens = await Promise.all([
    listen("clips:recorder-pause", () => {
      if (pausedAt != null) return;
      const at = Date.now();
      invoke("native_fullscreen_recording_pause")
        .then(() => {
          pausedAt = at;
          emitState();
          console.log("[clips-recorder] native pause: pausing transcription");
          void transcriptionCapture?.pause().catch(() => {});
        })
        .catch((err) => {
          console.warn("[clips-recorder] native pause failed:", err);
        });
    }),
    listen("clips:recorder-resume", () => {
      if (pausedAt == null) return;
      // Only resume transcription once the recorder actually resumed, so a
      // rejected IPC can't leave transcription running over a paused recording.
      invoke("native_fullscreen_recording_resume")
        .then(() => {
          if (pausedAt != null) {
            accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
          }
          emitState();
          console.log("[clips-recorder] native resume: resuming transcription");
          void transcriptionCapture?.resume().catch(() => {});
        })
        .catch((err) => {
          console.warn("[clips-recorder] native resume failed:", err);
        });
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
  ]);
  stateUnlistens = toolbarUnlistens;
  tickHandle = setInterval(emitState, 500);
  startSegmentRotator();
  emit("clips:toolbar-enabled", true).catch(() => {});
  emitState();

  if (!localOnly) {
    if (pausedAt != null && transcriptionCapture) {
      // The user paused while the engine was still starting; honor it now.
      console.log(
        "[clips-recorder] native: paused during startup, pausing transcription",
      );
      void transcriptionCapture.pause().catch(() => {});
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
  try {
    return await startRecordingInner(params);
  } catch (err) {
    await invoke("hide_recording_chrome").catch(() => {});
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

async function startRecordingInner(
  params: StartParams,
): Promise<RecorderHandle> {
  const wantsScreen = params.mode !== "camera";
  const wantsCamera = params.mode !== "screen" && params.cameraOn;
  const wantsAudio = params.micOn;
  const wantsSystemAudio = wantsScreen && params.systemAudioOn !== false;
  const wantsRecordedAudio = wantsAudio || wantsSystemAudio;
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

  if (wantsScreen && shouldUseNativeFullscreenRecording(captureSource)) {
    return startNativeFullscreenRecording(
      params,
      wantsCamera,
      wantsAudio,
      audioCue,
    );
  }

  // 1. Acquire streams BEFORE the countdown so the user gets the permission
  //    prompts out of the way while the popover is still focused.
  //
  // CRITICAL: WebKit requires `getDisplayMedia` to be called from a user
  // gesture handler. The first `await` consumes the user activation, so if
  // we awaited one stream before kicking off the next, the second call
  // would throw `getDisplayMedia must be called from a user gesture
  // handler.` To keep all three requests anchored to the same gesture, we
  // INITIATE every promise synchronously (no await between them) and then
  // Promise.all them together. The cross-page mute concern documented at
  // the top of this file is about which *page* owns the camera (popover vs
  // bubble window) — not the order of calls within this same page — so
  // starting all three in parallel is safe.
  // `video: false` on the audio getUserMedia is EXPLICIT — WebKit on macOS
  // has been observed to treat `{ audio: ... }` with no `video` key as
  // "caller hasn't expressed a video preference" and renegotiate the
  // page's media session in unpredictable ways.
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
  const streamCleanups: Array<() => void> = [audioCue.cleanup];
  const devSyntheticCapture = shouldUseDevSyntheticCapture();

  const displayStreamPromise: Promise<MediaStream> | null = wantsScreen
    ? (() => {
        if (!devSyntheticCapture) {
          // Do not pass displaySurface as an input constraint. Modern runtimes
          // can reject it with "Invalid constraint", and it cannot reliably
          // pre-filter the OS picker anyway; the selected track reports its
          // actual surface through getSettings() after capture starts.
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
  // If the popover handed us a live camera stream from the pre-record
  // preview we reuse it verbatim and SKIP getUserMedia — see the
  // `preAcquiredCameraStream` field doc for the WebKit rationale. This
  // also means the preview → recording transition is seamless (no black
  // flash while the camera renegotiates).
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
      ? getCameraStreamWithFallback(params.cameraId)
      : null;
  const audioStreamPromise: Promise<MediaStream> | null = wantsAudio
    ? getAudioStreamWithFallback(params.micId, params.micLabel)
    : null;

  // Use allSettled so a single rejection (e.g. user cancels the macOS screen
  // picker → `NotAllowedError`) doesn't leave the OTHER resolved streams
  // orphaned with live tracks. If ANY of the three rejected, we stop every
  // track that DID resolve, then re-throw the original error so the caller's
  // catch still sees `NotAllowedError` / `AbortError` as before.
  console.log("[clips-recorder] allSettled IN — streams dispatched");
  const settled = await Promise.allSettled([
    displayStreamPromise,
    bubbleCameraStreamPromise,
    audioStreamPromise,
  ]);
  console.log(
    "[clips-recorder] allSettled OUT — settled statuses:",
    settled.map((s) => s.status),
  );
  const firstRejectionIndex = settled.findIndex((s) => s.status === "rejected");
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
      // NOTE: we do NOT stop `reusedCameraStream` tracks here. The popover
      // owns the camera for the entire session (see top-of-file comment +
      // `preAcquiredCameraStream` doc) — it keeps the stream alive so the
      // bubble stays live while the user retries.
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
  // Reused (from preview) XOR freshly acquired — `bubbleCameraStreamPromise`
  // was null when we reused, so only one of the two can be non-null.
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
    streamCleanups.push(recordedScreenCameraStream.cleanup);
    console.log("[clips-recorder] compositing camera into recorded video");
  }

  // Choose the primary video track for MediaRecorder:
  //   - screen mode             → display
  //   - screen-camera mode      → composited display + camera
  //   - camera mode             → camera
  const primaryVideo =
    recordedScreenCameraStream?.stream ??
    displayStream ??
    (params.mode === "camera" ? bubbleCameraStream : null);
  if (!primaryVideo) throw new Error("No video stream available");

  const combined = new MediaStream();
  primaryVideo.getVideoTracks().forEach((t) => combined.addTrack(t));
  // Mic + system audio (mixed when both present); see buildRecordingAudio.
  const recordingAudio = buildRecordingAudio(
    audioStream?.getAudioTracks() ?? [],
    displayStream?.getAudioTracks() ?? [],
  );
  streamCleanups.push(recordingAudio.cleanup);
  recordingAudio.tracks.forEach((t) => combined.addTrack(t));

  // The popover owns the camera stream whenever we reused its pre-acquired
  // preview stream — its session effect decides when to close the stream +
  // hide the bubble + stop the pump, so the recorder must NOT stop those
  // tracks on stop/cancel. The rare exception is the fresh-acquire fallback
  // (preview stream wasn't ready at record start, so we opened the camera
  // ourselves above) — there we own the tracks and must stop them, or the
  // camera + macOS recording indicator leak after the recording ends.
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

    const countdownPromise = runRecordingCountdown(wantsScreen);
    const localExportPromise = prepareLocalRecordingExport(targets);
    let localExport: Awaited<ReturnType<typeof prepareLocalRecordingExport>>;
    try {
      [, localExport] = await Promise.all([
        countdownPromise,
        localExportPromise,
      ]);
    } catch (err) {
      [displayStream, audioStream].forEach((stream) =>
        stream?.getTracks().forEach((track) => track.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((track) => track.stop());
      }
      throw err;
    }

    const id = `local-${Date.now().toString(36)}`;
    // Stamped at the real capture start below — kept 0 until then so the tick
    // never reports an elapsed time against a stale baseline (which showed the
    // clock counting up and then resetting to 0 when start finally fired).
    let startedAt = 0;
    let pausedAt: number | null = null;
    let accumulatedPauseMs = 0;
    let stopped = false;
    let stateUnlistens: UnlistenFn[] = [];
    let tickHandle: ReturnType<typeof setInterval> | null = null;

    function emitState(paused: boolean) {
      const now = Date.now();
      const pausedNowMs = paused && pausedAt ? now - pausedAt : 0;
      const elapsedMs = now - startedAt - accumulatedPauseMs - pausedNowMs;
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
    ]);
    stateUnlistens = toolbarUnlistens;

    await showRegionGuidesForRecording(wantsScreen);
    await audioCue.playBeforeCapture();
    localExport.start(2_000);
    startedAt = Date.now();
    tickHandle = setInterval(() => emitState(pausedAt != null), 500);
    emit("clips:toolbar-enabled", true).catch(() => {});
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

    const stopOwnedStreams = () => {
      [displayStream, audioStream].forEach((stream) =>
        stream?.getTracks().forEach((track) => track.stop()),
      );
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
        stopped = true;
        if (tickHandle) clearInterval(tickHandle);
        stateUnlistens.forEach((unlisten) => unlisten());
        stateUnlistens = [];
        await localExport.cancel();
        detachCombinedStream();
        stopOwnedStreams();
        await hideChrome();
      },
    };

    return handle;
  }

  const uploadPrimaryVideo = createUploadOptimizedVideoStream(primaryVideo);
  streamCleanups.push(uploadPrimaryVideo.cleanup);

  const uploadCombined = new MediaStream();
  uploadPrimaryVideo.stream
    .getVideoTracks()
    .forEach((track) => uploadCombined.addTrack(track));
  recordingAudio.tracks.forEach((track) => uploadCombined.addTrack(track));

  // MIME type is resolved up front so create-recording can initialize the
  // resumable session with the correct content type when the server supports
  // streaming uploads.
  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

  // 2+3. Countdown + create-recording happen IN PARALLEL. The countdown is
  // pure visual feedback — gating it on a network round-trip makes the
  // 3-2-1 feel laggy after the user picks a screen. Kick both off and
  // wait at the end before starting the MediaRecorder.
  console.log(
    "[clips-recorder] invoking show_countdown + createServerRecording",
  );
  const countdownPromise = runRecordingCountdown(wantsScreen);
  console.time("[clips-recorder] createServerRecording duration");
  const recordingPromise = createServerRecording(
    params.serverUrl,
    wantsCamera,
    recordingAudio.tracks.length > 0,
    captureTitle,
    { mimeType: mimeType || "video/webm", requestStreaming: true },
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
  const saveTranscriptFailure = async (failureReason: string) => {
    if (!wantsRecordedAudio || nativeTranscriptFailureSaved) return;
    nativeTranscriptFailureSaved = true;
    await saveRecordingTranscriptFailure(
      params.serverUrl,
      id,
      failureReason,
      params.authToken,
    );
  };

  // 4. Start MediaRecorder with a 2-second timeslice — each `ondataavailable`
  //    streams a chunk to the server, so we don't hold 5-min buffers in memory.
  const recorder = createCloudMediaRecorder(uploadCombined, mimeType);
  let chunkIndex = 0;
  let failed: Error | null = null;
  let backupBytes = 0;
  // Backup chunks are indexed by raw MediaRecorder blob (one per
  // `ondataavailable`), independent of `chunkIndex` — on the streaming path
  // `chunkIndex` counts aligned upload slices, not raw blobs.
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
  persistBackupMeta().catch((err) => {
    console.warn("[clips-recorder] local backup metadata failed:", err);
  });

  // Every raw MediaRecorder blob is mirrored to IndexedDB on both upload paths.
  // If uploads fail the recording can still be recovered locally — replayed to
  // the server (the retry first resets any resumable session so replay routes
  // through the buffered chunk path) or exported to a local file.
  const backupWrites = new Set<Promise<void>>();
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
        console.warn("[clips-recorder] local chunk backup failed:", err);
      }
    })().finally(() => {
      backupWrites.delete(w);
    });
    backupWrites.add(w);
    return w;
  };
  // In-flight chunk uploads. We use a Set (not an array) so entries can be
  // removed as soon as each fetch settles — otherwise, for a 30-minute
  // recording the array grows to 900 Promises, and EACH promise closes over
  // the Blob it's uploading. MediaRecorder Blobs are the raw encoded video
  // chunk — ~500KB to ~1MB each. Holding 900 of them is a ~700MB leak per
  // recording, and cumulative across recordings in a long-lived process.
  // See `uploadChunk()` — it removes its own entry in `.finally()`.
  const inflight = new Set<Promise<void>>();

  // Streaming-path state. When the server opened a resumable session, blobs
  // accumulate here until at least STREAM_CHUNK_BYTES is available, then a
  // 256 KiB-aligned slice is uploaded as a non-final chunk. Resumable sessions
  // append by byte offset server-side, so streamed chunks MUST arrive in order
  // — uploads are serialized through `streamQueue`. The unaligned remainder is
  // sent as the final chunk on stop().
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

    // Always mirror the raw blob to the local backup first (disaster recovery).
    void backupChunkLocally(ev.data);

    if (uploadMode === "streaming") {
      // Resumable session on the server: buffer and flush 256 KiB-aligned
      // slices, uploaded in order. The unaligned remainder is sent as the
      // final chunk on stop().
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
    // Wrap so `inflight.delete(p)` runs regardless of outcome. The closure
    // holds the Blob only for the duration of this fetch — once removed,
    // the Blob (and this promise) become GC-able. Note we assign `p` before
    // constructing the promise body so `inflight.delete(p)` inside the
    // `.finally` can reference the same handle we added.
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

  // Stamped at the real capture start below — kept 0 until then so the tick
  // never reports elapsed against a stale baseline (which showed the clock
  // counting up and then resetting to 0 when recorder.start finally fired).
  let startedAt = 0;
  let pausedAt: number | null = null;
  let accumulatedPauseMs = 0;
  let stopped = false;
  let stateUnlistens: UnlistenFn[] = [];
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  function emitState(paused: boolean) {
    const now = Date.now();
    const pausedNowMs = paused && pausedAt ? now - pausedAt : 0;
    const elapsedMs = now - startedAt - accumulatedPauseMs - pausedNowMs;
    emit("clips:recorder-state", {
      paused,
      elapsedMs,
    }).catch(() => {});
  }

  async function openFailedRecordingPage() {
    const viewUrl = `/r/${id}?saveFailed=1`;
    try {
      await openExternal(`${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`);
    } catch (err) {
      console.error("[clips-recorder] openExternal failed:", err);
    }
  }

  // 5. Wire toolbar events.
  const toolbarUnlistens = await Promise.all([
    listen("clips:recorder-pause", () => {
      if (recorder.state === "recording") {
        try {
          recorder.pause();
          pausedAt = Date.now();
          emitState(true);
          console.log("[clips-recorder] recorder pause: pausing transcription");
          void transcriptionCapture?.pause().catch(() => {});
        } catch {
          // ignore
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
        } catch {
          // ignore
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
  ]);
  stateUnlistens = toolbarUnlistens;

  await showRegionGuidesForRecording(wantsScreen);
  await audioCue.playBeforeCapture();
  recorder.start(LIVE_UPLOAD_CHUNK_MS);
  startedAt = Date.now();
  tickHandle = setInterval(() => emitState(pausedAt != null), 500);
  // The toolbar is already open (the popover's bubble-session effect
  // spawns it alongside the bubble in its pre-record, disabled state).
  // Now that MediaRecorder is actually ticking, flip the toolbar's
  // Stop / Pause buttons to enabled so the user can drive the recorder.
  emit("clips:toolbar-enabled", true).catch(() => {});
  // Seed the initial recorder-state so the time / paused styling match
  // MediaRecorder's real state (before the first 500ms tick).
  emitState(false);

  // Live transcription capture starts AFTER the recorder is live. Its mic +
  // ScreenCaptureKit spin-up takes ~1s; awaiting it before recorder.start was
  // delaying capture, so the first ~1s the user expected to record was lost
  // (and the recording felt cut at the end). It's a separate capture from the
  // recorded audio tracks, so starting it slightly late is safe.
  transcriptionCapture = wantsRecordedAudio
    ? await startTranscriptionCapture(
        {
          deviceId: params.micId,
          label: params.micLabel,
        },
        wantsSystemAudio,
      )
    : null;
  // Stop/Cancel can fire during the await above — at that point stop()/cancel()
  // ran while transcriptionCapture was still null, so it never tore this down.
  // Cancel the freshly-started session here so it doesn't keep running.
  if (stopped && transcriptionCapture) {
    void transcriptionCapture.cancel().catch(() => {});
    transcriptionCapture = null;
  } else if (pausedAt != null && transcriptionCapture) {
    // The user paused while the engine was still starting; honor it now.
    console.log(
      "[clips-recorder] recorder: paused during startup, pausing transcription",
    );
    void transcriptionCapture.pause().catch(() => {});
  } else if (
    wantsRecordedAudio &&
    !transcriptionCapture &&
    shouldSaveLocalTranscriptionStartupFailure()
  ) {
    void saveTranscriptFailure(
      "macOS Speech recognition could not start for this recording. Check Speech Recognition, System Audio, and Microphone permissions, then retry transcription.",
    );
  }

  // 6. Bubble + toolbar visibility are owned by the popover's session
  // effect (see app.tsx + bubble-pump.ts) — not the recorder. Both open
  // as soon as the user opens the popover in screen-camera / camera mode
  // with cameraOn. The recorder reuses that camera stream for the saved
  // video composite and flips the toolbar from disabled → enabled above.

  const handle: RecorderHandle = {
    async stop() {
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopped = true;
      // Stamped right after the recorder fully stops below (see stoppedAt).
      // Duration must measure recorded content — through the final flushed
      // chunk — but NOT the transcript-finalize + thumbnail + upload awaits that
      // follow, which add ~seconds and would overstate the saved duration.
      let stoppedAt = 0;
      console.log("[clips-recorder] stop requested");
      showFinalizingFeedback();
      if (tickHandle) clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];

      // Flush the in-flight recorder buffer, then wait for it to fully stop
      // so we get the trailing dataavailable event.
      await new Promise<void>((resolve) => {
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        recorder.addEventListener("stop", () => resolve(), { once: true });
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
      // Recorder has fully stopped and flushed its trailing chunk — this is the
      // true end of recorded content. Everything after (transcript, thumbnail,
      // upload) is post-processing and must not count toward duration.
      stoppedAt = Date.now();

      const thumbnailUploadPromise = captureAndUploadRecordingThumbnail({
        serverUrl: params.serverUrl,
        recordingId: id,
        stream: primaryVideo,
        authToken: params.authToken,
      }).catch((err) => {
        console.warn("[clips-recorder] thumbnail capture/upload failed:", err);
      });

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
        await saveTranscriptFailure(
          "No speech was captured during this recording. If you spoke or played system audio, check System Audio, Microphone input, Speech Recognition permission, and the selected mic, then retry transcription.",
        );
      }
      await thumbnailUploadPromise;

      if (popoverOwnsCamera) {
        console.log("[clips-recorder] releasing popover camera");
        emit("clips:release-camera").catch(() => {});
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
      }).catch((err) => {
        console.warn(
          "[clips-recorder] local backup final metadata failed:",
          err,
        );
      });

      // Null the data handler so the final MediaRecorder teardown
      // doesn't keep the closure (which captures `inflight`, the URL
      // builder, and indirectly the MediaStream) reachable after we're
      // done with it. WebKit's MediaRecorder can retain a reference to
      // its event handler for the life of the object if you leave a
      // non-null ondataavailable in place — null it to break the chain.
      recorder.ondataavailable = null;
      // Clear MediaStream track lists — just removing our
      // references to the tracks is enough; the tracks themselves are
      // owned by `displayStream` / `audioStream` / `bubbleCameraStream`
      // and get stopped below.
      try {
        uploadCombined
          .getTracks()
          .forEach((t) => uploadCombined.removeTrack(t));
        combined.getTracks().forEach((t) => combined.removeTrack(t));
      } catch {
        // ignore — best-effort
      }

      // Stop the streams WE own so OS permission indicators clear. The
      // camera stream is owned by the popover when reused — we leave it
      // alone so the bubble stays live if the popover is still open.
      [displayStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }

      // Hide the recording-specific overlays (countdown + toolbar). The
      // bubble is managed by the popover's session effect — when the
      // popover is hidden or the user turns camera off, that effect tears
      // down the bubble. Closing it here would cause a flicker on the
      // cancel path where the popover re-appears with camera still on.
      console.log("[clips-recorder] hiding recording chrome");
      await invoke("hide_recording_chrome").catch((err) =>
        console.error(`[clips-recorder] hide_recording_chrome failed:`, err),
      );
      await invoke("set_recording_state", { active: false }).catch(() => {});

      // Wait for any in-flight chunk uploads to settle before sending the
      // final chunk. Otherwise the server could finalize before the last
      // few bytes land. On the streaming path uploads are serialized through
      // `streamQueue`; on the buffered path they run concurrently and each
      // `.finally` has already removed settled entries from `inflight`.
      const pending = Array.from(inflight);
      if (uploadMode === "streaming") {
        await streamQueue;
      } else {
        await Promise.allSettled(pending);
      }
      inflight.clear();
      // Ensure the local backup is fully written before we either delete it
      // (on success) or leave it in place for recovery (on failure).
      await Promise.allSettled([...backupWrites]);
      if (failed) {
        console.error("[clips-recorder] chunk upload failed:", failed);
        await markBrowserRecordingBackupError(id, failed.message).catch(
          () => {},
        );
        await abortRecordingUpload(params.serverUrl, id, failed.message);
        invoke("hide_finalizing").catch((err) =>
          console.error("[clips-recorder] hide_finalizing failed:", err),
        );
        await openFailedRecordingPage();
        throw failed;
      }

      // Streaming: the closing bytes are whatever remains under the 256 KiB
      // alignment boundary — send them as the final chunk so the resumable
      // session can complete. Buffered: bytes are already staged server-side,
      // so the final chunk is a 0-byte close sentinel.
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
        const finalRes = await fetch(finalizeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          credentials: "include",
          body: finalBody,
          signal: AbortSignal.timeout(FINALIZE_UPLOAD_TIMEOUT_MS),
        });
        const bodyText = await finalRes.text().catch(() => "");
        console.log(
          "[clips-recorder] finalize response:",
          finalRes.status,
          bodyText.slice(0, 500),
        );
        if (!finalRes.ok) {
          throw new Error(
            `Finalize failed (${finalRes.status}): ${bodyText.slice(0, 200)}`,
          );
        }
      } catch (err) {
        console.error("[clips-recorder] finalize fetch failed:", err);
        const error = err instanceof Error ? err : new Error(String(err));
        if (
          await recoverReadyRecordingAfterFinalizeError({
            serverUrl: params.serverUrl,
            recordingId: id,
            authToken: params.authToken,
          })
        ) {
          const viewUrl = `/r/${id}`;
          try {
            await openExternal(
              `${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`,
            );
          } catch (openErr) {
            console.error("[clips-recorder] openExternal failed:", openErr);
          }
          invoke("hide_finalizing").catch((hideErr) =>
            console.error("[clips-recorder] hide_finalizing failed:", hideErr),
          );
          return { recordingId: id, viewUrl };
        }
        await markBrowserRecordingBackupError(id, error.message).catch(
          () => {},
        );
        await abortRecordingUpload(params.serverUrl, id, error.message);
        invoke("hide_finalizing").catch((hideErr) =>
          console.error("[clips-recorder] hide_finalizing failed:", hideErr),
        );
        await openFailedRecordingPage();
        throw error;
      }
      await deleteBrowserRecordingBackup(id).catch((err) => {
        console.warn("[clips-recorder] local backup cleanup failed:", err);
      });

      // Finalize done (or tried and failed — the player page shows a clear
      // error state in either case). Open the browser to the playback URL
      // and THEN close the finalizing spinner. Closing before the browser
      // opens would leave the user staring at an empty desktop for the
      // brief moment while the OS launches / focuses the default browser.
      const viewUrl = `/r/${id}`;
      try {
        await openExternal(`${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`);
      } catch (err) {
        console.error("[clips-recorder] openExternal failed:", err);
      }
      invoke("hide_finalizing").catch((err) =>
        console.error("[clips-recorder] hide_finalizing failed:", err),
      );

      return { recordingId: id, viewUrl };
    },

    async cancel() {
      if (stopped) return;
      stopped = true;
      if (tickHandle) clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];
      void transcriptionCapture?.cancel().catch((err) => {
        console.warn("[clips-recorder] transcription cancel failed:", err);
      });
      // Remove MediaRecorder's data handler so any final `ondataavailable`
      // from the stop() below doesn't push a new Blob into `inflight`
      // after we've decided to discard everything.
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
      // Drop stream track references — same rationale as in stop(). This
      // detaches only from the MediaStreams; the originating streams own the
      // tracks and we stop them below.
      try {
        uploadCombined
          .getTracks()
          .forEach((t) => uploadCombined.removeTrack(t));
        combined.getTracks().forEach((t) => combined.removeTrack(t));
      } catch {
        // ignore
      }
      // Stop the streams WE own. Camera stays alive when the popover
      // owns it (see stop() for the same split).
      [displayStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }
      // Drop remaining in-flight chunk Blobs aggressively. Their fetches
      // will still settle (we don't AbortController them — dev server is
      // local and won't hang long) but we no longer hold references to the
      // Blobs via this Set. Combined with the `ondataavailable = null`
      // above, this guarantees no new Blobs latch on during the stop.
      inflight.clear();
      await invoke("hide_recording_chrome").catch(() => {});
      // Tell the server to abort the partial recording (drops chunks from
      // application_state, flips the recording row to 'failed'), then trash
      // it. This is best-effort background cleanup: redo/cancel must release
      // the desktop chrome immediately even if the server is slow or offline.
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
    },
  };

  return handle;
}
