import { trackEvent } from "@agent-native/core/client/analytics";
import { captureClientException } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import { redactBrowserDiagnosticString } from "@shared/browser-diagnostics";
import { waitForAcceptedRecordingAfterFinalizeError } from "@shared/finalize-recovery";
import {
  chooseFallbackAudioInput,
  enumerateAudioInputDevices,
  isLikelyPhoneMicLabel,
  type AudioInputFallback,
} from "@shared/media-device-selection";
import {
  SCREEN_CAPTURE_FRAME_RATE,
  screenCaptureDisplayOptions,
} from "@shared/recording-capture";
import {
  classifyUploadResponseError,
  chunkUploadUrl,
  pickMimeType,
  pickMimeTypeCandidates,
  UPLOAD_SLICE_BYTES,
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
import {
  deleteRecordingBackup,
  putRecordingBackupChunk,
  putRecordingBackupMeta,
} from "@/lib/recording-backup";
import { uploadVideoBlobThumbnail } from "@/lib/thumbnail-capture";
import { uploadChunkRequest } from "@/lib/upload-request";

import { StreamingDeliveryRecovery } from "./streaming-delivery-recovery";

export { pickMimeType, pickMimeTypeCandidates, canUseTimeslicedRecorderChunks };

export type RecordingMode = "screen" | "camera" | "screen+camera";
export type DisplaySurface = "monitor" | "window" | "browser";
export const NO_MIC_DEVICE_ID = "__clips_no_microphone__";
export const NO_CAMERA_DEVICE_ID = "__clips_no_camera__";

const CAMERA_CAPTURE_ENDED_MESSAGE =
  "Camera disconnected before recording could start. Reconnect it and try again.";

export class CameraCaptureEndedError extends Error {
  constructor() {
    super(CAMERA_CAPTURE_ENDED_MESSAGE);
    this.name = "CameraCaptureEndedError";
  }
}

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
  recordingId: string;
  mode: RecordingMode;
  displaySurface?: DisplaySurface;
  micDeviceId?: string | null;
  micDeviceLabel?: string | null;
  cameraDeviceId?: string | null;
  cameraBubbleSize?: "sm" | "md" | "lg";
  cameraBlur?: boolean;
  cameraBlurRadius?: number;
  chunkIntervalMs?: number;
  uploadUrl?: string;
  abortUrl?: string;
  resetUrl?: string;
  uploadMode?: UploadMode;
  onState?: (state: RecorderState, detail?: Record<string, unknown>) => void;
  onChunk?: (info: {
    index: number;
    bytes: number;
    total: number | null;
  }) => void;
  onError?: (err: Error) => void;
  onWarning?: (message: string) => void;
  onCameraEnded?: () => void;
  onDisplayTrackEnded?: () => void;
  onResolvedDisplaySurface?: (surface: DisplaySurface | null) => void;
  onCompressionProgress?: (info: {
    stage: "loading-ffmpeg" | "preparing" | "encoding" | "finalizing";
    progress: number | null;
  }) => void;
}

export interface RecorderStartResult {
  previewStream: MediaStream;
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
const GCS_CHUNK_ALIGN_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 15 * GCS_CHUNK_ALIGN_BYTES;
const CHUNK_UPLOAD_MAX_ATTEMPTS = 3;
const CHUNK_UPLOAD_TIMEOUT_MS = 60_000;
const FINAL_CHUNK_UPLOAD_TIMEOUT_MS = 180_000;
const RETRYABLE_CHUNK_UPLOAD_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);
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

function isDeviceUnavailableError(err: unknown): boolean {
  const name = errorName(err);
  return (
    name === "OverconstrainedError" ||
    name === "NotFoundError" ||
    name === "DevicesNotFoundError"
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err || "Unknown error";
  try {
    return JSON.stringify(err) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function micLabelDiagnostic(label: string | null | undefined): string {
  const value = label?.trim();
  if (!value) return "empty";
  if (isLikelyPhoneMicLabel(value)) return "phone-like";
  if (/\b(?:macbook|built[- ]?in|internal microphone)\b/i.test(value)) {
    return "built-in";
  }
  return "redacted";
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
  if (
    name === "NotAllowedError" &&
    /by user|user (cancelled|canceled|denied|dismissed)/i.test(message)
  ) {
    return true;
  }
  return false;
}

function canUseTimeslicedRecorderChunks(mimeType: string): boolean {
  return /^video\/webm(?:;|$)/i.test(mimeType);
}

function isRetryableChunkUploadStatus(status: number): boolean {
  return RETRYABLE_CHUNK_UPLOAD_STATUSES.has(status);
}

function trackClipUploadBlockingFailure(props: Record<string, unknown>): void {
  const recordingId =
    typeof props.recordingId === "string" ? props.recordingId : undefined;
  const uploadAttemptId =
    typeof props.uploadAttemptId === "string"
      ? props.uploadAttemptId
      : undefined;
  try {
    trackEvent("clips_upload_blocking_failure", {
      ...props,
      app: "clips",
      template: "clips",
      surface: "web_recorder",
      output_id: recordingId,
      output_type: "clip",
      recording_id: recordingId,
      recording_attempt_id: recordingId,
      ...(uploadAttemptId ? { upload_attempt_id: uploadAttemptId } : {}),
      failure_code:
        typeof props.failureKind === "string"
          ? props.failureKind
          : "upload_failed",
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

function timeoutError(message: string): Error {
  const err = new Error(message);
  err.name = "TimeoutError";
  return err;
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function fetchSignalWithTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort(
      timeoutError(`Upload request timed out after ${timeoutMs / 1000}s`),
    );
  }, timeoutMs);
  let onAbort: (() => void) | null = null;
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason ?? abortError("Upload aborted"));
    } else {
      onAbort = () => {
        controller.abort(parent.reason ?? abortError("Upload aborted"));
      };
      parent.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      if (onAbort) parent?.removeEventListener("abort", onAbort);
    },
  };
}

function fetchAbortError(signal: AbortSignal, err: unknown): Error {
  if (signal.aborted && signal.reason instanceof Error) return signal.reason;
  return err instanceof Error ? err : new Error(errorMessage(err));
}

export class RecorderEngine {
  readonly opts: Required<
    Pick<
      RecorderEngineOptions,
      "chunkIntervalMs" | "uploadUrl" | "abortUrl" | "resetUrl"
    >
  > &
    RecorderEngineOptions;

  private displayStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private rawCameraStream: MediaStream | null = null;
  private cameraBlur: CameraBlurHandle | null = null;
  private cameraLive = false;
  private recordedCameraVideo = false;
  private micStream: MediaStream | null = null;
  private combinedStream: MediaStream | null = null;
  private previewStream: MediaStream | null = null;
  private cameraComposite: CameraCompositeHandle | null = null;
  private audioMixCtx: AudioContext | null = null;
  private audioMixSources: MediaStreamAudioSourceNode[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockGeneration = 0;
  private wakeLockRetake: (() => void) | null = null;
  private recorder: MediaRecorder | null = null;
  private stopPromise: Promise<RecorderFinalizeResult> | null = null;
  private mimeType: string = "video/webm";

  private chunkIndex = 0;
  private chunkQueue: Promise<unknown> = Promise.resolve();
  private startedAtMs: number | null = null;
  private pausedAccumMs = 0;
  private pausedStartedMs: number | null = null;
  private uploadFailure: Error | null = null;
  private uploadFailureStopStarted = false;
  private localChunks: Blob[] = [];
  private totalRecordedBytes = 0;
  private lastFinalizeMeta: RecordingFinalizeMeta | null = null;
  private backupChunkIndex = 0;
  private backupMirrorQueue: Promise<void> = Promise.resolve();
  private compressionAbort: AbortController | null = null;
  private uploadAbort: AbortController | null = null;
  private uploadMode: UploadMode = "buffered";
  private uploadAttemptId: string | null = null;
  private uploadGenerationId: string | null = null;
  private pendingStreamBlobs: Blob[] = [];
  private pendingStreamBytes = 0;
  private streamingUploadGeneration = 0;
  private streamingRecoveryGeneration = 0;
  private localChunkRevision = 0;
  private readonly streamingRecovery = new StreamingDeliveryRecovery({
    canRecover: () =>
      this.uploadMode === "streaming" &&
      this.recorder?.state === "recording" &&
      this.state === "recording",
    recover: (restartRequired) =>
      this.recoverStreamingDelivery(
        restartRequired,
        this.streamingRecoveryGeneration,
      ),
    onPermanentFailure: (error) => this.failStreamingDelivery(error),
    onSettled: () => {
      if (this.uploadMode === "streaming") this.flushAlignedStreamChunks();
    },
  });
  private cameraDisconnectNotified = false;
  private micDisconnectNotified = false;
  private micFellBackToDefault = false;
  private micUsesSystemDefault = false;

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
      resetUrl:
        options.resetUrl ??
        (options.uploadUrl
          ? options.uploadUrl.replace(/\/chunk(?:\?.*)?$/, "/reset-chunks")
          : `${appBasePath()}/api/uploads/${options.recordingId}/reset-chunks`),
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
    return this.hasLiveCameraVideo() ? this.cameraStream : null;
  }

  getMicrophoneTrack(): MediaStreamTrack | null {
    return (
      this.micStream
        ?.getAudioTracks()
        .find((track) => track.readyState !== "ended") ?? null
    );
  }

  didMicFallBackToDefault(): boolean {
    return this.micFellBackToDefault;
  }

  didMicUseSystemDefault(): boolean {
    return this.micUsesSystemDefault;
  }

  private reportMicFallback(
    mechanism: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    console.warn("[recorder]", message, extra);
    try {
      trackEvent("clips_mic_device_fallback", {
        app: "clips",
        template: "clips",
        surface: "web_recorder",
        mechanism,
        ...extra,
      });
    } catch {
      // Analytics should never change recording behavior.
    }
    captureClientException(new Error(message), {
      tags: { surface: "web_recorder", mechanism },
      extra,
    });
  }

  private async chooseExplicitMicFallback(
    avoidDeviceIds: Array<string | null | undefined> = [],
  ): Promise<AudioInputFallback | null> {
    try {
      return chooseFallbackAudioInput(await enumerateAudioInputDevices(), {
        savedLabel: this.opts.micDeviceLabel,
        avoidDeviceIds,
      });
    } catch (err) {
      this.reportMicFallback(
        "mic-fallback-enumeration-failed",
        "Could not enumerate microphones for fallback.",
        {
          error: errorMessage(err),
          requestedDeviceId: this.opts.micDeviceId ?? null,
          requestedDeviceLabel: micLabelDiagnostic(this.opts.micDeviceLabel),
        },
      );
      return null;
    }
  }

  private async tryExplicitMicFallback(
    mechanism: string,
    avoidDeviceIds: Array<string | null | undefined> = [],
  ): Promise<MediaStream | null> {
    const fallback = await this.chooseExplicitMicFallback(avoidDeviceIds);
    if (!fallback) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: voiceFocusedAudioConstraints(fallback.deviceId),
        video: false,
      });
      this.reportMicFallback(
        mechanism,
        "Using an explicit fallback microphone instead of the system default.",
        {
          requestedDeviceId: this.opts.micDeviceId ?? null,
          requestedDeviceLabel: micLabelDiagnostic(this.opts.micDeviceLabel),
          fallbackDeviceId: fallback.deviceId,
          fallbackDeviceLabel: micLabelDiagnostic(fallback.label),
          fallbackReason: fallback.reason,
        },
      );
      this.opts.onWarning?.(
        fallback.reason === "saved-label"
          ? "Selected microphone was reconnected under a new device id."
          : "Selected microphone was unavailable; using another available microphone.",
      );
      return stream;
    } catch (err) {
      if (!isDeviceUnavailableError(err)) throw err;
      this.reportMicFallback(
        "mic-explicit-fallback-failed",
        "Explicit microphone fallback was unavailable.",
        {
          requestedDeviceId: this.opts.micDeviceId ?? null,
          requestedDeviceLabel: micLabelDiagnostic(this.opts.micDeviceLabel),
          fallbackDeviceId: fallback.deviceId,
          fallbackDeviceLabel: micLabelDiagnostic(fallback.label),
          fallbackReason: fallback.reason,
          error: errorMessage(err),
        },
      );
      return null;
    }
  }

  private async replaceUnsafeMicCaptureIfPossible(
    stream: MediaStream,
    requestedDeviceId: string | null | undefined,
  ): Promise<MediaStream> {
    const track = stream.getAudioTracks()[0];
    if (!track) return stream;
    const settings = track.getSettings?.();
    const actualDeviceId = settings?.deviceId ?? "";
    const mismatched =
      !!requestedDeviceId &&
      !!actualDeviceId &&
      actualDeviceId !== requestedDeviceId;
    const phoneLike = isLikelyPhoneMicLabel(track.label);
    if (!mismatched && !phoneLike) return stream;

    const replacement = await this.tryExplicitMicFallback(
      phoneLike ? "mic-phone-capture-correction" : "mic-device-mismatch",
      [requestedDeviceId, actualDeviceId],
    );
    if (!replacement) return stream;
    for (const oldTrack of stream.getTracks()) oldTrack.stop();
    this.micFellBackToDefault = false;
    this.micUsesSystemDefault = false;
    return replacement;
  }

  private async getDefaultMicStreamWithFallback(
    originalError: unknown,
  ): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: voiceFocusedAudioConstraints(),
        video: false,
      });
      this.micFellBackToDefault = !!this.opts.micDeviceId;
      this.micUsesSystemDefault = true;
      this.reportMicFallback(
        "mic-system-default-fallback",
        "Using the system default microphone after explicit fallback was unavailable.",
        {
          requestedDeviceId: this.opts.micDeviceId ?? null,
          requestedDeviceLabel: micLabelDiagnostic(this.opts.micDeviceLabel),
          error: errorMessage(originalError),
        },
      );
      this.opts.onWarning?.(
        "Selected microphone was unavailable; using the system default microphone.",
      );
      return this.replaceUnsafeMicCaptureIfPossible(stream, null);
    } catch (fallbackErr) {
      if (!isDeviceUnavailableError(fallbackErr)) throw fallbackErr;
      this.reportMicFallback(
        "mic-basic-audio-fallback",
        "Voice-focused microphone constraints failed; retrying basic audio.",
        {
          requestedDeviceId: this.opts.micDeviceId ?? null,
          requestedDeviceLabel: micLabelDiagnostic(this.opts.micDeviceLabel),
          error: errorMessage(fallbackErr),
        },
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      this.micFellBackToDefault = !!this.opts.micDeviceId;
      this.micUsesSystemDefault = true;
      return this.replaceUnsafeMicCaptureIfPossible(stream, null);
    }
  }

  getPreviewStream(): MediaStream | null {
    return this.previewStream;
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

  getUploadAbortFence(): {
    attemptId?: string;
    uploadGenerationId?: string;
  } {
    return {
      ...(this.uploadAttemptId ? { attemptId: this.uploadAttemptId } : {}),
      ...(this.uploadGenerationId
        ? { uploadGenerationId: this.uploadGenerationId }
        : {}),
    };
  }


  async acquire(): Promise<RecorderStartResult> {
    this.transition("pickingSources");

    const wantsDisplay =
      this.opts.mode === "screen" || this.opts.mode === "screen+camera";
    const wantsCamera =
      this.opts.mode === "camera" || this.opts.mode === "screen+camera";
    const wantsMic = this.opts.micDeviceId !== NO_MIC_DEVICE_ID;
    this.cameraDisconnectNotified = false;
    this.recordedCameraVideo = false;
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

      const displaySurface = normalizeDisplaySurfaceForRuntime(
        this.opts.displaySurface ?? "window",
      );
      const displayOptions: ExtendedDisplayMediaOptions =
        screenCaptureDisplayOptions(displaySurface, wantsMic);

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
        void this.acquireWakeLock();
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

        if (!this.hasLiveCameraVideo()) {
          this.handleCameraUnavailableBeforeStart();
        } else {
          this.cameraLive = true;
          this.observeCameraTracks(this.cameraStream!);
        }
      }

      if (wantsMic) {
        try {
          const requestedId = this.opts.micDeviceId?.trim() || "";
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: voiceFocusedAudioConstraints(requestedId),
            video: false,
          });
          this.micUsesSystemDefault = !requestedId;
          this.micStream = await this.replaceUnsafeMicCaptureIfPossible(
            stream,
            requestedId,
          );
        } catch (err) {
          if (this.opts.micDeviceId && isDeviceUnavailableError(err)) {
            const explicitFallback = await this.tryExplicitMicFallback(
              "mic-stale-device-fallback",
              [this.opts.micDeviceId],
            );
            if (explicitFallback) {
              this.micUsesSystemDefault = false;
              this.micStream = explicitFallback;
            } else {
              try {
                this.micStream =
                  await this.getDefaultMicStreamWithFallback(err);
              } catch (retryErr) {
                throw this.friendlyError(retryErr, "microphone");
              }
            }
          } else if (!this.opts.micDeviceId && isDeviceUnavailableError(err)) {
            try {
              this.micStream = await this.getDefaultMicStreamWithFallback(err);
            } catch (retryErr) {
              throw this.friendlyError(retryErr, "microphone");
            }
          } else {
            throw this.friendlyError(err, "microphone");
          }
        }
      }

      if (this.displayStream) {
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
              if (this.state === "paused") {
                this.emitWarning(
                  "Screen sharing ended while the recording was paused; saving what was captured so far.",
                );
              }
              if (this.opts.onDisplayTrackEnded) {
                this.opts.onDisplayTrackEnded();
              } else {
                void this.stop();
              }
            }
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

      if (this.opts.cameraBlur && this.cameraStream) {
        this.rawCameraStream = this.cameraStream;
        const handle = await createBackgroundBlurStream(this.cameraStream, {
          blurPx: this.opts.cameraBlurRadius,
        });
        if (this.cameraDisconnectNotified) {
          handle.cleanup();
          this.cameraStream = null;
        } else {
          this.cameraBlur = handle;
          this.cameraStream = this.cameraBlur.stream;
          if (this.cameraStream !== this.rawCameraStream) {
            this.observeCameraTracks(this.cameraStream);
          }
        }
      }

      if (wantsCamera && !this.hasLiveCameraVideo()) {
        this.handleCameraUnavailableBeforeStart();
      }

      this.previewStream =
        this.opts.mode === "camera" ? this.cameraStream! : this.displayStream!;

      return {
        previewStream: this.previewStream,
        cameraStream: this.getCameraStream(),
      };
    } catch (err) {
      // by a camera permission denial would leave the screen capture
      this.cleanupTracks();
      this.transition("error", { reason: errorMessage(err) });
      throw err instanceof Error ? err : this.friendlyError(err);
    }
  }

  setUploadTarget(target: {
    recordingId: string;
    uploadUrl: string;
    abortUrl: string;
    resetUrl?: string;
    uploadMode?: UploadMode;
  }): void {
    this.opts.recordingId = target.recordingId;
    this.opts.uploadUrl = target.uploadUrl;
    this.opts.abortUrl = target.abortUrl;
    this.opts.resetUrl =
      target.resetUrl ??
      (target.uploadUrl.endsWith("/chunk")
        ? target.uploadUrl.slice(0, -"/chunk".length) + "/reset-chunks"
        : `${appBasePath()}/api/uploads/${target.recordingId}/reset-chunks`);
    this.opts.uploadMode = target.uploadMode ?? "buffered";
    this.uploadAttemptId = null;
    this.uploadGenerationId = null;
  }


  async start(): Promise<void> {
    this.streamingRecoveryGeneration += 1;
    this.streamingUploadGeneration += 1;
    if (this.opts.mode === "camera" && !this.hasLiveCameraVideo()) {
      this.cleanupTracks();
      throw new CameraCaptureEndedError();
    }
    if (
      this.opts.mode === "screen+camera" &&
      (this.cameraStream || this.rawCameraStream) &&
      !this.hasLiveCameraVideo()
    ) {
      this.handleCameraUnavailableBeforeStart();
    }
    if (!this.displayStream && !this.cameraStream) {
      throw new Error("Must call acquire() before start()");
    }
    this.combinedStream = this.buildCombinedStream();
    this.stopPromise = null;
    this.recordedCameraVideo = false;

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
    this.uploadFailureStopStarted = false;
    this.localChunks = [];
    this.totalRecordedBytes = 0;
    this.lastFinalizeMeta = null;
    this.backupChunkIndex = 0;
    this.uploadAbort = new AbortController();
    this.uploadMode = this.opts.uploadMode ?? "buffered";
    this.uploadAttemptId = null;
    this.uploadGenerationId = null;
    this.pendingStreamBlobs = [];
    this.pendingStreamBytes = 0;
    this.streamingRecovery.reset();
    this.localChunkRevision = 0;
    this.micDisconnectNotified = false;
    const useTimeslicedLocalChunks = canUseTimeslicedRecorderChunks(
      this.mimeType,
    );

    const recorder = this.recorder!;
    recorder.addEventListener("dataavailable", (event) => {
      const blob = event.data;
      if (!blob || blob.size === 0) return;
      this.localChunks.push(blob);
      this.totalRecordedBytes += blob.size;
      this.localChunkRevision += 1;
      this.mirrorChunkToBackup(blob);
      if (
        this.uploadMode === "streaming" &&
        !this.streamingRecovery.isPaused &&
        !this.streamingRecovery.isActive
      ) {
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

    if (this.opts.mode === "camera" && !this.hasLiveCameraVideo()) {
      this.cleanupTracks();
      throw new CameraCaptureEndedError();
    }
    const startsWithCameraVideo = this.hasLiveCameraVideo();
    if (useTimeslicedLocalChunks) {
      recorder.start(this.opts.chunkIntervalMs);
    } else {
      recorder.start();
    }
    this.recordedCameraVideo = startsWithCameraVideo;
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

  stop(): Promise<RecorderFinalizeResult> {
    if (this.stopPromise) return this.stopPromise;
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error("Not recording"));
    this.stopPromise = this.stopOnce(recorder);
    return this.stopPromise;
  }

  private async stopOnce(
    recorder: MediaRecorder,
  ): Promise<RecorderFinalizeResult> {
    if (recorder.state === "paused") {
      try {
        recorder.resume();
      } catch {
        // ignore
      }
      if (this.pausedStartedMs !== null) {
        this.pausedAccumMs += performance.now() - this.pausedStartedMs;
        this.pausedStartedMs = null;
      }
    }

    let backupCaptureComplete = recorder.state === "inactive";
    if (recorder.state === "inactive") {
      this.transition("stopping");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } else {
      this.transition("stopping");

      const finalDataAvailable = new Promise<boolean>((resolve) => {
        let resolved = false;
        const passthrough = () => {
          if (resolved) return;
          queueMicrotask(() => {
            if (resolved) return;
            resolved = true;
            resolve(true);
          });
        };
        recorder.addEventListener("dataavailable", passthrough, {
          once: true,
        });
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          recorder.removeEventListener("dataavailable", passthrough);
          resolve(false);
        }, 10_000);
      });

      try {
        recorder.stop();
      } catch (err) {
        this.cleanupTracks();
        this.localChunks = [];
        this.emitError(err);
        throw err;
      }

      backupCaptureComplete = await finalDataAvailable;
    }

    const dimensions = this.readDimensions();
    const durationMs = Math.round(this.getElapsedMs());
    const hasAudio = this.hasAudioTrack();
    const hasCamera = this.recordedCameraVideo;
    const finalizeMeta: RecordingFinalizeMeta = {
      durationMs,
      dimensions,
      hasAudio,
      hasCamera,
    };
    this.lastFinalizeMeta = finalizeMeta;
    if (backupCaptureComplete) {
      this.markRecordingBackupComplete(finalizeMeta);
    }

    this.cameraLive = false;
    this.audioMixSources = [];
    this.audioMixCtx?.close().catch(() => {});
    this.audioMixCtx = null;
    for (const s of [this.cameraStream, this.rawCameraStream, this.micStream]) {
      s?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    }

    let result: Record<string, unknown> | undefined;
    try {
      if (
        this.uploadMode === "streaming" &&
        this.streamingRecovery.isBrowserOffline()
      ) {
        this.streamingRecovery.clear();
        this.uploadAbort?.abort();
        throw new Error(
          "You're offline. Connect to the internet, then try uploading your recording again.",
        );
      }
      await this.streamingRecovery.drainForStop();
      await this.chunkQueue;
      await this.streamingRecovery.drainForStop();
      await this.chunkQueue;
      if (this.uploadFailure) throw this.uploadFailure;
      if (
        COMPRESSION_ENABLED &&
        this.totalRecordedBytes > COMPRESS_THRESHOLD_BYTES &&
        this.uploadMode !== "streaming"
      ) {
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
        this.transition("uploading", { progress: 100 });
        const remainder = new Blob(this.pendingStreamBlobs, {
          type: this.mimeType,
        });
        void this.uploadThumbnailForBlob(
          new Blob(this.localChunks, { type: this.mimeType }),
          this.uploadAbort?.signal,
        );
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
    } catch (err) {
      const e = err instanceof Error ? err : new Error(errorMessage(err));
      if (e.name !== "AbortError") {
        this.rememberUploadFailure(e);
      }
      this.transition("error", { message: e.message });
      throw e;
    } finally {
      this.cleanupTracks();
      this.clearRecordingDataIfReady(result);
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
    this.uploadAbort?.abort(makeAbortError("Upload retry started."));
    this.streamingRecoveryGeneration += 1;
    this.streamingRecovery.reset();
    this.streamingUploadGeneration += 1;
    this.chunkIndex = 0;
    this.uploadAbort = new AbortController();

    let result: Record<string, unknown> | undefined;
    try {
      result = await this.uploadBufferedChunks(meta, this.uploadAbort.signal);
      this.transition("complete");
      return this.toFinalizeResult(result, meta);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(errorMessage(err));
      if (e.name !== "AbortError") {
        this.rememberUploadFailure(e);
      }
      this.transition("error", { message: e.message });
      throw e;
    } finally {
      this.clearRecordingDataIfReady(result);
    }
  }

  private clearRecordingDataIfReady(
    result: Record<string, unknown> | undefined,
  ): void {
    if (result?.status !== "ready") return;
    this.localChunks = [];
    this.lastFinalizeMeta = null;
    this.clearRecordingBackup();
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

    const uploadMode = await this.resetUploadedChunks(null, signal);
    this.transition("uploading", { progress: 0 });
    const assembled = new Blob(this.localChunks, { type: this.mimeType });
    return uploadMode === "streaming"
      ? this.uploadBlobInStreamingChunks(assembled, this.mimeType, meta, signal)
      : this.uploadBlobInSlices(assembled, this.mimeType, meta, signal);
  }

  private async resetUploadedChunks(
    compression: CompressionUploadMeta | null,
    signal?: AbortSignal,
  ): Promise<UploadMode> {
    const resetUrl = this.opts.resetUrl;
    const uploadMimeType = compression?.outputMimeType || this.mimeType;
    let resetRes: Response;
    try {
      resetRes = await fetch(resetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compression,
          requestStreaming: this.uploadMode === "streaming",
          mimeType: uploadMimeType,
          useGenerationFence: true,
          ...(this.uploadAttemptId ? { attemptId: this.uploadAttemptId } : {}),
          ...(this.uploadGenerationId
            ? { uploadGenerationId: this.uploadGenerationId }
            : {}),
        }),
        signal,
      });
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") {
        throw err;
      }
      throw Object.assign(
        new Error(
          `Couldn't prepare the recording for re-upload (network error contacting reset-chunks). ${errorMessage(
            err,
          )}`,
        ),
        { transport: true },
      );
    }
    const resetText = await resetRes.text();
    const resetError = classifyUploadResponseError({
      contentType: resetRes.headers.get("content-type"),
      body: resetText,
      status: resetRes.status,
      stage: "reset_chunks",
    });
    if (!resetRes.ok || resetError.isHtml) {
      let responseDetails: Record<string, unknown> = {};
      if (!resetError.isHtml) {
        try {
          responseDetails = JSON.parse(resetError.responseText ?? "") as Record<
            string,
            unknown
          >;
        } catch {
          // coercion-ok: preserve the HTTP failure when optional error details are malformed.
          // Reset errors remain HTTP failures when the body is not JSON.
        }
      }
      const failureCode =
        responseDetails.failureCode === "multipart_start_failed"
          ? "multipart_start_failed"
          : resetError.failureCode;
      const failureStage =
        responseDetails.failureStage === "multipart_start"
          ? "multipart_start"
          : resetError.failureStage;
      const message = resetError.isHtml
        ? `Reset-chunks returned an HTML error response (${resetRes.status}).`
        : typeof responseDetails.error === "string"
          ? responseDetails.error
          : `Couldn't prepare the recording for re-upload (reset-chunks ${resetRes.status}). ${resetError.responseText || resetRes.statusText}`;
      throw Object.assign(new Error(message), {
        status: resetError.status,
        failureCode,
        failureStage,
      });
    }
    let reset: {
      uploadMode?: unknown;
      uploadGenerationId?: unknown;
    } | null = null;
    try {
      reset = JSON.parse(resetText) as {
        uploadMode?: unknown;
        uploadGenerationId?: unknown;
      };
    } catch {
      throw new Error(
        "Couldn't prepare the recording for re-upload (reset-chunks returned no upload mode).",
      );
    }
    if (reset?.uploadMode !== "streaming" && reset?.uploadMode !== "buffered") {
      throw new Error(
        "Couldn't prepare the recording for re-upload (reset-chunks returned no upload mode).",
      );
    }
    const uploadMode = reset.uploadMode;
    this.uploadMode = uploadMode;
    this.uploadGenerationId =
      typeof reset.uploadGenerationId === "string" &&
      reset.uploadGenerationId.length > 0
        ? reset.uploadGenerationId
        : null;
    return uploadMode;
  }


  private async compressAndReupload(
    meta: RecordingFinalizeMeta,
  ): Promise<Record<string, unknown> | undefined> {
    this.transition("compressing");

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
        throw err instanceof Error ? err : new Error(errorMessage(err));
      }

      const finalBlob = compression.blob;
      const compressedBytes = finalBlob.size;

      const compressionPayload = compression.compressed
        ? {
            originalBytes,
            compressedBytes,
            ratio: compression.ratio,
            elapsedMs: compression.elapsedMs,
            outputMimeType: compression.outputMimeType,
          }
        : null;
      const uploadMode = await this.resetUploadedChunks(
        compressionPayload,
        abort.signal,
      );

      if (compressionError) {
        console.warn(
          "[recorder] compression failed, falling back to original blob",
          compressionError,
        );
      }

      if (compressedBytes > MAX_UPLOAD_BYTES) {
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
      return uploadMode === "streaming"
        ? this.uploadBlobInStreamingChunks(
            finalBlob,
            compression.outputMimeType,
            meta,
            abort.signal,
          )
        : this.uploadBlobInSlices(
            finalBlob,
            compression.outputMimeType,
            meta,
            abort.signal,
          );
    } finally {
      if (this.compressionAbort === abort) {
        this.compressionAbort = null;
      }
    }
  }

  async cancel(failureCode = "unknown"): Promise<void> {
    this.streamingRecoveryGeneration += 1;
    this.streamingRecovery.reset();
    this.streamingUploadGeneration += 1;
    this.pendingStreamBlobs = [];
    this.pendingStreamBytes = 0;
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {
      // ignore
    }
    if (this.compressionAbort) {
      const cancelErr = new Error("Recording cancelled");
      cancelErr.name = "AbortError";
      this.compressionAbort.abort(cancelErr);
      this.compressionAbort = null;
    }
    if (this.uploadAbort) {
      const cancelErr = new Error("Recording cancelled");
      cancelErr.name = "AbortError";
      this.uploadAbort.abort(cancelErr);
      this.uploadAbort = null;
    }
    this.cleanupTracks();
    const uploadAttemptId = this.uploadAttemptId;
    const uploadGenerationId = this.uploadGenerationId;
    this.chunkIndex = 0;
    this.uploadFailure = null;
    this.uploadAttemptId = null;
    this.uploadGenerationId = null;
    this.startedAtMs = null;
    this.pausedAccumMs = 0;
    this.pausedStartedMs = null;
    this.localChunks = [];
    this.totalRecordedBytes = 0;
    this.lastFinalizeMeta = null;
    this.clearRecordingBackup();
    this.transition("idle");

    if (this.opts.abortUrl) {
      try {
        await fetch(this.opts.abortUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason:
              failureCode === "user_cancelled"
                ? "Recording cancelled by user"
                : failureCode === "unknown"
                  ? "Recording interruption has unknown cause"
                  : failureCode === "storage_setup_required"
                    ? "Video storage is not connected yet"
                    : "Recording upload failed",
            failureCode,
            ...(uploadAttemptId ? { attemptId: uploadAttemptId } : {}),
            ...(uploadGenerationId ? { uploadGenerationId } : {}),
          }),
        });
      } catch {
        // ignore — best effort
      }
    }
  }


  private buildMixedAudioTrack(
    streams: (MediaStream | null | undefined)[],
  ): MediaStreamTrack | null {
    const audioInputs = streams
      .filter((s): s is MediaStream => s != null)
      .flatMap((stream) =>
        stream.getAudioTracks().map((track) => ({
          track,
          isMicrophone: stream === this.micStream,
        })),
      );
    if (audioInputs.length === 0) return null;
    if (audioInputs.length === 1 && !audioInputs[0].isMicrophone) {
      return audioInputs[0].track;
    }

    const ctx = this.audioMixCtx ?? new AudioContext();
    this.audioMixCtx = ctx;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    this.audioMixSources = [];
    const dest = ctx.createMediaStreamDestination();
    for (const input of audioInputs) {
      const source = ctx.createMediaStreamSource(
        new MediaStream([input.track]),
      );
      source.connect(dest);
      this.audioMixSources.push(source);
    }
    return dest.stream.getAudioTracks()[0];
  }

  private buildCombinedStream(): MediaStream {
    if (this.opts.mode === "screen") {
      return this.buildDisplayRecordingStream();
    }

    if (this.opts.mode === "camera") {
      const combined = new MediaStream();
      const cameraTrack = this.liveVideoTrack(this.cameraStream);
      if (!cameraTrack) throw new CameraCaptureEndedError();
      combined.addTrack(cameraTrack);
      const audio = this.buildMixedAudioTrack([this.micStream]);
      if (audio) combined.addTrack(audio);
      return combined;
    }

    if (!this.cameraStream) {
      return this.buildDisplayRecordingStream();
    }

    this.cameraComposite?.cleanup();
    this.cameraComposite = createCameraCompositeStream({
      displayStream: this.displayStream!,
      cameraStream: this.cameraStream!,
      bubbleSizeRatio: this.cameraBubbleSizeRatio(),
      frameRate: SCREEN_CAPTURE_FRAME_RATE,
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
    const generation = this.streamingUploadGeneration;
    this.chunkQueue = this.chunkQueue.then(async () => {
      if (generation !== this.streamingUploadGeneration) return;
      if (
        this.uploadFailure ||
        this.streamingRecovery.isPaused ||
        this.uploadAbort?.signal.aborted
      ) {
        return;
      }
      if (this.streamingRecovery.isBrowserOffline()) {
        this.streamingRecovery.pause();
        return;
      }
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
        const failure =
          err instanceof Error ? err : new Error(errorMessage(err));
        if (failure.name === "AbortError") return;
        if (this.streamingRecovery.isRecoverableFailure(failure)) {
          this.streamingRecovery.pause(failure);
          return;
        }
        this.failStreamingDelivery(failure);
      }
    });
  }

  private async recoverStreamingDelivery(
    restartRequired: boolean,
    recoveryGeneration = this.streamingRecoveryGeneration,
  ): Promise<void> {
    this.assertCurrentStreamingRecovery(recoveryGeneration);
    const resume = restartRequired
      ? null
      : await this.claimStreamingUploadResumePoint(recoveryGeneration);
    this.assertCurrentStreamingRecovery(recoveryGeneration);
    if (!resume) {
      this.streamingUploadGeneration += 1;
      const uploadMode = await this.resetUploadedChunks(
        null,
        this.uploadAbort?.signal,
      );
      this.assertCurrentStreamingRecovery(recoveryGeneration);
      if (uploadMode !== "streaming") {
        return;
      }
    }

    let offset = resume?.bytesReceived ?? 0;
    let index = resume?.nextChunkIndex ?? 0;
    while (true) {
      const localChunkRevision = this.localChunkRevision;
      const source = new Blob(this.localChunks, { type: this.mimeType });
      if (
        offset > source.size ||
        (resume && offset !== index * STREAM_CHUNK_BYTES)
      ) {
        throw new Error("The recording upload resume offset was invalid.");
      }
      while (source.size - offset >= STREAM_CHUNK_BYTES) {
        const chunk = source.slice(
          offset,
          offset + STREAM_CHUNK_BYTES,
          this.mimeType,
        );
        await this.uploadChunk(chunk, index, {
          mimeType: this.mimeType,
          signal: this.uploadAbort?.signal,
        });
        this.assertCurrentStreamingRecovery(recoveryGeneration);
        this.opts.onChunk?.({ index, bytes: chunk.size, total: null });
        offset += chunk.size;
        index += 1;
      }

      if (localChunkRevision === this.localChunkRevision) {
        this.chunkIndex = index;
        const remainder = source.slice(offset, source.size, this.mimeType);
        this.pendingStreamBlobs = remainder.size > 0 ? [remainder] : [];
        this.pendingStreamBytes = remainder.size;
        return;
      }
    }
  }

  private assertCurrentStreamingRecovery(generation: number): void {
    if (
      generation !== this.streamingRecoveryGeneration ||
      this.uploadAbort?.signal.aborted
    ) {
      throw makeAbortError("Recording recovery was cancelled.");
    }
  }

  private async claimStreamingUploadResumePoint(
    recoveryGeneration = this.streamingRecoveryGeneration,
  ): Promise<{
    bytesReceived: number;
    nextChunkIndex: number;
  } | null> {
    const recordingId = this.opts.recordingId;
    if (!recordingId || recordingId === "__pending__") return null;

    const attemptId = this.uploadAttemptId ?? crypto.randomUUID();
    const resumeUrl = `${appBasePath()}/api/uploads/${recordingId}/resume?attemptId=${encodeURIComponent(attemptId)}`;
    let response: Response;
    try {
      response = await fetch(resumeUrl, {
        method: "GET",
        signal: this.uploadAbort?.signal,
      });
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        throw error;
      }
      throw Object.assign(
        new Error(
          `Couldn't resume the recording upload. ${errorMessage(error)}`,
        ),
        { transport: true },
      );
    }
    this.assertCurrentStreamingRecovery(recoveryGeneration);
    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        this.assertCurrentStreamingRecovery(recoveryGeneration);
        throw Object.assign(
          new Error(
            `Couldn't read the recording upload resume response. ${errorMessage(error)}`,
          ),
          { status: response.status },
        );
      }
      this.assertCurrentStreamingRecovery(recoveryGeneration);
      throw Object.assign(
        new Error(
          `Couldn't resume the recording upload (${response.status}). ${text || response.statusText}`,
        ),
        { status: response.status },
      );
    }

    let result: {
      resumable?: unknown;
      uploadMode?: unknown;
      attemptId?: unknown;
      uploadGenerationId?: unknown;
      bytesReceived?: unknown;
      nextChunkIndex?: unknown;
    } | null;
    try {
      result = (await response.json()) as typeof result;
    } catch (error) {
      this.assertCurrentStreamingRecovery(recoveryGeneration);
      throw new Error(
        `Couldn't read the recording upload resume response. ${errorMessage(error)}`,
      );
    }
    this.assertCurrentStreamingRecovery(recoveryGeneration);
    if (result?.resumable !== true) return null;
    if (
      result.attemptId !== attemptId ||
      typeof result.bytesReceived !== "number" ||
      !Number.isFinite(result.bytesReceived) ||
      result.bytesReceived < 0 ||
      typeof result.nextChunkIndex !== "number" ||
      !Number.isInteger(result.nextChunkIndex) ||
      result.nextChunkIndex < 0
    ) {
      throw new Error("The recording upload resume response was invalid.");
    }

    this.assertCurrentStreamingRecovery(recoveryGeneration);
    this.uploadAttemptId = attemptId;
    this.uploadGenerationId =
      typeof result.uploadGenerationId === "string" && result.uploadGenerationId
        ? result.uploadGenerationId
        : null;
    if (result.uploadMode !== "streaming") return null;
    return {
      bytesReceived: result.bytesReceived,
      nextChunkIndex: result.nextChunkIndex,
    };
  }

  private failStreamingDelivery(error: Error): void {
    this.streamingRecovery.clear();
    this.rememberUploadFailure(error);
    this.stopAfterUploadFailure();
    this.emitError(error);
  }

  private stopAfterUploadFailure(): void {
    if (
      this.uploadFailureStopStarted ||
      !this.recorder ||
      this.state === "stopping" ||
      this.state === "error"
    ) {
      return;
    }
    this.uploadFailureStopStarted = true;
    void this.stop().catch((err) => {
      if (err !== this.uploadFailure && (err as Error)?.name !== "AbortError") {
        console.warn("[recorder] failed to stop after upload error:", err);
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
    void this.uploadThumbnailForBlob(blob, signal);

    this.chunkIndex = 0;

    const PARALLELISM = 4;
    const totalSlices = Math.max(1, Math.ceil(blob.size / UPLOAD_SLICE_BYTES));

    const slices = Array.from({ length: totalSlices }, (_, i) => {
      const start = i * UPLOAD_SLICE_BYTES;
      const end = Math.min(start + UPLOAD_SLICE_BYTES, blob.size);
      return {
        index: this.chunkIndex++,
        slice: blob.slice(start, end, mimeType),
        isFinal: i === totalSlices - 1,
      };
    });
    const finalSlice = slices[slices.length - 1];
    const parallelSlices = slices.slice(0, -1);

    const results = new Array<Record<string, unknown> | undefined>(totalSlices);
    const queue = parallelSlices.slice();
    const chunkAbort = new AbortController();
    if (signal?.aborted) {
      chunkAbort.abort(signal.reason);
    } else {
      signal?.addEventListener("abort", () => chunkAbort.abort(signal.reason), {
        once: true,
      });
    }
    let uploadError: Error | null = null;
    let completedCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        if (chunkAbort.signal.aborted) break;
        const item = queue.shift();
        if (!item) break;
        const { index, slice } = item;
        try {
          results[index] = await this.uploadChunk(slice, index, {
            isFinal: false,
            total: totalSlices,
            mimeType,
            signal: chunkAbort.signal,
          });
          this.opts.onChunk?.({
            index: completedCount++,
            bytes: slice.size,
            total: totalSlices,
          });
        } catch (err) {
          if (chunkAbort.signal.aborted) return;
          if (!uploadError) {
            uploadError =
              err instanceof Error ? err : new Error(errorMessage(err));
            chunkAbort.abort(uploadError);
          }
          return;
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(PARALLELISM, parallelSlices.length) },
        worker,
      ),
    );

    if (uploadError) throw uploadError;
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Upload aborted");
    }

    results[finalSlice.index] = await this.uploadChunk(
      finalSlice.slice,
      finalSlice.index,
      {
        isFinal: true,
        total: totalSlices,
        mimeType,
        durationMs: meta.durationMs,
        width: meta.dimensions.width,
        height: meta.dimensions.height,
        hasAudio: meta.hasAudio,
        hasCamera: meta.hasCamera,
        signal,
      },
    );
    this.opts.onChunk?.({
      index: finalSlice.index,
      bytes: finalSlice.slice.size,
      total: totalSlices,
    });

    return results[finalSlice.index];
  }

  private async uploadBlobInStreamingChunks(
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
    if (blob.size === 0) {
      throw new Error("Cannot retry an empty recording upload.");
    }

    void this.uploadThumbnailForBlob(blob, signal);

    this.chunkIndex = 0;
    const totalChunks = Math.ceil(blob.size / STREAM_CHUNK_BYTES);
    let result: Record<string, unknown> | undefined;

    for (let index = 0; index < totalChunks; index++) {
      const start = index * STREAM_CHUNK_BYTES;
      const end = Math.min(start + STREAM_CHUNK_BYTES, blob.size);
      const isFinal = index === totalChunks - 1;
      const chunk = blob.slice(start, end, mimeType);
      result = await this.uploadChunk(chunk, this.chunkIndex++, {
        isFinal,
        total: totalChunks,
        mimeType,
        ...(isFinal
          ? {
              durationMs: meta.durationMs,
              width: meta.dimensions.width,
              height: meta.dimensions.height,
              hasAudio: meta.hasAudio,
              hasCamera: meta.hasCamera,
            }
          : {}),
        signal,
      });
      this.opts.onChunk?.({
        index,
        bytes: chunk.size,
        total: totalChunks,
      });
    }

    return result;
  }

  private async uploadThumbnailForBlob(
    blob: Blob,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.opts.recordingId || blob.size === 0) return;
    try {
      await uploadVideoBlobThumbnail(this.opts.recordingId, blob, { signal });
    } catch (error) {
      if (signal?.aborted) return;
      console.warn("[recorder] upload-time thumbnail skipped", {
        recordingId: this.opts.recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      attemptId: this.uploadAttemptId ?? undefined,
      uploadGenerationId: this.uploadGenerationId ?? undefined,
    });

    const body = await blob.arrayBuffer();
    let res: Response | null = null;
    let triedFinalUploadRecovery = false;
    for (let attempt = 1; attempt <= CHUNK_UPLOAD_MAX_ATTEMPTS; attempt++) {
      const fetchSignal = fetchSignalWithTimeout(
        extra.signal,
        extra.isFinal ? FINAL_CHUNK_UPLOAD_TIMEOUT_MS : CHUNK_UPLOAD_TIMEOUT_MS,
      );
      try {
        res = await uploadChunkRequest({
          url,
          contentType: blob.type || this.mimeType || "application/octet-stream",
          body,
          signal: fetchSignal.signal,
        });
      } catch (err) {
        const uploadErr = fetchAbortError(fetchSignal.signal, err);
        if (uploadErr.name !== "AbortError") {
          Object.assign(uploadErr, { transport: true });
        }
        if (
          attempt >= CHUNK_UPLOAD_MAX_ATTEMPTS ||
          uploadErr.name === "AbortError"
        ) {
          if (extra.isFinal && uploadErr.name !== "AbortError") {
            const recovered = await this.recoverReadyAfterFinalUploadError(
              extra.signal,
            );
            if (recovered) return recovered;
          }
          throw uploadErr;
        }
        await waitForRetry(retryDelayMs(attempt), extra.signal);
        continue;
      } finally {
        fetchSignal.cleanup();
      }

      if (
        !res.ok &&
        attempt < CHUNK_UPLOAD_MAX_ATTEMPTS &&
        isRetryableChunkUploadStatus(res.status)
      ) {
        if (extra.isFinal && res.status === 504) {
          triedFinalUploadRecovery = true;
          await res.text().catch(() => "");
          const recovered = await this.recoverReadyAfterFinalUploadError(
            extra.signal,
          );
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
        uploadAttemptId: this.uploadAttemptId,
        chunkIndex: index,
        isFinal: extra.isFinal === true,
        chunkBytes: blob.size,
        uploadMode: this.opts.uploadMode,
      });
      throw new Error(`Chunk ${index} upload failed: no response`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const responseError = classifyUploadResponseError({
        contentType: res.headers.get("content-type"),
        body: text,
        status: res.status,
        stage: "chunk_upload",
      });
      const failureCode = responseError.failureCode;
      let restartRequired = false;
      if (!responseError.isHtml) {
        try {
          restartRequired =
            (
              JSON.parse(responseError.responseText ?? "") as {
                restartRequired?: unknown;
              }
            ).restartRequired === true;
        } catch {
          // coercion-ok: malformed optional error details cannot replace the HTTP upload failure.
          // The response body only enriches the upload error; its absence is not
          // a successful or retryable session-reset signal.
        }
      }
      const err = Object.assign(
        new Error(
          responseError.isHtml
            ? `Chunk ${index} upload returned an HTML error response (${res.status}).`
            : `Chunk ${index} upload failed (${res.status}): ${responseError.responseText || res.statusText}`,
        ),
        {
          status: responseError.status,
          restartRequired,
          failureCode,
          failureStage: responseError.failureStage,
        },
      );
      if (
        extra.isFinal &&
        !triedFinalUploadRecovery &&
        this.isFinalUploadRecoveryCandidate(res.status, err)
      ) {
        const recovered = await this.recoverReadyAfterFinalUploadError(
          extra.signal,
        );
        if (recovered) return recovered;
      }
      trackClipUploadBlockingFailure({
        stage: "chunk_upload",
        failureKind: failureCode,
        recordingId: this.opts.recordingId,
        uploadAttemptId: this.uploadAttemptId,
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
            url: redactBrowserDiagnosticString(url, {
              redactQueryValues: true,
            }),
            status: res.status,
            statusText: res.statusText,
            responseBodyTail: responseError.isHtml
              ? ""
              : (responseError.responseText?.slice(0, 2000) ?? ""),
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

    const responseText = await res.text();
    const responseError = classifyUploadResponseError({
      contentType: res.headers.get("content-type"),
      body: responseText,
      status: res.status,
      stage: "chunk_upload",
    });
    if (responseError.isHtml) {
      const error = Object.assign(
        new Error(
          `Chunk ${index} upload returned an HTML error response (${res.status}).`,
        ),
        {
          status: responseError.status,
          failureCode: responseError.failureCode,
          failureStage: responseError.failureStage,
        },
      );
      trackClipUploadBlockingFailure({
        stage: "chunk_upload",
        failureKind: "chunk_html_error",
        recordingId: this.opts.recordingId,
        uploadAttemptId: this.uploadAttemptId,
        chunkIndex: index,
        isFinal: extra.isFinal === true,
        httpStatus: res.status,
        statusText: res.statusText,
        uploadMode: this.opts.uploadMode,
      });
      throw error;
    }
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
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

  private async recoverReadyAfterFinalUploadError(
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    return waitForAcceptedRecordingAfterFinalizeError({
      uploadUrl: this.opts.uploadUrl,
      recordingId: this.opts.recordingId,
      preferAuthenticated: true,
      signal,
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

  private mirrorChunkToBackup(blob: Blob): void {
    const recordingId = this.opts.recordingId;
    if (!recordingId || recordingId === "__pending__") return;
    const index = this.backupChunkIndex++;
    const dimensions = this.readDimensions();
    const hasCamera = this.recordedCameraVideo;
    this.backupMirrorQueue = this.backupMirrorQueue
      .then(async () => {
        await putRecordingBackupChunk(recordingId, index, blob);
        await putRecordingBackupMeta({
          recordingId,
          mimeType: this.mimeType,
          durationMs: Math.round(this.getElapsedMs()),
          width: dimensions.width,
          height: dimensions.height,
          hasAudio: this.hasAudioTrack(),
          hasCamera,
          bytes: this.totalRecordedBytes,
          chunkCount: index + 1,
          savedAt: new Date().toISOString(),
          completedAt: null,
        });
      })
      .catch(() => {});
  }

  private markRecordingBackupComplete(meta: RecordingFinalizeMeta): void {
    const recordingId = this.opts.recordingId;
    if (!recordingId || recordingId === "__pending__") return;
    this.backupMirrorQueue = this.backupMirrorQueue
      .then(() => {
        const completedAt = new Date().toISOString();
        return putRecordingBackupMeta({
          recordingId,
          mimeType: this.mimeType,
          durationMs: meta.durationMs,
          width: meta.dimensions.width,
          height: meta.dimensions.height,
          hasAudio: meta.hasAudio,
          hasCamera: meta.hasCamera,
          bytes: this.totalRecordedBytes,
          chunkCount: this.backupChunkIndex,
          savedAt: completedAt,
          completedAt,
        });
      })
      .catch(() => {});
  }

  private clearRecordingBackup(): void {
    const recordingId = this.opts.recordingId;
    if (!recordingId || recordingId === "__pending__") return;
    this.backupMirrorQueue = this.backupMirrorQueue
      .then(() => deleteRecordingBackup(recordingId))
      .catch(() => {});
  }

  private async acquireWakeLock(): Promise<void> {
    if (!this.wakeLockRetake && typeof document !== "undefined") {
      const doc = document;
      this.wakeLockRetake = () => {
        if (doc.visibilityState === "visible" && this.displayStream) {
          void this.acquireWakeLock();
        }
      };
      doc.addEventListener("visibilitychange", this.wakeLockRetake);
    }
    const generation = ++this.wakeLockGeneration;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    try {
      // coercion-ok: optional chaining yields undefined only when the Wake
      const wakeLock = (await navigator.wakeLock?.request?.("screen")) ?? null;
      if (generation !== this.wakeLockGeneration || !this.displayStream) {
        wakeLock?.release().catch(() => {});
        return;
      }
      this.wakeLock = wakeLock;
    } catch {
      if (generation === this.wakeLockGeneration) this.wakeLock = null;
    }
  }

  private releaseWakeLock(): void {
    this.wakeLockGeneration += 1;
    if (this.wakeLockRetake) {
      document.removeEventListener("visibilitychange", this.wakeLockRetake);
      this.wakeLockRetake = null;
    }
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private cleanupTracks(): void {
    this.streamingRecovery.clear();
    this.releaseWakeLock();
    this.cameraLive = false;
    this.audioMixSources = [];
    this.audioMixCtx?.close().catch(() => {});
    this.audioMixCtx = null;
    this.cameraComposite?.cleanup();
    this.cameraComposite = null;
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
    const e = err instanceof Error ? err : new Error(errorMessage(err));
    this.opts.onError?.(e);
    this.transition("error", { message: e.message });
  }

  private emitWarning(message: string) {
    console.warn("[recorder]", message);
    this.opts.onWarning?.(message);
  }

  private liveVideoTrack(stream: MediaStream | null): MediaStreamTrack | null {
    return (
      stream?.getVideoTracks().find((track) => track.readyState === "live") ??
      null
    );
  }

  private hasLiveCameraVideo(): boolean {
    return (
      this.liveVideoTrack(this.cameraStream) !== null &&
      (!this.rawCameraStream ||
        this.liveVideoTrack(this.rawCameraStream) !== null)
    );
  }

  private observeCameraTracks(stream: MediaStream): void {
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => this.onCameraTrackEnded());
    }
  }

  private releaseCameraAfterDisconnect(): void {
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
    this.rawCameraStream = null;
    this.cameraStream = null;
    this.opts.onCameraEnded?.();
  }

  private handleCameraUnavailableBeforeStart(): void {
    const shouldNotify = !this.cameraDisconnectNotified;
    if (shouldNotify) {
      this.cameraDisconnectNotified = true;
      this.cameraLive = false;
      this.releaseCameraAfterDisconnect();
    }
    if (this.opts.mode === "camera") {
      throw new CameraCaptureEndedError();
    }
    if (shouldNotify) {
      this.emitWarning(
        "Camera disconnected — recording continues without webcam.",
      );
    }
  }

  private onCameraTrackEnded() {
    if (!this.cameraLive) return;
    if (this.hasLiveCameraVideo()) return;
    if (this.cameraDisconnectNotified) return;
    this.cameraDisconnectNotified = true;
    this.cameraLive = false;
    this.releaseCameraAfterDisconnect();

    if (this.opts.mode === "screen+camera") {
      this.emitWarning(
        "Camera disconnected — recording continues without webcam.",
      );
      return;
    }

    if (this.state === "recording" || this.state === "paused") {
      if (this.opts.onDisplayTrackEnded) {
        this.opts.onDisplayTrackEnded();
      } else {
        void this.stop().catch((err) => this.emitError(err));
      }
      return;
    }

    this.cleanupTracks();
    this.emitError(new CameraCaptureEndedError());
  }

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
