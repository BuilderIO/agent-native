/**
 * Recorder engine — non-React orchestration for screen + camera + mic capture,
 * MediaRecorder lifecycle, and chunked upload to the server.
 *
 * Designed to run in the browser. The UI wires it up in `app/routes/record.tsx`,
 * but no React state lives here — callers subscribe via `onState`, `onChunk`,
 * and `onError`.
 */
import {
  appBasePath,
  captureClientException,
  trackEvent,
} from "@agent-native/core/client";
import { waitForReadyRecordingAfterFinalizeError } from "@shared/finalize-recovery";
import {
  chunkUploadUrl,
  pickMimeType,
  pickMimeTypeCandidates,
  type UploadMode,
} from "@shared/recording-core";

import {
  createBackgroundBlurStream,
  type CameraBlurHandle,
} from "@/lib/camera-blur";
import {
  createCameraCompositeStream,
  type CameraCompositeHandle,
} from "@/lib/camera-composite";
import {
  COMPRESS_THRESHOLD_BYTES,
  COMPRESSION_ENABLED,
  MAX_UPLOAD_BYTES,
  compressBlobIfTooLarge,
  formatMb,
  type CompressionResult,
} from "@/lib/compress";

// Re-exported for existing callers; the canonical impls live in
// @shared/recording-core and are shared with the Chrome extension recorder.
export { pickMimeType, pickMimeTypeCandidates, canUseTimeslicedRecorderChunks };

export type RecordingMode = "screen" | "camera" | "screen+camera";
export type DisplaySurface = "monitor" | "window" | "browser";
export const NO_MIC_DEVICE_ID = "__clips_no_microphone__";
export const NO_CAMERA_DEVICE_ID = "__clips_no_camera__";

export function supportsBrowserTabCapture(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  if (/AgentNativeDesktop|Electron|Tauri|WKWebView|WebView/i.test(userAgent)) {
    return false;
  }
  const isChromium =
    /Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent) &&
    !/Firefox|FxiOS/i.test(userAgent);
  return isChromium;
}

export function normalizeDisplaySurfaceForRuntime(
  surface: DisplaySurface,
): DisplaySurface {
  if (surface === "browser" && !supportsBrowserTabCapture()) return "window";
  return surface;
}

type ExtendedDisplayMediaOptions = DisplayMediaStreamOptions & {
  video: MediaTrackConstraints & { displaySurface?: DisplaySurface };
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
};

export type RecorderState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "compressing"
  | "uploading"
  | "complete"
  | "error";

const RECORDING_AT_RISK_STATES = new Set<RecorderState>([
  "recording",
  "paused",
  "stopping",
  "compressing",
  "uploading",
]);

export interface RecorderEngineOptions {
  /** Server-assigned recording id. Required before `start()`. */
  recordingId: string;
  /** Capture mode. */
  mode: RecordingMode;
  /** Preferred browser picker surface when recording the screen. */
  displaySurface?: DisplaySurface;
  /** Selected mic deviceId (optional — default used when omitted). */
  micDeviceId?: string | null;
  /** Selected camera deviceId (optional — default used when omitted). */
  cameraDeviceId?: string | null;
  /** Camera bubble size selected in the pre-record UI. */
  cameraBubbleSize?: "sm" | "md" | "lg";
  /**
   * Blur the camera background (sharp person, blurred surroundings) for both the
   * live preview bubble and the baked-in recording composite. Resolved at
   * `acquire()` time. Silently no-ops (records un-blurred) if segmentation is
   * unavailable in the browser.
   */
  cameraBlur?: boolean;
  /** Background blur radius in px when `cameraBlur` is on. Defaults to ~12. */
  cameraBlurRadius?: number;
  /** Chunk size in ms (MediaRecorder timeslice). Default 2000. */
  chunkIntervalMs?: number;
  /** Base URL for the chunk upload endpoint. Default `/api/uploads/:id/chunk`. */
  uploadUrl?: string;
  /** Abort URL. Default `/api/uploads/:id/abort`. */
  abortUrl?: string;
  /**
   * Upload strategy returned by create-recording.
   * `"streaming"` — server has a resumable session; engine flushes aligned
   * chunks during recording. `"buffered"` — blob assembled after stop() and
   * uploaded in slices via the SQL chunk path.
   */
  uploadMode?: UploadMode;
  /** Fired whenever the state machine transitions. */
  onState?: (state: RecorderState, detail?: Record<string, unknown>) => void;
  /** Fired on each uploaded chunk (for progress UI). */
  onChunk?: (info: {
    index: number;
    bytes: number;
    total: number | null;
  }) => void;
  /** Fired on any error. */
  onError?: (err: Error) => void;
  /**
   * Fired with a non-fatal notice the UI should surface (e.g. a toast) without
   * stopping the recording. Used when the camera or microphone disconnects
   * mid-recording: the engine tears that input down cleanly and keeps going,
   * then reports here so the user knows the webcam/audio dropped. Unlike
   * `onError`, this does NOT transition the engine into the `error` state.
   */
  onWarning?: (message: string) => void;
  /**
   * Fired when the camera ends (unplugged / revoked) any time after acquire,
   * so the UI can drop the on-page camera bubble to match the recorded output.
   */
  onCameraEnded?: () => void;
  /**
   * Called when the display stream's video track ends because the user clicked
   * the browser's native "Stop sharing" button. When provided, the engine
   * delegates the stop flow to this callback instead of calling `stop()`
   * internally — so the UI can run its own side-effects (thumbnail capture,
   * transcription flush, navigation) before the MediaRecorder is finalized.
   */
  onDisplayTrackEnded?: () => void;
  /**
   * Fired with the *actual* capture surface the user selected in the browser's
   * native screen picker, read from the resulting display track's settings.
   * The `displaySurface` we request is only a hint, and `surfaceSwitching:
   * include` lets the user swap surfaces mid-recording — so this is the
   * authority for "is the whole screen (this tab included) being captured?".
   * Fires once right after acquisition and again on `configurationchange` when
   * the shared surface switches. Reports `null` when the browser doesn't expose
   * the resolved surface (Firefox/Safari are partial).
   */
  onResolvedDisplaySurface?: (surface: DisplaySurface | null) => void;
  /**
   * Fired with progress updates while ffmpeg.wasm is re-encoding a too-large
   * recording. Stage transitions from `loading-ffmpeg` → `preparing` →
   * `encoding` (with 0..1 progress) → `finalizing`. The engine itself
   * transitions through the `compressing` state for the duration.
   */
  onCompressionProgress?: (info: {
    stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
    progress: number | null;
  }) => void;
}

export interface RecorderStartResult {
  /** The preview stream the UI should render (composited or display). */
  previewStream: MediaStream;
  /** The camera-only stream (if applicable) for the camera bubble. */
  cameraStream: MediaStream | null;
}

export interface RecorderFinalizeResult {
  videoUrl: string | null;
  status?: string;
  waitingForStorage?: boolean;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
}

interface RecordingFinalizeMeta {
  durationMs: number;
  dimensions: { width: number; height: number };
  hasAudio: boolean;
  hasCamera: boolean;
}

interface CompressionUploadMeta {
  originalBytes?: number;
  compressedBytes?: number;
  ratio?: number;
  elapsedMs?: number;
  outputMimeType?: string;
}

const DEFAULT_CHUNK_MS = 1000;
// GCS resumable uploads require every non-final chunk to be a multiple of
// 256 KiB. MediaRecorder emits arbitrary blob sizes, so on the streaming path
// we buffer raw blobs and only PUT aligned slices. ~4 MiB per streamed chunk.
const GCS_CHUNK_ALIGN_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 15 * GCS_CHUNK_ALIGN_BYTES; // 3.75 MiB
const CHUNK_UPLOAD_MAX_ATTEMPTS = 3;
const RETRYABLE_CHUNK_UPLOAD_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);
const SCREEN_CAPTURE_FRAME_RATE = 24;
const SCREEN_CAPTURE_MAX_WIDTH = 1920;
const SCREEN_CAPTURE_MAX_HEIGHT = 1080;
// Capture quality for the browser MediaRecorder. We no longer shrink files
// client-side (ffmpeg.wasm re-encode is disabled — see COMPRESSION_ENABLED in
// `@/lib/compress`) and the upload provider streams large files directly, so we
// capture at a crisp 1080p bitrate instead of a tight budget. 1.2 Mbps left
// dense UI (fine text and code) visibly fuzzy; 8 Mbps keeps it sharp.
// Dial down here if file sizes become a concern for a deployment.
const RECORDING_VIDEO_BITRATE_BPS = 8_000_000;
const RECORDING_AUDIO_BITRATE_BPS = 128_000;
type CaptureSource = "screen" | "camera" | "microphone" | "unknown";

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

function errorName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? "";
}

// getUserMedia failed because the requested device is gone (unplugged / stale
// saved id), not a permission error — recoverable by retrying with the default.
function isDeviceUnavailableError(err: unknown): boolean {
  const name = errorName(err);
  return (
    name === "OverconstrainedError" ||
    name === "NotFoundError" ||
    name === "DevicesNotFoundError"
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || "Unknown error");
}

function makeAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

type CapturePolicyFeature = "camera" | "microphone" | "display-capture";

function isBrowserSecureContext(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext;
}

function isCaptureFeatureBlockedByPolicy(
  feature: CapturePolicyFeature,
): boolean {
  if (typeof document === "undefined") return false;
  const policy =
    (
      document as Document & {
        permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).permissionsPolicy ??
    (
      document as Document & {
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).featurePolicy;
  if (!policy?.allowsFeature) return false;
  try {
    return !policy.allowsFeature(feature);
  } catch {
    return false;
  }
}

function capturePolicyBlockMessage(source: CaptureSource): string | null {
  if (
    source === "screen" &&
    isCaptureFeatureBlockedByPolicy("display-capture")
  ) {
    return "This page is blocking screen recording via Permissions-Policy. Open Clips directly in a browser tab, or use a frame that allows screen capture.";
  }
  if (source === "camera" && isCaptureFeatureBlockedByPolicy("camera")) {
    return "This page is blocking camera access via Permissions-Policy. Open Clips directly in a browser tab, or use a frame that allows camera and microphone.";
  }
  if (
    source === "microphone" &&
    isCaptureFeatureBlockedByPolicy("microphone")
  ) {
    return "This page is blocking microphone access via Permissions-Policy. Open Clips directly in a browser tab, or use a frame that allows microphone access.";
  }
  return null;
}

function isScreenPickerDismissal(err: unknown): boolean {
  const name = errorName(err);
  const message = errorMessage(err);
  if (name === "AbortError") return true;
  if (/cancelled|canceled|dismissed/i.test(message)) return true;
  // Chromium reports a user-cancelled screen picker as NotAllowedError with
  // a "by user" / "user denied" signal in the message. A bare NotAllowedError
  // without that signal can be an enterprise-policy block or other genuine
  // denial — surface those as errors instead of silently swallowing them.
  if (
    name === "NotAllowedError" &&
    /by user|user (cancelled|canceled|denied|dismissed)/i.test(message)
  ) {
    return true;
  }
  return false;
}

function canUseTimeslicedRecorderChunks(mimeType: string): boolean {
  // WebM chunks emitted by MediaRecorder are safe to concatenate locally before
  // compression/upload. Browser MP4 chunks are not reliably self-contained; in
  // Safari/WebKit we have seen ftyp+mdat-only assemblies with no top-level moov
  // atom, so MP4/QuickTime stays as one final recorder blob after stop().
  return /^video\/webm(?:;|$)/i.test(mimeType);
}

function isRetryableChunkUploadStatus(status: number): boolean {
  return RETRYABLE_CHUNK_UPLOAD_STATUSES.has(status);
}

function trackClipUploadBlockingFailure(props: Record<string, unknown>): void {
  try {
    trackEvent("clips_upload_blocking_failure", {
      app: "clips",
      template: "clips",
      surface: "web_recorder",
      ...props,
    });
  } catch {
    // Analytics should never change recording behavior.
  }
}

function retryDelayMs(attempt: number): number {
  return attempt === 1 ? 500 : 1500;
}

function mediaRecorderOptions(
  mimeType: string,
  includeBitrateBudget: boolean,
): MediaRecorderOptions | undefined {
  const options: MediaRecorderOptions = {};
  if (mimeType) options.mimeType = mimeType;
  if (includeBitrateBudget) {
    options.videoBitsPerSecond = RECORDING_VIDEO_BITRATE_BPS;
    options.audioBitsPerSecond = RECORDING_AUDIO_BITRATE_BPS;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("Upload aborted"),
    );
  }

  return new Promise((resolve, reject) => {
    let timer: number;
    let onAbort: () => void;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onResolve = () => {
      cleanup();
      resolve();
    };
    onAbort = () => {
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Upload aborted"),
      );
    };
    timer = window.setTimeout(onResolve, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class RecorderEngine {
  readonly opts: Required<
    Pick<RecorderEngineOptions, "chunkIntervalMs" | "uploadUrl" | "abortUrl">
  > &
    RecorderEngineOptions;

  private displayStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  /**
   * Raw getUserMedia camera stream. When background blur is active,
   * `cameraStream` points at the processed (blurred) derivative and this field
   * keeps the original so teardown stops the real camera tracks and the
   * disconnect handler can observe the hardware ending.
   */
  private rawCameraStream: MediaStream | null = null;
  private cameraBlur: CameraBlurHandle | null = null;
  // True once the camera is acquired, through preview/countdown/recording, until
  // teardown — gates disconnect handling outside the recording state.
  private cameraLive = false;
  private micStream: MediaStream | null = null;
  private combinedStream: MediaStream | null = null;
  private previewStream: MediaStream | null = null;
  private cameraComposite: CameraCompositeHandle | null = null;
  private audioMixCtx: AudioContext | null = null;
  private audioMixSources: MediaStreamAudioSourceNode[] = [];
  private recorder: MediaRecorder | null = null;
  private mimeType: string = "video/webm";

  private chunkIndex = 0;
  private chunkQueue: Promise<unknown> = Promise.resolve();
  private startedAtMs: number | null = null;
  private pausedAccumMs = 0;
  private pausedStartedMs: number | null = null;
  private uploadFailure: Error | null = null;
  /**
   * Local mirror of every recorder chunk, in record order. We upload after stop
   * so the server never stores the uncompressed source before compression has a
   * chance to run.
   *
   * Memory cost: one Blob per 2s slice. A 10-min 1080p screen capture is
   * ~600 MB worst case (heavy motion); typical screen capture is much
   * smaller. The browser handles ~1 GB blob arrays without trouble.
   */
  private localChunks: Blob[] = [];
  private totalRecordedBytes = 0;
  private lastFinalizeMeta: RecordingFinalizeMeta | null = null;
  /**
   * Owns the abort signal threaded into the compression pass so a `cancel()`
   * during a multi-minute ffmpeg.wasm encode actually terminates the worker
   * (and the chunked re-upload that follows it) rather than running them to
   * completion against a recording the user already discarded.
   */
  private compressionAbort: AbortController | null = null;
  /**
   * Aborts in-flight chunk uploads (queueChunk + the non-compression finalize
   * sentinel) when cancel() runs, so a Cancel during upload doesn't let the
   * fetch quietly complete and the recording finalise server-side.
   */
  private uploadAbort: AbortController | null = null;
  private uploadMode: UploadMode = "buffered";
  /**
   * Streaming-path buffer. MediaRecorder blobs accumulate here until at least
   * STREAM_CHUNK_BYTES is available, then a 256 KiB-aligned slice is PUT to API
   * as a non-final chunk. The unaligned remainder is held and uploaded as the
   * final chunk on stop().
   */
  private pendingStreamBlobs: Blob[] = [];
  private pendingStreamBytes = 0;
  /**
   * One-shot guards so a camera/mic disconnect warning fires at most once even
   * when a device exposes multiple tracks that each emit `ended`.
   */
  private cameraDisconnectNotified = false;
  private micDisconnectNotified = false;
  /**
   * Set when a stale/unavailable `micDeviceId` forces a fallback to the system
   * default mic during `acquire()`. The recording then runs on the default
   * device, so live transcription (which can only ever use the default mic) is
   * safe to start even though a specific mic was originally requested.
   */
  private micFellBackToDefault = false;

  private state: RecorderState = "idle";

  constructor(options: RecorderEngineOptions) {
    this.opts = {
      chunkIntervalMs: options.chunkIntervalMs ?? DEFAULT_CHUNK_MS,
      uploadUrl:
        options.uploadUrl ??
        `${appBasePath()}/api/uploads/${options.recordingId}/chunk`,
      abortUrl:
        options.abortUrl ??
        `${appBasePath()}/api/uploads/${options.recordingId}/abort`,
      ...options,
    };
  }

  getState(): RecorderState {
    return this.state;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  /**
   * True when `acquire()` had to fall back from the requested `micDeviceId` to
   * the system default mic. Lets the UI start live transcription for this
   * session even though a specific mic was originally selected.
   */
  didMicFallBackToDefault(): boolean {
    return this.micFellBackToDefault;
  }

  getPreviewStream(): MediaStream | null {
    return this.previewStream;
  }

  /**
   * The composited screen+camera canvas stream that actually gets recorded
   * (screen with the camera bubble drawn in), or `null` for screen-only /
   * camera-only modes where the visible preview already matches the recording.
   * Used to grab a thumbnail that includes the presenter's camera — the raw
   * preview stream in screen+camera mode is screen-only and has no face.
   */
  getCompositeStream(): MediaStream | null {
    return this.cameraComposite?.stream ?? null;
  }

  getElapsedMs(): number {
    if (this.startedAtMs === null) return 0;
    const now = performance.now();
    const pausedNow =
      this.pausedStartedMs !== null ? now - this.pausedStartedMs : 0;
    return Math.max(0, now - this.startedAtMs - this.pausedAccumMs - pausedNow);
  }

  canDownloadBufferedRecording(): boolean {
    return this.localChunks.length > 0;
  }

  hasRecordingAtRisk(): boolean {
    return (
      this.localChunks.length > 0 ||
      this.recorder?.state === "recording" ||
      this.recorder?.state === "paused" ||
      RECORDING_AT_RISK_STATES.has(this.state)
    );
  }

  getBufferedRecordingDownload(): { blob: Blob; filename: string } | null {
    if (this.localChunks.length === 0) return null;
    const mimeType = this.mimeType || "video/webm";
    const extension = /mp4/i.test(mimeType)
      ? "mp4"
      : /quicktime|mov/i.test(mimeType)
        ? "mov"
        : "webm";
    const id =
      this.opts.recordingId && this.opts.recordingId !== "__pending__"
        ? this.opts.recordingId
        : new Date().toISOString().replace(/[:.]/g, "-");
    return {
      blob: new Blob(this.localChunks, { type: mimeType }),
      filename: `clips-recording-${id}.${extension}`,
    };
  }

  canRetryUpload(): boolean {
    return (
      this.state === "error" &&
      this.lastFinalizeMeta !== null &&
      this.localChunks.length > 0
    );
  }

  // -------------------------------------------------------------------------
  // Acquire media
  // -------------------------------------------------------------------------

  /**
   * Prompt the user for their sources (screen / camera / mic) based on mode.
   * Throws with a friendly message if the user cancels or denies a permission.
   */
  async acquire(): Promise<RecorderStartResult> {
    this.transition("pickingSources");

    const wantsDisplay =
      this.opts.mode === "screen" || this.opts.mode === "screen+camera";
    const wantsCamera =
      this.opts.mode === "camera" || this.opts.mode === "screen+camera";
    const wantsMic = this.opts.micDeviceId !== NO_MIC_DEVICE_ID;
    this.micFellBackToDefault = false;

    try {
      if (!isBrowserSecureContext()) {
        if (wantsDisplay && !wantsCamera && !wantsMic) {
          throw new Error(
            "Screen recording prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
          );
        }
        if (!wantsDisplay && wantsCamera && !wantsMic) {
          throw new Error(
            "Camera prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
          );
        }
        if (!wantsDisplay && !wantsCamera && wantsMic) {
          throw new Error(
            "Microphone prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
          );
        }
        throw new Error(
          "Camera, microphone, and screen recording prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Your browser doesn't support camera or microphone capture. Try a recent Brave, Chrome, Edge, Safari, or Firefox.",
        );
      }
      if (wantsDisplay && !navigator.mediaDevices.getDisplayMedia) {
        throw new Error(
          "Your browser doesn't support screen capture. Try a recent Brave, Chrome, Edge, Safari, or Firefox.",
        );
      }
      const policyBlock =
        (wantsDisplay && capturePolicyBlockMessage("screen")) ||
        (wantsCamera && capturePolicyBlockMessage("camera")) ||
        (wantsMic && capturePolicyBlockMessage("microphone"));
      if (policyBlock) {
        throw new Error(policyBlock);
      }

      // Start display capture synchronously before the first `await`. Brave
      // (and stricter Chromium/WebKit builds) require getDisplayMedia to be
      // directly anchored to the user's click. Camera/mic prompts do not need
      // that transient activation, and launching them in parallel with the
      // screen picker can make Chrome/macOS report a false permission failure.
      const displaySurface = normalizeDisplaySurfaceForRuntime(
        this.opts.displaySurface ?? "window",
      );
      const displayOptions: ExtendedDisplayMediaOptions = {
        video: {
          frameRate: {
            ideal: SCREEN_CAPTURE_FRAME_RATE,
            max: SCREEN_CAPTURE_FRAME_RATE,
          },
          width: { ideal: SCREEN_CAPTURE_MAX_WIDTH },
          height: { ideal: SCREEN_CAPTURE_MAX_HEIGHT },
          displaySurface,
        },
        audio: wantsMic,
        // Let "Browser tab" open the tab picker. preferCurrentTab turns it
        // into a current-tab shortcut, which makes choosing another tab harder.
        selfBrowserSurface:
          displaySurface === "browser" ? "include" : "exclude",
        surfaceSwitching: "include",
        systemAudio: wantsMic ? "include" : "exclude",
      };

      if (wantsMic || wantsDisplay) {
        this.audioMixCtx?.close().catch(() => {});
        this.audioMixCtx = new AudioContext();
      }

      if (wantsDisplay) {
        try {
          this.displayStream =
            await navigator.mediaDevices.getDisplayMedia(displayOptions);
        } catch (err) {
          throw this.friendlyError(err, "screen");
        }
      }

      if (wantsCamera) {
        try {
          this.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: this.opts.cameraDeviceId
              ? { deviceId: { exact: this.opts.cameraDeviceId } }
              : true,
            audio: false,
          });
        } catch (err) {
          // Stale/unplugged cameraDeviceId — retry with the default camera
          // instead of failing the recording.
          if (this.opts.cameraDeviceId && isDeviceUnavailableError(err)) {
            try {
              this.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
            } catch (retryErr) {
              throw this.friendlyError(retryErr, "camera");
            }
          } else {
            throw this.friendlyError(err, "camera");
          }
        }
      }

      if (wantsMic) {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: voiceFocusedAudioConstraints(this.opts.micDeviceId),
            video: false,
          });
        } catch (err) {
          // Same stale-device fallback as the camera — retry default mic.
          if (this.opts.micDeviceId && isDeviceUnavailableError(err)) {
            try {
              this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: voiceFocusedAudioConstraints(),
                video: false,
              });
              // Recording is now on the system default mic, so live
              // transcription can run for this session after all.
              this.micFellBackToDefault = true;
            } catch (retryErr) {
              throw this.friendlyError(retryErr, "microphone");
            }
          } else {
            throw this.friendlyError(err, "microphone");
          }
        }
      }

      // If the display stream's video track ends (user hit "Stop sharing" in
      // browser chrome) we want to end the recording gracefully.
      //
      // When `onDisplayTrackEnded` is provided the UI handles the stop flow
      // (thumbnail capture, transcription flush, state updates, navigation).
      // Without it we fall back to stopping the engine directly — but this
      // bypasses all UI side-effects, so always provide the callback.
      if (this.displayStream) {
        // The requested `displaySurface` is only a hint; report the surface the
        // user actually picked so the UI can hide its live camera-bubble overlay
        // only when the whole screen (this tab included) is captured. With
        // `surfaceSwitching: include` the user can swap surfaces mid-recording
        // without a re-prompt, so refresh on `configurationchange` too.
        const reportDisplaySurface = (track: MediaStreamTrack) => {
          const settings = track.getSettings() as MediaTrackSettings & {
            displaySurface?: DisplaySurface;
          };
          this.opts.onResolvedDisplaySurface?.(settings.displaySurface ?? null);
        };
        for (const track of this.displayStream.getVideoTracks()) {
          reportDisplaySurface(track);
          track.addEventListener("configurationchange", () =>
            reportDisplaySurface(track),
          );
          track.addEventListener("ended", () => {
            if (this.state === "recording" || this.state === "paused") {
              if (this.opts.onDisplayTrackEnded) {
                this.opts.onDisplayTrackEnded();
              } else {
                void this.stop();
              }
            }
          });
        }
      }

      // Camera / mic disconnects (USB webcam unplugged, permission revoked,
      // Bluetooth dropped) are NON-fatal: keep whatever inputs remain and warn.
      // The handlers gate on `cameraLive`/state so the `ended` events fired by
      // `cleanupTracks()` during a normal stop/cancel are ignored.
      if (this.cameraStream) {
        for (const track of this.cameraStream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            this.onCameraTrackEnded();
          });
        }
      }

      if (this.micStream) {
        for (const track of this.micStream.getAudioTracks()) {
          track.addEventListener("ended", () => {
            this.onMicTrackEnded();
          });
        }
      }

      // Camera is live from here through preview/countdown/recording until
      // teardown — set before the async blur setup so a disconnect during that
      // window is handled, not inherited as a dead stream.
      if (this.cameraStream) this.cameraLive = true;

      // Swap the raw camera for its blurred derivative, which both the preview
      // bubble and the recording composite read ("what you see is what's
      // recorded"). createBackgroundBlurStream never throws — it falls back to
      // the raw stream on failure.
      if (this.opts.cameraBlur && this.cameraStream) {
        this.rawCameraStream = this.cameraStream;
        const handle = await createBackgroundBlurStream(this.cameraStream, {
          blurPx: this.opts.cameraBlurRadius,
        });
        if (this.cameraDisconnectNotified) {
          // Webcam ended while the pipeline was loading: discard it and drop the
          // dead camera rather than inheriting a frozen processed stream.
          handle.cleanup();
          this.cameraStream = null;
        } else {
          this.cameraBlur = handle;
          this.cameraStream = this.cameraBlur.stream;
        }
      }

      if (this.opts.mode === "camera" && !this.cameraStream) {
        throw new Error(
          "Camera disconnected before recording could start. Reconnect it and try again.",
        );
      }

      this.previewStream =
        this.opts.mode === "camera" ? this.cameraStream! : this.displayStream!;

      return {
        previewStream: this.previewStream,
        cameraStream: this.cameraStream,
      };
    } catch (err) {
      // Release any tracks acquired before the failure so the browser's
      // screen / camera / mic indicators don't linger after the caller's
      // error handler. Without this, a screen-share that succeeded followed
      // by a camera permission denial would leave the screen capture
      // running until tab close.
      this.cleanupTracks();
      this.transition("error", { reason: String(err) });
      throw err instanceof Error ? err : this.friendlyError(err);
    }
  }

  /**
   * Attach the server-created upload target after media has been acquired.
   * Acquisition intentionally happens first so permission prompts remain
   * anchored to the user's click in Brave/Chromium.
   */
  setUploadTarget(target: {
    recordingId: string;
    uploadUrl: string;
    abortUrl: string;
    uploadMode?: UploadMode;
  }): void {
    this.opts.recordingId = target.recordingId;
    this.opts.uploadUrl = target.uploadUrl;
    this.opts.abortUrl = target.abortUrl;
    this.opts.uploadMode = target.uploadMode ?? "buffered";
  }

  // -------------------------------------------------------------------------
  // Recording lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!this.displayStream && !this.cameraStream) {
      throw new Error("Must call acquire() before start()");
    }
    this.combinedStream = this.buildCombinedStream();

    // `pickMimeType` returns "" when nothing in our candidate list is
    // supported. Don't throw in that case — the browser's MediaRecorder
    // default may still work. Construct with `mimeType: undefined` to
    // let the browser pick, then read `recorder.mimeType` (always set
    // once constructed) as the canonical type for chunk uploads. Only
    // bail if even that is empty (genuinely no supported codec). On
    // any failure here, release the media streams we already acquired
    // so the browser's screen/camera indicator doesn't linger after
    // the caller's error handler.
    try {
      if (typeof MediaRecorder === "undefined") {
        throw new Error(
          "Your browser doesn't support screen recording. Try a recent Chrome, Edge, Safari, or Firefox.",
        );
      }
      const candidates = pickMimeTypeCandidates().filter((type) => {
        try {
          return MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      });
      candidates.push("");
      let lastError: unknown = null;

      for (const type of candidates) {
        for (const includeBitrateBudget of [true, false]) {
          try {
            this.recorder = new MediaRecorder(
              this.combinedStream,
              mediaRecorderOptions(type, includeBitrateBudget),
            );
            this.mimeType = this.recorder.mimeType || type;
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            this.recorder = null;
          }
        }
        if (this.recorder) break;
      }

      if (!this.recorder && lastError) {
        throw lastError;
      }
      if (!this.mimeType) {
        throw new Error(
          "Your browser doesn't support any of the video codecs Clips needs. Try a recent Chrome, Edge, Safari, or Firefox.",
        );
      }
    } catch (err) {
      this.cleanupTracks();
      throw err;
    }

    this.chunkIndex = 0;
    this.uploadFailure = null;
    this.localChunks = [];
    this.totalRecordedBytes = 0;
    this.lastFinalizeMeta = null;
    this.uploadAbort = new AbortController();
    this.uploadMode = this.opts.uploadMode ?? "buffered";
    this.pendingStreamBlobs = [];
    this.pendingStreamBytes = 0;
    this.cameraDisconnectNotified = false;
    this.micDisconnectNotified = false;
    const useTimeslicedLocalChunks = canUseTimeslicedRecorderChunks(
      this.mimeType,
    );

    // recorder is guaranteed non-null here: if it were null after the codec
    // loop, the throw above (line ~730) would have already exited.
    const recorder = this.recorder!;
    recorder.addEventListener("dataavailable", (event) => {
      const blob = event.data;
      if (!blob || blob.size === 0) return;
      // Mirror to local buffer first. Upload waits until stop(), after we know
      // whether this recording needs compression.
      this.localChunks.push(blob);
      this.totalRecordedBytes += blob.size;
      if (this.uploadMode === "streaming") {
        this.pendingStreamBlobs.push(blob);
        this.pendingStreamBytes += blob.size;
        this.flushAlignedStreamChunks();
      }
    });

    recorder.addEventListener("stop", () => {
      // Final flush is handled by `stop()` itself.
    });

    recorder.addEventListener("error", (e) => {
      const err =
        (e as unknown as { error?: Error }).error ||
        new Error("Recorder error");
      this.emitError(err);
    });

    if (useTimeslicedLocalChunks) {
      recorder.start(this.opts.chunkIntervalMs);
    } else {
      recorder.start();
    }
    this.startedAtMs = performance.now();
    this.transition("recording");
  }

  pause(): void {
    if (!this.recorder || this.recorder.state !== "recording") return;
    try {
      this.recorder.pause();
    } catch (err) {
      this.emitError(err);
      return;
    }
    this.pausedStartedMs = performance.now();
    this.transition("paused");
  }

  resume(): void {
    if (!this.recorder || this.recorder.state !== "paused") return;
    try {
      this.recorder.resume();
    } catch (err) {
      this.emitError(err);
      return;
    }
    if (this.pausedStartedMs !== null) {
      this.pausedAccumMs += performance.now() - this.pausedStartedMs;
      this.pausedStartedMs = null;
    }
    this.transition("recording");
  }

  /**
   * Stop recording, flush the final chunk, and wait for all uploads
   * (including the isFinal=1 chunk that triggers server-side finalize).
   *
   * State-machine guarantee: every reachable code path in this method ends
   * with either `transition("complete")` (success) or `transition("error")`
   * (any throw, including from `compressAndReupload`). The engine never
   * gets stuck mid-state. The UI's spinner is wired off the engine state,
   * so a stuck "compressing" state would hang the spinner forever — see
   * `record.tsx`'s `onState` handler.
   */
  async stop(): Promise<RecorderFinalizeResult> {
    if (!this.recorder) throw new Error("Not recording");

    // Resume first if paused — some browsers don't fire dataavailable
    // from a paused MediaRecorder on stop().
    if (this.recorder.state === "paused") {
      try {
        this.recorder.resume();
      } catch {
        // ignore
      }
      if (this.pausedStartedMs !== null) {
        this.pausedAccumMs += performance.now() - this.pausedStartedMs;
        this.pausedStartedMs = null;
      }
    }

    if (this.recorder.state === "inactive") {
      // The MediaRecorder may have auto-stopped if all its tracks ended
      // (e.g. display-only mode with no mic). Different browsers dispatch
      // `dataavailable` either before or after state transitions to
      // `inactive`. Yielding one macrotask ensures any still-pending
      // `dataavailable` event runs first and is mirrored into localChunks before
      // the post-stop upload/compression path starts.
      this.transition("stopping");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } else {
      this.transition("stopping");

      // Wait for the dataavailable event triggered by recorder.stop() to
      // be picked up by the start()-time listener (which mirrors it into
      // `localChunks`). We don't push or upload the
      // final blob here — that listener is the single owner. Pushing
      // again would duplicate the final ~2s slice in `localChunks`,
      // inflating the assembled blob and corrupting the compressed
      // re-encode.
      const finalDataAvailable = new Promise<void>((resolve) => {
        let resolved = false;
        // Defer with a microtask so the start()-time listener's
        // synchronous body (push + queue upload) runs first — both
        // listeners fire on the same dataavailable event in registration
        // order, and we want our pass-through to resolve only after the
        // primary mirror has happened.
        const passthrough = () => {
          if (resolved) return;
          queueMicrotask(() => {
            if (resolved) return;
            resolved = true;
            resolve();
          });
        };
        this.recorder!.addEventListener("dataavailable", passthrough, {
          once: true,
        });
        // Safety net: if dataavailable never fires (broken recorder),
        // resolve after 10s so we don't hang forever. Normal path fires
        // within milliseconds of recorder.stop().
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          this.recorder?.removeEventListener("dataavailable", passthrough);
          resolve();
        }, 10_000);
      });

      try {
        this.recorder.stop();
      } catch (err) {
        // Hardware/recorder failure before we even started the post-stop
        // pipeline — emit, transition, and bail.
        this.cleanupTracks();
        this.localChunks = [];
        this.emitError(err);
        throw err;
      }

      await finalDataAvailable;
    }

    const dimensions = this.readDimensions();
    const durationMs = Math.round(this.getElapsedMs());
    const hasAudio = this.hasAudioTrack();
    const hasCamera = !!this.cameraStream;
    const finalizeMeta: RecordingFinalizeMeta = {
      durationMs,
      dimensions,
      hasAudio,
      hasCamera,
    };
    this.lastFinalizeMeta = finalizeMeta;

    // Drain any legacy in-flight chunk uploads before we either compress or
    // upload. New recordings upload after stop(), but keeping this guard makes
    // retry paths resilient while a release rolls out.
    await this.chunkQueue;
    if (this.uploadFailure) {
      this.cleanupTracks();
      this.transition("error", { message: this.uploadFailure.message });
      throw this.uploadFailure;
    }

    let result: Record<string, unknown> | undefined;
    let completed = false;
    try {
      if (
        COMPRESSION_ENABLED &&
        this.totalRecordedBytes > COMPRESS_THRESHOLD_BYTES &&
        this.opts.uploadMode !== "streaming"
      ) {
        // Compress before the first server upload so large recordings don't
        // stage their uncompressed source in SQL.
        result = await this.compressAndReupload(finalizeMeta);
      } else if (this.uploadMode !== "streaming") {
        this.transition("uploading", { progress: 0 });
        const assembled = new Blob(this.localChunks, { type: this.mimeType });
        result = await this.uploadBlobInSlices(
          assembled,
          this.mimeType,
          finalizeMeta,
          this.uploadAbort?.signal,
        );
      } else {
        // Streaming path: all 256 KiB-aligned chunks were queued during
        // recording. Whatever bytes remain become the
        // final chunk. If the recording happened to end exactly
        // on a boundary the remainder is empty, which the server treats as a
        // close sentinel.
        this.transition("uploading", { progress: 100 });
        const remainder = new Blob(this.pendingStreamBlobs, {
          type: this.mimeType,
        });
        this.pendingStreamBlobs = [];
        this.pendingStreamBytes = 0;
        result = await this.uploadChunk(remainder, this.chunkIndex++, {
          isFinal: true,
          total: this.chunkIndex,
          mimeType: this.mimeType,
          durationMs,
          width: dimensions.width,
          height: dimensions.height,
          hasAudio,
          hasCamera,
          signal: this.uploadAbort?.signal,
        });
      }
      this.transition("complete");
      completed = true;
    } catch (err) {
      // Reachable from compressAndReupload (compression failure, OOM,
      // reset-chunks failure, hard-cap exceeded, abort) and from the
      // isFinal sentinel upload. Ensure we never leave the engine stuck
      // mid-state — the UI spinner is wired to engine state and would
      // hang forever otherwise.
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name !== "AbortError") {
        this.rememberUploadFailure(e);
      }
      this.transition("error", { message: e.message });
      throw e;
    } finally {
      // Always release hardware resources, even if the final upload failed.
      this.cleanupTracks();
      // Keep the in-memory chunks after an upload failure so the error screen
      // can retry the upload without making the user re-record. They are
      // dropped on success or when cancel/restart runs.
      if (completed) {
        this.localChunks = [];
        this.lastFinalizeMeta = null;
      }
    }

    return this.toFinalizeResult(result, finalizeMeta);
  }

  async retryUpload(): Promise<RecorderFinalizeResult> {
    const meta = this.lastFinalizeMeta;
    if (!meta || this.localChunks.length === 0) {
      throw new Error(
        "This recording no longer has local upload data to retry.",
      );
    }

    this.uploadFailure = null;
    this.chunkIndex = 0;
    this.uploadAbort = new AbortController();

    let result: Record<string, unknown> | undefined;
    let completed = false;
    try {
      result = await this.uploadBufferedChunks(meta, this.uploadAbort.signal);
      this.transition("complete");
      completed = true;
      return this.toFinalizeResult(result, meta);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name !== "AbortError") {
        this.rememberUploadFailure(e);
      }
      this.transition("error", { message: e.message });
      throw e;
    } finally {
      if (completed) {
        this.localChunks = [];
        this.lastFinalizeMeta = null;
      }
    }
  }

  private toFinalizeResult(
    result: Record<string, unknown> | undefined,
    meta: RecordingFinalizeMeta,
  ): RecorderFinalizeResult {
    return {
      videoUrl: (result?.videoUrl as string | undefined) ?? null,
      status: result?.status as string | undefined,
      waitingForStorage:
        result?.waitingForStorage === true ||
        result?.status === "waiting_storage",
      durationMs: meta.durationMs,
      width: meta.dimensions.width,
      height: meta.dimensions.height,
      hasAudio: meta.hasAudio,
      hasCamera: meta.hasCamera,
    };
  }

  private async uploadBufferedChunks(
    meta: RecordingFinalizeMeta,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    if (
      COMPRESSION_ENABLED &&
      this.totalRecordedBytes > COMPRESS_THRESHOLD_BYTES
    ) {
      return this.compressAndReupload(meta);
    }

    await this.resetUploadedChunks(null, signal);
    this.transition("uploading", { progress: 0 });
    const assembled = new Blob(this.localChunks, { type: this.mimeType });
    return this.uploadBlobInSlices(assembled, this.mimeType, meta, signal);
  }

  private async resetUploadedChunks(
    compression: CompressionUploadMeta | null,
    signal?: AbortSignal,
  ): Promise<void> {
    const resetUrl = `${appBasePath()}/api/uploads/${
      this.opts.recordingId
    }/reset-chunks`;
    let resetRes: Response;
    try {
      resetRes = await fetch(resetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compression }),
        signal,
      });
    } catch (err) {
      // The user clicking Cancel mid-fetch makes the AbortController abort and
      // `fetch` rejects with an AbortError. Preserve that identity so the UI
      // treats it as cancellation, not as a failed upload.
      if ((err as { name?: string } | null)?.name === "AbortError") {
        throw err;
      }
      throw new Error(
        `Couldn't prepare the recording for re-upload (network error contacting reset-chunks). ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!resetRes.ok) {
      const text = await resetRes.text().catch(() => "");
      throw new Error(
        `Couldn't prepare the recording for re-upload (reset-chunks ${
          resetRes.status
        }). ${text || resetRes.statusText}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Compression path
  // -------------------------------------------------------------------------

  /**
   * Re-encode the local chunk buffer at a lower bitrate via ffmpeg.wasm and
   * upload the compressed result starting at index 0. Triggered when
   * `totalRecordedBytes > COMPRESS_THRESHOLD_BYTES` because the assembled blob
   * would otherwise blow past the server's SQL staging budget.
   *
   * Throws a clean user-facing error if the compressed blob is STILL larger
   * than `MAX_UPLOAD_BYTES`, so the UI can suggest "shorter recording / lower
   * resolution" rather than letting the upload fail with a 500.
   */
  private async compressAndReupload(
    meta: RecordingFinalizeMeta,
  ): Promise<Record<string, unknown> | undefined> {
    this.transition("compressing");

    // Owned for the lifetime of this single call so `cancel()` can abort
    // both the ffmpeg.wasm pass and the subsequent chunk uploads.
    const abort = new AbortController();
    this.compressionAbort = abort;

    try {
      const assembled = new Blob(this.localChunks, { type: this.mimeType });
      const originalBytes = assembled.size;

      let compression: CompressionResult;
      let compressionError: {
        message: string;
        stderrTail: string[];
        elapsedMs: number;
      } | null = null;
      try {
        compression = await compressBlobIfTooLarge(assembled, this.mimeType, {
          width: meta.dimensions.width,
          height: meta.dimensions.height,
          durationMs: meta.durationMs,
          signal: abort.signal,
          onProgress: (p) => {
            this.opts.onCompressionProgress?.({
              stage: p.stage,
              progress: p.progress,
            });
          },
          onError: (err) => {
            compressionError = err;
          },
        });
      } catch (err) {
        // Two failure modes reach here:
        //  1. External abort (user clicked Cancel mid-encode) — we want
        //     this to propagate so the caller bails out cleanly instead of
        //     trying to upload a stale assembly behind the user's back.
        //  2. Genuinely unexpected throw, e.g. OOM building the assembled
        //     blob. Surface as the user-facing error.
        // (compressBlobIfTooLarge normally swallows ffmpeg-internal
        // failures and returns `{ compressed: false }`, so this catch is
        // for the abort path and the truly unexpected.)
        throw err instanceof Error ? err : new Error(String(err));
      }

      const finalBlob = compression.blob;
      const compressedBytes = finalBlob.size;

      // Tell the server to wipe any chunks a previous/legacy attempt may have
      // uploaded and stash compression metadata so finalize-recording can
      // include it in any Sentry capture if the upload still fails downstream.
      //
      // A failure here is fatal — proceeding with the re-upload would
      // mix compressed slices (indices 0..N) on top of the leftover
      // un-compressed chunks at indices N+1..M, and finalize would
      // concatenate them into a corrupted blob that decodes to a
      // mid-clip glitch followed by garbage. Better a clean error than a
      // silently-broken recording.
      const compressionPayload = compression.compressed
        ? {
            originalBytes,
            compressedBytes,
            ratio: compression.ratio,
            elapsedMs: compression.elapsedMs,
            outputMimeType: compression.outputMimeType,
          }
        : null;
      await this.resetUploadedChunks(compressionPayload, abort.signal);

      if (compressionError) {
        // Compression itself failed — we still hold the original assembled
        // blob and we'll attempt to upload it as-is. The hard-cap check
        // below will reject if it's still over MAX_UPLOAD_BYTES; otherwise
        // the user's recording is small enough to squeak through.
        console.warn(
          "[recorder] compression failed, falling back to original blob",
          compressionError,
        );
      }

      if (compressedBytes > MAX_UPLOAD_BYTES) {
        // Stop before we attempt the upload. Builder.io would 500 anyway and
        // leave the user with the same opaque error this PR is meant to fix.
        const detail = compression.compressed
          ? `${formatMb(compressedBytes)} after compression`
          : `${formatMb(compressedBytes)}`;
        throw new Error(
          `Recording is too large to upload (${detail}, limit is ${formatMb(
            MAX_UPLOAD_BYTES,
          )}) after automatic compression. Try a shorter recording.`,
        );
      }

      this.transition("uploading", { progress: 0 });
      return this.uploadBlobInSlices(
        finalBlob,
        compression.outputMimeType,
        meta,
        abort.signal,
      );
    } finally {
      // Always release the controller reference even on throw — otherwise
      // a subsequent cancel() would abort a freshly-started compression.
      if (this.compressionAbort === abort) {
        this.compressionAbort = null;
      }
    }
  }

  /** Cancel: release tracks immediately, then abort server-side, reset state. */
  async cancel(): Promise<void> {
    // Release local hardware FIRST — synchronously, before any await. This
    // lets callers fire-and-forget cancel() (e.g. when navigating away) and
    // know the camera/screen capture is fully torn down by the time the
    // current task yields. The server-side abort is best-effort and must
    // not gate hardware cleanup.
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {
      // ignore
    }
    // If a compression pass is mid-flight (ffmpeg.wasm encode + chunked
    // re-upload), tear it down too. compressBlobIfTooLarge sees the abort,
    // terminates the wasm worker, and re-throws — propagating up through
    // stop() which transitions to "error". Without this, ffmpeg keeps
    // encoding for minutes against a recording the user already discarded.
    //
    // The abort reason carries `name === "AbortError"` so any consumer
    // downstream (compress.ts, the reset-chunks fetch, the chunked upload
    // loop, record.tsx's doStop catch) can identify cancellation by name
    // alone — no regex matching against the message string.
    if (this.compressionAbort) {
      const cancelErr = new Error("Recording cancelled");
      cancelErr.name = "AbortError";
      this.compressionAbort.abort(cancelErr);
      this.compressionAbort = null;
    }
    // Abort streaming-chunk uploads + the non-compression finalize sentinel.
    if (this.uploadAbort) {
      const cancelErr = new Error("Recording cancelled");
      cancelErr.name = "AbortError";
      this.uploadAbort.abort(cancelErr);
      this.uploadAbort = null;
    }
    this.cleanupTracks();
    this.chunkIndex = 0;
    this.uploadFailure = null;
    this.startedAtMs = null;
    this.pausedAccumMs = 0;
    this.pausedStartedMs = null;
    this.localChunks = [];
    this.totalRecordedBytes = 0;
    this.lastFinalizeMeta = null;
    this.transition("idle");

    if (this.opts.abortUrl) {
      try {
        await fetch(this.opts.abortUrl, { method: "POST" });
      } catch {
        // ignore — best effort
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Mix audio tracks from multiple streams into a single track via Web Audio
   * API. A single mixed track avoids the Chromium behaviour where only the
   * first audio track in a MediaStream is reliably encoded by MediaRecorder,
   * while still capturing both mic and system audio when both are present.
   *
   * Returns null when no audio tracks exist. Returns the single raw track
   * directly when only one exists (avoids unnecessary AudioContext overhead).
   */
  private buildMixedAudioTrack(
    streams: (MediaStream | null | undefined)[],
  ): MediaStreamTrack | null {
    const audioTracks = streams
      .filter((s): s is MediaStream => s != null)
      .flatMap((s) => s.getAudioTracks());
    if (audioTracks.length === 0) return null;
    if (audioTracks.length === 1) return audioTracks[0];

    const ctx = this.audioMixCtx ?? new AudioContext();
    this.audioMixCtx = ctx;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    this.audioMixSources = [];
    const dest = ctx.createMediaStreamDestination();
    for (const track of audioTracks) {
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      source.connect(dest);
      this.audioMixSources.push(source);
    }
    return dest.stream.getAudioTracks()[0];
  }

  private buildCombinedStream(): MediaStream {
    if (this.opts.mode === "screen") {
      return this.buildDisplayRecordingStream();
    }

    // Camera-only: camera video + mic.
    if (this.opts.mode === "camera") {
      const combined = new MediaStream();
      for (const t of this.cameraStream!.getVideoTracks()) combined.addTrack(t);
      const audio = this.buildMixedAudioTrack([this.micStream]);
      if (audio) combined.addTrack(audio);
      return combined;
    }

    // Camera dropped before start (disconnected during setup/countdown):
    // record screen-only rather than compositing a dead stream.
    if (!this.cameraStream) {
      return this.buildDisplayRecordingStream();
    }

    // Screen + camera: display capture does not reliably include our separate
    // DOM bubble once the user records another app/window, so the saved
    // recording must composite the camera feed before MediaRecorder sees it.
    this.cameraComposite?.cleanup();
    this.cameraComposite = createCameraCompositeStream({
      displayStream: this.displayStream!,
      cameraStream: this.cameraStream!,
      bubbleSizeRatio: this.cameraBubbleSizeRatio(),
    });
    const combined = new MediaStream();
    for (const t of this.cameraComposite.stream.getVideoTracks())
      combined.addTrack(t);
    const audio = this.buildMixedAudioTrack([
      this.micStream,
      this.displayStream,
    ]);
    if (audio) combined.addTrack(audio);
    return combined;
  }

  private buildDisplayRecordingStream(): MediaStream {
    const combined = new MediaStream();
    for (const track of this.displayStream!.getVideoTracks()) {
      combined.addTrack(track);
    }
    const audio = this.buildMixedAudioTrack([
      this.micStream,
      this.displayStream,
    ]);
    if (audio) combined.addTrack(audio);
    return combined;
  }

  private cameraBubbleSizeRatio(): number {
    switch (this.opts.cameraBubbleSize) {
      case "sm":
        return 0.17;
      case "lg":
        return 0.3;
      case "md":
      default:
        return 0.22;
    }
  }

  /**
   * Drain the streaming buffer in 256 KiB-aligned chunks.
   * GCS rejects non-final resumable chunks that are not a multiple of 256 KiB,
   * so we slice on STREAM_CHUNK_BYTES boundaries and carry the remainder. The
   * leftover is uploaded as the final chunk on stop().
   */
  private flushAlignedStreamChunks(): void {
    while (this.pendingStreamBytes >= STREAM_CHUNK_BYTES) {
      const combined = new Blob(this.pendingStreamBlobs, {
        type: this.mimeType,
      });
      const head = combined.slice(0, STREAM_CHUNK_BYTES, this.mimeType);
      const tail = combined.slice(
        STREAM_CHUNK_BYTES,
        combined.size,
        this.mimeType,
      );
      this.pendingStreamBlobs = tail.size > 0 ? [tail] : [];
      this.pendingStreamBytes = tail.size;
      const index = this.chunkIndex++;
      this.queueChunk(head, index, /* isFinal */ false);
    }
  }

  private queueChunk(blob: Blob, index: number, isFinal: boolean): void {
    this.chunkQueue = this.chunkQueue.then(async () => {
      if (this.uploadFailure) return;
      if (this.uploadAbort?.signal.aborted) return;
      try {
        await this.uploadChunk(blob, index, {
          isFinal,
          mimeType: this.mimeType,
          signal: this.uploadAbort?.signal,
        });
        this.opts.onChunk?.({
          index,
          bytes: blob.size,
          total: null,
        });
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        // User-initiated cancel — cancel() already runs the abortUrl path.
        if (failure.name === "AbortError") return;
        this.rememberUploadFailure(failure);
        this.emitError(failure);
      }
    });
  }

  private rememberUploadFailure(err: Error): void {
    if (!this.uploadFailure) {
      this.uploadFailure = err;
    }
    // Do not call abortUrl for retryable upload failures. retryUpload() reuses
    // this recording id; cancel() owns the terminal server-side abort path.
  }

  private async uploadBlobInSlices(
    blob: Blob,
    mimeType: string,
    meta: {
      durationMs: number;
      dimensions: { width: number; height: number };
      hasAudio: boolean;
      hasCamera: boolean;
    },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    // Reset the upload index for post-stop blob uploads: MP4/QuickTime never
    // streamed chunks, and the compression path has just cleared server chunks.
    this.chunkIndex = 0;

    // Keep binary uploads comfortably under Netlify's effective function
    // payload limit. This mirrors the local-file upload path in record.tsx.
    const UPLOAD_SLICE_BYTES = 3 * 1024 * 1024;
    const totalSlices = Math.max(1, Math.ceil(blob.size / UPLOAD_SLICE_BYTES));

    let lastResult: Record<string, unknown> | undefined;
    for (let i = 0; i < totalSlices; i++) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Upload aborted");
      }

      const start = i * UPLOAD_SLICE_BYTES;
      const end = Math.min(start + UPLOAD_SLICE_BYTES, blob.size);
      const slice = blob.slice(start, end, mimeType);
      const isFinal = i === totalSlices - 1;
      const index = this.chunkIndex++;

      lastResult = await this.uploadChunk(slice, index, {
        isFinal,
        total: totalSlices,
        mimeType,
        durationMs: isFinal ? meta.durationMs : undefined,
        width: isFinal ? meta.dimensions.width : undefined,
        height: isFinal ? meta.dimensions.height : undefined,
        hasAudio: isFinal ? meta.hasAudio : undefined,
        hasCamera: isFinal ? meta.hasCamera : undefined,
        signal,
      });
      this.opts.onChunk?.({
        index,
        bytes: slice.size,
        total: totalSlices,
      });
    }

    return lastResult;
  }

  private async uploadChunk(
    blob: Blob,
    index: number,
    extra: {
      isFinal?: boolean;
      total?: number;
      mimeType?: string;
      durationMs?: number;
      width?: number;
      height?: number;
      hasAudio?: boolean;
      hasCamera?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<Record<string, unknown> | undefined> {
    const url = chunkUploadUrl(this.opts.uploadUrl, {
      index,
      total: extra.total,
      isFinal: extra.isFinal,
      mimeType: extra.mimeType,
      durationMs: extra.durationMs,
      width: extra.width,
      height: extra.height,
      hasAudio: extra.hasAudio,
      hasCamera: extra.hasCamera,
    });

    const body = await blob.arrayBuffer();
    let res: Response | null = null;
    let triedFinalUploadRecovery = false;
    for (let attempt = 1; attempt <= CHUNK_UPLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type":
              blob.type || this.mimeType || "application/octet-stream",
          },
          body,
          signal: extra.signal,
        });
      } catch (err) {
        // The final chunk is safe to retry on a network error: finalize is
        // idempotent server-side (a recording already 'ready' returns its
        // existing result), so a lost response won't double-finalize.
        if (
          attempt >= CHUNK_UPLOAD_MAX_ATTEMPTS ||
          (err as { name?: string } | null)?.name === "AbortError"
        ) {
          if (
            extra.isFinal &&
            (err as { name?: string } | null)?.name !== "AbortError"
          ) {
            const recovered = await this.recoverReadyAfterFinalUploadError();
            if (recovered) return recovered;
          }
          throw err;
        }
        await waitForRetry(retryDelayMs(attempt), extra.signal);
        continue;
      }

      if (
        !res.ok &&
        attempt < CHUNK_UPLOAD_MAX_ATTEMPTS &&
        isRetryableChunkUploadStatus(res.status)
      ) {
        if (extra.isFinal && res.status === 504) {
          triedFinalUploadRecovery = true;
          await res.text().catch(() => "");
          const recovered = await this.recoverReadyAfterFinalUploadError();
          if (recovered) return recovered;
          break;
        }
        await res.text().catch(() => "");
        await waitForRetry(retryDelayMs(attempt), extra.signal);
        continue;
      }

      break;
    }

    if (!res) {
      trackClipUploadBlockingFailure({
        stage: "chunk_upload",
        failureKind: "no_response",
        recordingId: this.opts.recordingId,
        chunkIndex: index,
        isFinal: extra.isFinal === true,
        chunkBytes: blob.size,
        uploadMode: this.opts.uploadMode,
      });
      throw new Error(`Chunk ${index} upload failed: no response`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `Chunk ${index} upload failed (${res.status}): ${text || res.statusText}`,
      );
      if (
        extra.isFinal &&
        !triedFinalUploadRecovery &&
        this.isFinalUploadRecoveryCandidate(res.status, err)
      ) {
        const recovered = await this.recoverReadyAfterFinalUploadError();
        if (recovered) return recovered;
      }
      trackClipUploadBlockingFailure({
        stage: "chunk_upload",
        failureKind: "http_error",
        recordingId: this.opts.recordingId,
        chunkIndex: index,
        isFinal: extra.isFinal === true,
        httpStatus: res.status,
        statusText: res.statusText,
        chunkBytes: blob.size,
        uploadMode: this.opts.uploadMode,
        finalUploadRecoveryAttempted:
          extra.isFinal === true &&
          this.isFinalUploadRecoveryCandidate(res.status, err),
      });
      // Capture rich context to Sentry BEFORE throwing — when this hits
      // production we want enough breadcrumbs in the event to debug a
      // "Builder.io upload failed (500)" without re-running the upload.
      // Wrapped in try/catch so a Sentry failure can never mask the real
      // upload error the caller is about to see.
      try {
        const builderHeaderNames = [
          "x-request-id",
          "builder-request-id",
          "x-amz-request-id",
          "x-builder-trace-id",
        ];
        const allBuilderHeaders: Record<string, string> = {};
        for (const h of builderHeaderNames) {
          const v = res.headers.get(h);
          if (v) allBuilderHeaders[h] = v;
        }
        captureClientException(err, {
          tags: {
            uploadStep: "chunk",
            chunkIndex: String(index),
            chunkIsFinal: extra.isFinal ? "true" : "false",
            httpStatus: String(res.status),
          },
          extra: {
            url,
            status: res.status,
            statusText: res.statusText,
            responseBodyTail: text?.slice(0, 2000) ?? "",
            chunkBytes: blob.size,
            mimeType: blob.type || this.mimeType,
            total: extra.total,
            durationMs: extra.durationMs,
            requestId:
              res.headers.get("x-request-id") ||
              res.headers.get("builder-request-id") ||
              undefined,
            allBuilderHeaders,
          },
        });
      } catch {
        // Sentry must never mask the real upload error.
      }
      throw err;
    }

    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private isFinalUploadRecoveryCandidate(
    status: number,
    error: Error,
  ): boolean {
    if (status === 413) return false;
    return !/too large|exceeds.*limit|chunk too large/i.test(error.message);
  }

  private async recoverReadyAfterFinalUploadError(): Promise<Record<
    string,
    unknown
  > | null> {
    return waitForReadyRecordingAfterFinalizeError({
      uploadUrl: this.opts.uploadUrl,
      recordingId: this.opts.recordingId,
      preferAuthenticated: true,
    });
  }

  private readDimensions(): { width: number; height: number } {
    const videoTrack =
      this.combinedStream?.getVideoTracks()[0] ||
      this.previewStream?.getVideoTracks()[0] ||
      this.displayStream?.getVideoTracks()[0] ||
      this.cameraStream?.getVideoTracks()[0];
    if (!videoTrack) return { width: 0, height: 0 };
    const settings = videoTrack.getSettings();
    return {
      width: settings.width ?? 0,
      height: settings.height ?? 0,
    };
  }

  private hasAudioTrack(): boolean {
    return (
      !!this.micStream?.getAudioTracks().length ||
      !!this.displayStream?.getAudioTracks().length
    );
  }

  private cleanupTracks(): void {
    // Clear before stopping tracks so the `ended` events our own stop() fires
    // aren't mistaken for a disconnect.
    this.cameraLive = false;
    this.audioMixSources = [];
    this.audioMixCtx?.close().catch(() => {});
    this.audioMixCtx = null;
    this.cameraComposite?.cleanup();
    this.cameraComposite = null;
    // Tear down the blur pipeline (segmenter, hidden video, processed capture)
    // before stopping streams. `rawCameraStream` holds the real hardware tracks
    // when blur is active; stop those so the camera indicator clears.
    this.cameraBlur?.cleanup();
    this.cameraBlur = null;
    for (const s of [
      this.displayStream,
      this.cameraStream,
      this.rawCameraStream,
      this.micStream,
      this.combinedStream,
    ]) {
      if (!s) continue;
      for (const track of s.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
    this.displayStream = null;
    this.cameraStream = null;
    this.rawCameraStream = null;
    this.micStream = null;
    this.combinedStream = null;
    this.previewStream = null;
    this.recorder = null;
  }

  private transition(next: RecorderState, detail?: Record<string, unknown>) {
    this.state = next;
    this.opts.onState?.(next, detail);
  }

  private emitError(err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    this.opts.onError?.(e);
    this.transition("error", { message: e.message });
  }

  /**
   * Surface a non-fatal notice to the UI without leaving the `recording`/
   * `paused` state. Mirrors `emitError` but never transitions to `error`, so
   * the MediaRecorder keeps running.
   */
  private emitWarning(message: string) {
    console.warn("[recorder]", message);
    this.opts.onWarning?.(message);
  }

  /**
   * Camera video track ended mid-recording (USB webcam unplugged, OS revoked
   * the camera, etc.). Non-fatal: keep recording. In `screen+camera` mode the
   * recorded video comes from the composite canvas — its bubble draw self-hides
   * once the camera `<video>` reports zero dimensions, so we deliberately do
   * NOT call `cameraComposite.cleanup()` (that would stop the canvas capture
   * and kill the screen recording too). We just stop the dead camera tracks and
   * warn the user.
   */
  private onCameraTrackEnded() {
    if (!this.cameraLive) return;
    if (this.cameraDisconnectNotified) return;
    this.cameraDisconnectNotified = true;
    this.cameraLive = false;
    // Tear down the blur pipeline so the composite's camera <video> sees its
    // (blurred) track end and self-hides, instead of freezing on a stale frame.
    if (this.cameraBlur) {
      this.cameraBlur.cleanup();
      this.cameraBlur = null;
    }
    for (const track of [
      ...(this.rawCameraStream?.getVideoTracks() ?? []),
      ...(this.cameraStream?.getVideoTracks() ?? []),
    ]) {
      try {
        track.stop();
      } catch {
        // ignore — the track has already ended.
      }
    }
    // Drop the on-page bubble to match the recorded output (screen-only now).
    this.opts.onCameraEnded?.();
    this.emitWarning(
      "Camera disconnected — recording continues without webcam.",
    );
  }

  /**
   * Microphone track ended mid-recording (input unplugged, Bluetooth dropped,
   * permission revoked). Non-fatal: the recording keeps going, just without
   * captured mic audio from this point on.
   */
  private onMicTrackEnded() {
    if (this.state !== "recording" && this.state !== "paused") return;
    if (this.micDisconnectNotified) return;
    this.micDisconnectNotified = true;
    this.emitWarning(
      "Microphone disconnected — recording continues without audio.",
    );
  }

  private friendlyError(
    err: unknown,
    source: CaptureSource = "unknown",
  ): Error {
    const name = errorName(err);
    const message = errorMessage(err);
    const combined = `${name} ${message}`;
    const policyBlock = capturePolicyBlockMessage(source);
    if (policyBlock) return new Error(policyBlock);
    if (!isBrowserSecureContext()) {
      if (source === "screen") {
        return new Error(
          "Screen recording prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
        );
      }
      if (source === "camera") {
        return new Error(
          "Camera prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
        );
      }
      if (source === "microphone") {
        return new Error(
          "Microphone prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
        );
      }
      return new Error(
        "Camera, microphone, and screen recording prompts require HTTPS or localhost. Open Clips on a secure URL, then try again.",
      );
    }

    if (source === "screen") {
      if (isScreenPickerDismissal(err)) {
        return makeAbortError("Screen sharing was cancelled.");
      }
      if (
        /Permission denied|NotAllowedError|denied|blocked|NotReadableError|could not start video source/i.test(
          combined,
        )
      ) {
        return new Error(
          "Screen recording is blocked by the browser, macOS, or this app frame.",
        );
      }
    }

    if (source === "camera") {
      if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
        return new Error(
          "That camera is busy in another app. Close the other app or choose a different camera.",
        );
      }
      if (/Permission denied|NotAllowedError|denied|blocked/i.test(combined)) {
        return new Error(
          "Camera access is blocked by the browser, macOS, or this app frame.",
        );
      }
    }

    if (source === "microphone") {
      if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
        return new Error(
          "That microphone is busy in another app. Close the other app or choose a different input.",
        );
      }
      if (/Permission denied|NotAllowedError|denied|blocked/i.test(combined)) {
        return new Error(
          "Microphone access is blocked by the browser, macOS, or this app frame.",
        );
      }
    }

    if (/Permission denied|NotAllowedError|denied/i.test(combined)) {
      return new Error(
        "The selected capture source was blocked by the browser, macOS, or this app frame.",
      );
    }
    if (/NotFoundError|no device/i.test(combined)) {
      return new Error(
        "No camera or microphone found. Plug one in or pick a different device.",
      );
    }
    return err instanceof Error ? err : new Error(message);
  }
}
