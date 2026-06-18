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
import { createAudioCue, type AudioCue } from "./audio-cue";
import { createCameraCompositeStream } from "./camera-composite";
import {
  startTranscriptionCapture,
  type CapturedTranscript,
  type TranscriptionCapture,
} from "./transcription-capture";
import {
  createLocalRecordingFolderName,
  exportBlobChunksToLocalRecordingFile,
  prepareLocalRecordingExport,
  type LocalBlobExportResult,
  type LocalRecordingExportHandle,
  type LocalExportedFile,
  type LocalRecordingTarget,
} from "./local-export";
import { buildCaptureTitle, type CaptureTitleResult } from "./recording-title";
import type { LocalRecordingMode } from "../shared/config";

export type { LocalExportedFile } from "./local-export";

export type CaptureMode = "screen" | "screen-camera" | "camera";
export type CaptureSource = "full-screen" | "window";

const NATIVE_FULLSCREEN_RECORDING_FLAG = "clips:native-fullscreen-recording";
const DEV_SYNTHETIC_CAPTURE_FLAG = "clips:dev-synthetic-capture";
const LEGACY_DEV_REAL_CAPTURE_FLAG = "clips:dev-real-capture";
const LIVE_UPLOAD_CHUNK_MS = 1_000;
const CLOUD_CAPTURE_FRAME_RATE = 24;
const CLOUD_CAPTURE_MAX_WIDTH = 1920;
const CLOUD_CAPTURE_MAX_HEIGHT = 1080;
const CLOUD_RECORDING_MAX_LONG_EDGE = 1280;
const CLOUD_RECORDING_VIDEO_BITRATE_BPS = 900_000;
const CLOUD_RECORDING_AUDIO_BITRATE_BPS = 96_000;

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
  if (source !== "full-screen") return false;
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

const VOICE_FOCUSED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
};

function voiceFocusedAudioConstraints(
  deviceId?: string | null,
): MediaTrackConstraints {
  return {
    ...VOICE_FOCUSED_AUDIO_CONSTRAINTS,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
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
  audioStream,
  combined,
}: {
  localRecordingMode: Exclude<LocalRecordingMode, "off">;
  displayStream: MediaStream | null;
  bubbleCameraStream: MediaStream | null;
  audioStream: MediaStream | null;
  combined: MediaStream;
}): LocalRecordingTarget[] {
  if (localRecordingMode === "composed") {
    return [{ role: "composed", stream: combined }];
  }

  const targets: LocalRecordingTarget[] = [];
  if (displayStream) {
    const desktopTracks = [
      ...displayStream.getVideoTracks(),
      ...(audioStream?.getAudioTracks() ?? displayStream.getAudioTracks()),
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

    await postBackupChunk(
      chunkUrl(meta.serverUrl, meta.recordingId, validatedChunks.length, true, {
        total: String(totalPosts),
        mimeType: meta.mimeType,
        durationMs: String(Math.round(meta.durationMs || 0)),
        ...(meta.width ? { width: String(meta.width) } : {}),
        ...(meta.height ? { height: String(meta.height) } : {}),
        hasAudio: meta.hasAudio ? "1" : "0",
        hasCamera: meta.hasCamera ? "1" : "0",
      }),
      new Blob([], { type: meta.mimeType }),
      input.authToken,
    );

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
) {
  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/create-recording`;
  console.log("[clips-recorder] POST", url, {
    hasCamera,
    hasAudio,
    title: titleContext?.title,
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
  const data = (await res.json()) as { result?: { id: string }; id?: string };
  const result = data.result ?? data;
  if (!result.id) {
    throw new Error("create-recording did not return an id");
  }
  return { id: result.id };
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
    displaySurface: params.source === "full-screen" ? "monitor" : "window",
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
        source: "whisper",
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

async function uploadChunk(url: string, blob: Blob): Promise<void> {
  // Signal to the bubble frame pump that a chunk is being uploaded.
  // The pump's tick loop checks this flag and yields its slot to the
  // fetch for the ~150-300ms the POST takes to serialize and land.
  // Cleared in `finally` below so a throw still releases the pump.
  incChunkBusy();
  let res: Response;
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
    });
  } finally {
    decChunkBusy();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      "[clips-recorder] chunk failed:",
      res.status,
      body.slice(0, 200),
    );
    throw new Error(`chunk ${res.status}: ${body.slice(0, 200)}`);
  }
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
  console.log("[clips-recorder] chunk ok:", res.status, blob.size, "bytes");
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

class CountdownCancelledError extends Error {
  constructor() {
    super("Recording cancelled during countdown");
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

async function runRecordingCountdown(wantsScreen: boolean) {
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
  let localCameraExport: LocalRecordingExportHandle | null = null;
  let localCameraStream: MediaStream | null = null;
  let localOwnsCameraStream = false;
  let bubbleCaptureExcluded = false;
  let transcriptionCapture: TranscriptionCapture | null = null;
  // Timer baseline for the toolbar/pill elapsed clock. Stamped the instant
  // native capture goes live (right after the start invoke resolves), not after
  // the region-guide / transcription spin-up — which would push the displayed
  // clock and the toolbar-enable behind the real recording start.
  let startedAt = 0;
  let nativeTranscriptFailureSaved = false;
  const saveTranscriptFailure = async (failureReason: string) => {
    if (!wantsAudio || nativeTranscriptFailureSaved || !id) return;
    nativeTranscriptFailureSaved = true;
    await saveRecordingTranscriptFailure(
      params.serverUrl,
      id,
      failureReason,
      params.authToken,
    );
  };

  try {
    await invoke("park_popover_offscreen").catch(() => {});
    emit("clips:popover-visible", false).catch(() => {});

    if (localOnly && localRecordingMode === "separate" && wantsCamera) {
      localCameraStream =
        params.preAcquiredCameraStream ??
        (await navigator.mediaDevices.getUserMedia({
          video: params.cameraId
            ? { deviceId: { exact: params.cameraId } }
            : true,
          audio: false,
        }));
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
    const countdownPromise = runRecordingCountdown(true);
    if (localOnly) {
      await countdownPromise;
      id = localFolderName;
    } else {
      const captureTitle = await captureTitleForRecording({
        mode: params.mode,
        source: "full-screen",
      });
      console.time("[clips-recorder] createServerRecording duration");
      const recordingPromise = createServerRecording(
        params.serverUrl,
        wantsCamera,
        wantsAudio,
        captureTitle,
      ).finally(() => {
        console.timeEnd("[clips-recorder] createServerRecording duration");
      });
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
      id = createRes.id;
    }

    await audioCue.playBeforeCapture();
    const wantsSystemAudio = wantsAudio && params.systemAudioOn !== false;
    await invoke("native_fullscreen_recording_start", {
      recordingId: id,
      includeAudio: wantsAudio,
      captureSystemAudio: wantsSystemAudio,
      micDeviceId: params.micId || null,
      micDeviceLabel: params.micLabel || null,
    });
    // Capture is now live — stamp the timer baseline before any further awaits
    // so the toolbar clock and toolbar-enable line up with the real start.
    startedAt = Date.now();
    localCameraExport?.start(2_000);
  } catch (err) {
    await localCameraExport?.cancel().catch(() => {});
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
  // Pause/resume tracking. The Rust side actually stops the SCStream on
  // pause and starts a new segment on resume; on stop it concatenates
  // segments via AVFoundation. We keep the JS-side timer in sync so the
  // toolbar / pill show the right paused state and elapsed time.
  let pausedAt: number | null = null;
  let accumulatedPauseMs = 0;

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
        try {
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
          } else if (wantsAudio) {
            await saveTranscriptFailure(
              "No speech was captured during this recording. If you spoke, check Microphone input, Speech Recognition permission, and the selected mic, then retry transcription.",
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

          const viewUrl = `/r/${id}`;
          try {
            uploadResult = await invoke<NativeFullscreenUploadResult>(
              "native_fullscreen_recording_stop_and_upload",
              {
                serverUrl: params.serverUrl,
                recordingId: id,
                authToken: params.authToken ?? "",
                cookie: params.cookie ?? "",
                hasAudio: wantsAudio,
                hasCamera: wantsCamera,
              },
            );
          } catch (err) {
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

          try {
            await openExternal(
              `${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`,
            );
          } catch (err) {
            console.error("[clips-recorder] openExternal failed:", err);
          }
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
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        stateUnlistens.forEach((u) => u());
        stateUnlistens = [];
        await transcriptionCapture?.cancel().catch(() => {});
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
          await abortRecordingUpload(
            params.serverUrl,
            id,
            "Recording cancelled by user",
          );
          await trashRecording(params.serverUrl, id);
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
        })
        .catch((err) => {
          console.warn("[clips-recorder] native pause failed:", err);
        });
    }),
    listen("clips:recorder-resume", () => {
      if (pausedAt == null) return;
      invoke("native_fullscreen_recording_resume")
        .then(() => {
          if (pausedAt != null) {
            accumulatedPauseMs += Date.now() - pausedAt;
            pausedAt = null;
          }
          emitState();
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
  emit("clips:toolbar-enabled", true).catch(() => {});
  emitState();

  if (!localOnly) {
    await showRegionGuidesForRecording(true);
    const wantsSystemAudio = wantsAudio && params.systemAudioOn !== false;
    transcriptionCapture = wantsAudio
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
    } else if (wantsAudio && !transcriptionCapture) {
      void saveTranscriptFailure(
        "macOS Speech recognition could not start for this recording. Check Speech Recognition and Microphone permissions, then retry transcription.",
      );
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
  const wantsSystemAudio = wantsAudio && params.systemAudioOn !== false;
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
          const displaySurface =
            captureSource === "window" ? "window" : "monitor";
          return navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: {
                ideal: CLOUD_CAPTURE_FRAME_RATE,
                max: CLOUD_CAPTURE_FRAME_RATE,
              },
              width: { ideal: CLOUD_CAPTURE_MAX_WIDTH },
              height: { ideal: CLOUD_CAPTURE_MAX_HEIGHT },
              displaySurface,
            },
            // System/desktop audio is gated by the system-audio toggle, not mic.
            audio: wantsSystemAudio,
          });
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
      ? navigator.mediaDevices.getUserMedia({
          video: params.cameraId
            ? { deviceId: { exact: params.cameraId } }
            : true,
          audio: false,
        })
      : null;
  const audioStreamPromise: Promise<MediaStream> | null = wantsAudio
    ? navigator.mediaDevices.getUserMedia({
        audio: voiceFocusedAudioConstraints(params.micId),
        video: false,
      })
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

  // The popover owns the camera stream when we're reusing a pre-acquired
  // one — its session effect decides when to close the stream + hide the
  // bubble + stop the pump. The recorder must NOT stop those tracks on
  // stop/cancel. For camera-only mode (rare path where popover didn't
  // hand us a stream) we own it ourselves.
  const popoverOwnsCamera = bubbleCameraStream === reusedCameraStream;

  if (localRecordingMode !== "off") {
    console.log("[clips-recorder] starting local-only recording", {
      localRecordingMode,
    });
    const targets = localRecordingTargetsForMode({
      localRecordingMode,
      displayStream,
      bubbleCameraStream,
      audioStream,
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
      const chromeCmd = popoverOwnsCamera
        ? "hide_recording_chrome"
        : "hide_overlays";
      await invoke(chromeCmd).catch((err) =>
        console.error(`[clips-recorder] ${chromeCmd} failed:`, err),
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
    wantsAudio,
    captureTitle,
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
  const { id } = createRes;
  console.log(
    "[clips-recorder] countdown + createServerRecording both resolved, id=",
    id,
  );
  console.log("[clips-recorder] recording row created", { id });
  let nativeTranscriptFailureSaved = false;
  const saveTranscriptFailure = async (failureReason: string) => {
    if (!wantsAudio || nativeTranscriptFailureSaved) return;
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
  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const recorder = createCloudMediaRecorder(uploadCombined, mimeType);
  let chunkIndex = 0;
  let failed: Error | null = null;
  let backupBytes = 0;
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
  // In-flight chunk uploads. We use a Set (not an array) so entries can be
  // removed as soon as each fetch settles — otherwise, for a 30-minute
  // recording the array grows to 900 Promises, and EACH promise closes over
  // the Blob it's uploading. MediaRecorder Blobs are the raw encoded video
  // chunk — ~500KB to ~1MB each. Holding 900 of them is a ~700MB leak per
  // recording, and cumulative across recordings in a long-lived process.
  // See `uploadChunk()` — it removes its own entry in `.finally()`.
  const inflight = new Set<Promise<void>>();

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const idx = chunkIndex++;
    backupBytes += ev.data.size;
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
    p = (async () => {
      try {
        await putBrowserRecordingBackupChunk({
          recordingId: id,
          index: idx,
          blob: ev.data,
          bytes: ev.data.size,
          mimeType: chunkMimeType,
          createdAt: new Date().toISOString(),
        });
        await persistBackupMeta({
          bytes: backupBytes,
          chunkCount: Math.max(backupMeta.chunkCount, idx + 1),
          mimeType: chunkMimeType,
        });
      } catch (err) {
        console.warn("[clips-recorder] local chunk backup failed:", err);
      }
      await uploadChunk(url, ev.data);
    })()
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
  transcriptionCapture = wantsAudio
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
  } else if (wantsAudio && !transcriptionCapture) {
    void saveTranscriptFailure(
      "macOS Speech recognition could not start for this recording. Check Speech Recognition and Microphone permissions, then retry transcription.",
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
      } else if (wantsAudio) {
        await saveTranscriptFailure(
          "No speech was captured during this recording. If you spoke, check Microphone input, Speech Recognition permission, and the selected mic, then retry transcription.",
        );
      }
      await thumbnailUploadPromise;

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
        chunkCount: chunkIndex,
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
      const chromeCmd = popoverOwnsCamera
        ? "hide_recording_chrome"
        : "hide_overlays";
      await invoke(chromeCmd).catch((err) =>
        console.error(`[clips-recorder] ${chromeCmd} failed:`, err),
      );

      // Wait for any in-flight chunk uploads to settle before sending the
      // final chunk. Otherwise the server could finalize before the last
      // few bytes land. Snapshot the current set — the `.finally` in each
      // upload will have already removed settled entries from `inflight`.
      const pending = Array.from(inflight);
      await Promise.allSettled(pending);
      inflight.clear();
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
        anyFailed: !!failed,
      });
      try {
        const finalRes = await fetch(finalizeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          credentials: "include",
          body: new Blob([], { type: finalMimeType }),
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
      transcriptionCapture?.cancel().catch(() => {});
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
      // Same split as stop(): leave the bubble alone when popover owns
      // the camera — the popover's session effect handles bubble teardown.
      const chromeCmd = popoverOwnsCamera
        ? "hide_recording_chrome"
        : "hide_overlays";
      await invoke(chromeCmd).catch(() => {});
      // Tell the server to abort the partial recording (drops chunks from
      // application_state, flips the recording row to 'failed'). Fire and
      // forget with a short-circuit on failure — we don't want to keep the
      // user waiting on a network call to a dev server that may be down.
      try {
        await abortRecordingUpload(
          params.serverUrl,
          id,
          "Recording cancelled by user",
        );
        await trashRecording(params.serverUrl, id);
      } catch (err) {
        console.warn("[clips-recorder] abort failed (non-fatal):", err);
      }
      await deleteBrowserRecordingBackup(id).catch((err) => {
        console.warn("[clips-recorder] local backup cleanup failed:", err);
      });
    },
  };

  return handle;
}
