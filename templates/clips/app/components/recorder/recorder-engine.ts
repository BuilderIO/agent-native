/**
 * Recorder engine — non-React orchestration for screen + camera + mic capture,
 * MediaRecorder lifecycle, and chunked upload to the server.
 *
 * Designed to run in the browser. The UI wires it up in `app/routes/record.tsx`,
 * but no React state lives here — callers subscribe via `onState`, `onChunk`,
 * and `onError`.
 */
import { appBasePath, captureClientException } from "@agent-native/core/client";
import {
  COMPRESS_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  compressBlobIfTooLarge,
  formatMb,
  type CompressionResult,
} from "@/lib/compress";

export type RecordingMode = "screen" | "camera" | "screen+camera";
export type DisplaySurface = "monitor" | "window" | "browser";
export const NO_MIC_DEVICE_ID = "__clips_no_microphone__";

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
  /** Chunk size in ms (MediaRecorder timeslice). Default 2000. */
  chunkIntervalMs?: number;
  /** Base URL for the chunk upload endpoint. Default `/api/uploads/:id/chunk`. */
  uploadUrl?: string;
  /** Abort URL. Default `/api/uploads/:id/abort`. */
  abortUrl?: string;
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
   * Called when the display stream's video track ends because the user clicked
   * the browser's native "Stop sharing" button. When provided, the engine
   * delegates the stop flow to this callback instead of calling `stop()`
   * internally — so the UI can run its own side-effects (thumbnail capture,
   * transcription flush, navigation) before the MediaRecorder is finalized.
   */
  onDisplayTrackEnded?: () => void;
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

const DEFAULT_CHUNK_MS = 2000;
type CaptureSource = "screen" | "camera" | "microphone" | "unknown";

function errorName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? "";
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

function isHardScreenPermissionError(err: unknown): boolean {
  const combined = `${errorName(err)} ${errorMessage(err)}`;
  return /permission denied by system|blocked by system|system settings|screen recording|screen capture|screen & system audio|privacy|could not start video source|notreadableerror/i.test(
    combined,
  );
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

/** Pick a MediaRecorder mimeType the current browser actually supports. */
export function pickMimeTypeCandidates(): string[] {
  // Chrome can report MP4 support but still reject the encoder configuration
  // for some display-capture streams. Prefer the WebM combinations that are
  // broadly supported by MediaRecorder, then fall back to MP4/Safari.
  return [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
}

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const type of pickMimeTypeCandidates()) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // continue
    }
  }
  return "";
}

export class RecorderEngine {
  readonly opts: Required<
    Pick<RecorderEngineOptions, "chunkIntervalMs" | "uploadUrl" | "abortUrl">
  > &
    RecorderEngineOptions;

  private displayStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private combinedStream: MediaStream | null = null;
  private previewStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private mimeType: string = "video/webm";

  private chunkIndex = 0;
  private chunkQueue: Promise<unknown> = Promise.resolve();
  private startedAtMs: number | null = null;
  private pausedAccumMs = 0;
  private pausedStartedMs: number | null = null;
  private uploadFailure: Error | null = null;
  /**
   * Local mirror of every chunk we sent to the server, in record order.
   * We hold these to enable the post-stop "compress and re-upload" path
   * for clips larger than COMPRESS_THRESHOLD_BYTES — without this buffer
   * we'd have to ask the server for the chunks back, which neither the
   * `/api/uploads/:id/chunk` endpoint nor `application_state` support.
   *
   * Memory cost: one Blob per 2s slice. A 10-min 1080p screen capture is
   * ~600 MB worst case (heavy motion); typical screen capture is much
   * smaller. The browser handles ~1 GB blob arrays without trouble.
   */
  private localChunks: Blob[] = [];
  private totalRecordedBytes = 0;
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

      // Start every browser media request synchronously before the first
      // `await`. Brave (and stricter Chromium/WebKit builds) require
      // getDisplayMedia to be directly anchored to the user's click. If we
      // await a network request or another media prompt first, the browser can
      // reject without showing any permission picker.
      const displaySurface = this.opts.displaySurface ?? "window";
      const displayOptions: ExtendedDisplayMediaOptions = {
        video: { frameRate: { ideal: 30 }, displaySurface },
        audio: true,
        preferCurrentTab: displaySurface === "browser",
        selfBrowserSurface:
          displaySurface === "browser" ? "include" : "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      };
      const displayPromise = wantsDisplay
        ? navigator.mediaDevices.getDisplayMedia(displayOptions)
        : Promise.resolve<MediaStream | null>(null);
      const cameraPromise = wantsCamera
        ? navigator.mediaDevices.getUserMedia({
            video: this.opts.cameraDeviceId
              ? { deviceId: { exact: this.opts.cameraDeviceId } }
              : true,
            audio: false,
          })
        : Promise.resolve<MediaStream | null>(null);
      const micPromise = wantsMic
        ? navigator.mediaDevices.getUserMedia({
            audio: this.opts.micDeviceId
              ? { deviceId: { exact: this.opts.micDeviceId } }
              : true,
            video: false,
          })
        : Promise.resolve<MediaStream | null>(null);

      const [displayResult, cameraResult, micResult] = await Promise.allSettled(
        [displayPromise, cameraPromise, micPromise],
      );
      const settledStreams = [displayResult, cameraResult, micResult]
        .filter(
          (result): result is PromiseFulfilledResult<MediaStream> =>
            result.status === "fulfilled" && result.value !== null,
        )
        .map((result) => result.value);

      const requiredFailure: { source: CaptureSource; reason: unknown } | null =
        wantsDisplay && displayResult.status === "rejected"
          ? { source: "screen", reason: displayResult.reason }
          : wantsCamera && cameraResult.status === "rejected"
            ? { source: "camera", reason: cameraResult.reason }
            : wantsMic && micResult.status === "rejected"
              ? { source: "microphone", reason: micResult.reason }
              : null;
      if (requiredFailure) {
        for (const stream of settledStreams) {
          for (const track of stream.getTracks()) {
            try {
              track.stop();
            } catch {
              // ignore
            }
          }
        }
        throw this.friendlyError(
          requiredFailure.reason,
          requiredFailure.source,
        );
      }

      this.displayStream =
        displayResult.status === "fulfilled" ? displayResult.value : null;
      this.cameraStream =
        cameraResult.status === "fulfilled" ? cameraResult.value : null;
      // If the user explicitly picked a microphone and getUserMedia rejected,
      // we threw above. The only way this lands is wantsMic=false (user chose
      // "No microphone") — micResult fulfills with null in that case.
      this.micStream =
        micResult.status === "fulfilled" ? micResult.value : null;

      // If the display stream's video track ends (user hit "Stop sharing" in
      // browser chrome) we want to end the recording gracefully.
      //
      // When `onDisplayTrackEnded` is provided the UI handles the stop flow
      // (thumbnail capture, transcription flush, state updates, navigation).
      // Without it we fall back to stopping the engine directly — but this
      // bypasses all UI side-effects, so always provide the callback.
      if (this.displayStream) {
        for (const track of this.displayStream.getVideoTracks()) {
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
  }): void {
    this.opts.recordingId = target.recordingId;
    this.opts.uploadUrl = target.uploadUrl;
    this.opts.abortUrl = target.abortUrl;
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
        try {
          this.recorder = new MediaRecorder(
            this.combinedStream,
            type ? { mimeType: type } : undefined,
          );
          this.mimeType = this.recorder.mimeType || type;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          this.recorder = null;
        }
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
    this.uploadAbort = new AbortController();

    this.recorder.addEventListener("dataavailable", (event) => {
      const blob = event.data;
      if (!blob || blob.size === 0) return;
      // Mirror to local buffer BEFORE upload — if compression turns out to
      // be needed (decided post-stop based on totalRecordedBytes), we need
      // every chunk on the client side to assemble + re-encode.
      this.localChunks.push(blob);
      this.totalRecordedBytes += blob.size;
      const index = this.chunkIndex++;
      this.queueChunk(blob, index, /* isFinal */ false);
    });

    this.recorder.addEventListener("stop", () => {
      // Final flush is handled by `stop()` itself.
    });

    this.recorder.addEventListener("error", (e) => {
      const err =
        (e as unknown as { error?: Error }).error ||
        new Error("Recorder error");
      this.emitError(err);
    });

    this.recorder.start(this.opts.chunkIntervalMs);
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
      // `dataavailable` event runs first and gets queued by our
      // start()-time listener before we drain the chunk queue and send
      // the isFinal=1 sentinel.
      this.transition("stopping");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } else {
      this.transition("stopping");

      // Wait for the dataavailable event triggered by recorder.stop() to
      // be picked up by the start()-time listener (which mirrors it into
      // `localChunks` and queues an upload). We don't push or upload the
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

    // Drain in-flight chunk uploads queued by the start()-time listener
    // (including the final dataavailable that just fired) before we either
    // compress + re-upload or send the isFinal sentinel.
    await this.chunkQueue;
    if (this.uploadFailure) {
      this.cleanupTracks();
      this.localChunks = [];
      this.transition("error", { message: this.uploadFailure.message });
      throw this.uploadFailure;
    }

    const dimensions = this.readDimensions();
    const durationMs = Math.round(this.getElapsedMs());
    const hasAudio = this.hasAudioTrack();
    const hasCamera = !!this.cameraStream;

    let result: Record<string, unknown> | undefined;
    try {
      if (this.totalRecordedBytes > COMPRESS_THRESHOLD_BYTES) {
        // Discard everything that streamed up during recording — it's
        // about to be replaced by the compressed assembly below — and
        // re-upload from index 0.
        result = await this.compressAndReupload({
          durationMs,
          dimensions,
          hasAudio,
          hasCamera,
        });
      } else {
        // Send a 0-byte isFinal sentinel — the actual final-chunk bytes
        // were already uploaded by the start()-time listener as a
        // regular (non-final) chunk. Mirroring the auto-stop path so
        // both branches share one code shape.
        this.transition("uploading", { progress: 100 });
        result = await this.uploadChunk(
          new Blob([], { type: this.mimeType }),
          this.chunkIndex++,
          {
            isFinal: true,
            total: this.chunkIndex,
            mimeType: this.mimeType,
            durationMs,
            width: dimensions.width,
            height: dimensions.height,
            hasAudio,
            hasCamera,
            signal: this.uploadAbort?.signal,
          },
        );
      }
      this.transition("complete");
    } catch (err) {
      // Reachable from compressAndReupload (compression failure, OOM,
      // reset-chunks failure, hard-cap exceeded, abort) and from the
      // isFinal sentinel upload. Ensure we never leave the engine stuck
      // mid-state — the UI spinner is wired to engine state and would
      // hang forever otherwise.
      const e = err instanceof Error ? err : new Error(String(err));
      this.transition("error", { message: e.message });
      throw e;
    } finally {
      // Always release hardware resources, even if the final upload failed.
      this.cleanupTracks();
      // Drop the in-memory chunks now that they're either uploaded or no
      // longer needed by this engine. If storage was missing, the server keeps
      // its uploaded chunk scratch-space and the player page resumes finalize
      // after the user connects Builder.io/S3.
      this.localChunks = [];
    }

    return {
      videoUrl: (result?.videoUrl as string | undefined) ?? null,
      status: result?.status as string | undefined,
      waitingForStorage:
        result?.waitingForStorage === true ||
        result?.status === "waiting_storage",
      durationMs,
      width: dimensions.width,
      height: dimensions.height,
      hasAudio,
      hasCamera,
    };
  }

  // -------------------------------------------------------------------------
  // Compression path
  // -------------------------------------------------------------------------

  /**
   * Re-encode the local chunk buffer at a lower bitrate via ffmpeg.wasm,
   * discard the chunks we already streamed up (they'd assemble to the
   * un-compressed source), and upload the compressed result starting at
   * index 0. Triggered when `totalRecordedBytes > COMPRESS_THRESHOLD_BYTES`
   * because the assembled blob would otherwise blow Builder.io's 100 MB
   * per-file upload limit and 500 mid-stream.
   *
   * Throws a clean user-facing error if the compressed blob is STILL larger
   * than `MAX_UPLOAD_BYTES`, so the UI can suggest "shorter recording / lower
   * resolution" rather than letting the upload fail with a 500.
   */
  private async compressAndReupload(meta: {
    durationMs: number;
    dimensions: { width: number; height: number };
    hasAudio: boolean;
    hasCamera: boolean;
  }): Promise<Record<string, unknown> | undefined> {
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

      // Tell the server to wipe the chunks we streamed up during recording
      // (they came from an un-compressed source) and stash the compression
      // metadata so finalize-recording can include it in any Sentry capture
      // if the upload still fails downstream.
      //
      // A failure here is fatal — proceeding with the re-upload would
      // mix compressed slices (indices 0..N) on top of the leftover
      // un-compressed chunks at indices N+1..M, and finalize would
      // concatenate them into a corrupted blob that decodes to a
      // mid-clip glitch followed by garbage. Better a clean error than a
      // silently-broken recording.
      const resetUrl = `${appBasePath()}/api/uploads/${
        this.opts.recordingId
      }/reset-chunks`;
      const compressionPayload = compression.compressed
        ? {
            originalBytes,
            compressedBytes,
            ratio: compression.ratio,
            elapsedMs: compression.elapsedMs,
            outputMimeType: compression.outputMimeType,
          }
        : null;
      let resetRes: Response;
      try {
        resetRes = await fetch(resetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compression: compressionPayload }),
          signal: abort.signal,
        });
      } catch (err) {
        // The user clicking Cancel mid-fetch makes the AbortController
        // abort and `fetch` rejects with a DOMException whose
        // `name === "AbortError"`. Wrapping that into a generic network
        // error would lose the AbortError identity, so doStop()'s catch
        // would surface a misleading "Upload failed (network error)"
        // toast for what is actually an intentional cancel. Re-throw the
        // abort untouched; only wrap genuine non-abort failures.
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
          )}). Try a shorter recording or lower the screen resolution / frame rate.`,
        );
      }

      this.transition("uploading", { progress: 0 });

      // Reset the upload index since the server just wiped its chunks.
      this.chunkIndex = 0;

      // Slice the (possibly compressed) blob into 5 MB chunks — the server's
      // chunk handler caps each at ~6 MB so we need to slice. This is the
      // same approach the file-upload code path uses in `record.tsx`.
      const UPLOAD_SLICE_BYTES = 5 * 1024 * 1024;
      const totalSlices = Math.max(
        1,
        Math.ceil(finalBlob.size / UPLOAD_SLICE_BYTES),
      );
      const outputMimeType = compression.outputMimeType;

      let lastResult: Record<string, unknown> | undefined;
      for (let i = 0; i < totalSlices; i++) {
        if (abort.signal.aborted) {
          throw abort.signal.reason instanceof Error
            ? abort.signal.reason
            : new Error("Compression upload aborted");
        }
        const start = i * UPLOAD_SLICE_BYTES;
        const end = Math.min(start + UPLOAD_SLICE_BYTES, finalBlob.size);
        const slice = finalBlob.slice(start, end, outputMimeType);
        const isFinal = i === totalSlices - 1;
        const index = this.chunkIndex++;
        lastResult = await this.uploadChunk(slice, index, {
          isFinal,
          total: totalSlices,
          mimeType: outputMimeType,
          durationMs: isFinal ? meta.durationMs : undefined,
          width: isFinal ? meta.dimensions.width : undefined,
          height: isFinal ? meta.dimensions.height : undefined,
          hasAudio: isFinal ? meta.hasAudio : undefined,
          hasCamera: isFinal ? meta.hasCamera : undefined,
          signal: abort.signal,
        });
        this.opts.onChunk?.({
          index,
          bytes: slice.size,
          total: totalSlices,
        });
      }

      return lastResult;
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

  private buildCombinedStream(): MediaStream {
    // Screen-only: just add mic audio if we have it.
    if (this.opts.mode === "screen") {
      const combined = new MediaStream();
      for (const t of this.displayStream!.getVideoTracks())
        combined.addTrack(t);
      for (const t of this.displayStream!.getAudioTracks())
        combined.addTrack(t);
      if (this.micStream) {
        for (const t of this.micStream.getAudioTracks()) combined.addTrack(t);
      }
      return combined;
    }

    // Camera-only: camera video + mic.
    if (this.opts.mode === "camera") {
      const combined = new MediaStream();
      for (const t of this.cameraStream!.getVideoTracks()) combined.addTrack(t);
      if (this.micStream) {
        for (const t of this.micStream.getAudioTracks()) combined.addTrack(t);
      }
      return combined;
    }

    // Screen + camera: we record the display track and trust the UI to
    // overlay the bubble visually via a canvas capture in a future pass.
    // For MVP we just attach both track sets to the same MediaStream; the
    // camera bubble is rendered on top during playback via canvas when the
    // browser supports it. Here we include the display video track and any
    // available audio tracks.
    const combined = new MediaStream();
    for (const t of this.displayStream!.getVideoTracks()) combined.addTrack(t);
    for (const t of this.displayStream!.getAudioTracks()) combined.addTrack(t);
    if (this.micStream) {
      for (const t of this.micStream.getAudioTracks()) combined.addTrack(t);
    }
    return combined;
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
        await this.markUploadFailed(failure);
        this.emitError(failure);
      }
    });
  }

  private async markUploadFailed(err: Error): Promise<void> {
    if (!this.uploadFailure) {
      this.uploadFailure = err;
    }
    if (!this.opts.abortUrl) return;
    try {
      await fetch(this.opts.abortUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: err.message }),
      });
    } catch {
      // ignore — the stop path will surface the original upload error.
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
    const params = new URLSearchParams();
    params.set("index", String(index));
    if (extra.total !== undefined) params.set("total", String(extra.total));
    params.set("isFinal", extra.isFinal ? "1" : "0");
    if (extra.mimeType) params.set("mimeType", extra.mimeType);
    if (extra.durationMs !== undefined)
      params.set("durationMs", String(Math.round(extra.durationMs)));
    if (extra.width !== undefined) params.set("width", String(extra.width));
    if (extra.height !== undefined) params.set("height", String(extra.height));
    if (extra.hasAudio !== undefined)
      params.set("hasAudio", extra.hasAudio ? "1" : "0");
    if (extra.hasCamera !== undefined)
      params.set("hasCamera", extra.hasCamera ? "1" : "0");

    const url = `${this.opts.uploadUrl}?${params.toString()}`;

    const body = await blob.arrayBuffer();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":
          blob.type || this.mimeType || "application/octet-stream",
      },
      body,
      signal: extra.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `Chunk ${index} upload failed (${res.status}): ${text || res.statusText}`,
      );
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

  private readDimensions(): { width: number; height: number } {
    const videoTrack =
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
    for (const s of [
      this.displayStream,
      this.cameraStream,
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
