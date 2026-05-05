/**
 * Recorder engine — non-React orchestration for screen + camera + mic capture,
 * MediaRecorder lifecycle, and chunked upload to the server.
 *
 * Designed to run in the browser. The UI wires it up in `app/routes/record.tsx`,
 * but no React state lives here — callers subscribe via `onState`, `onChunk`,
 * and `onError`.
 */
import { appBasePath } from "@agent-native/core/client";
import {
  COMPRESS_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  compressBlobIfTooLarge,
  formatMb,
  type CompressionResult,
} from "@/lib/compress";

export type RecordingMode = "screen" | "camera" | "screen+camera";
export const NO_MIC_DEVICE_ID = "__clips_no_microphone__";

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
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
}

const DEFAULT_CHUNK_MS = 2000;

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

    try {
      if (this.opts.mode === "screen" || this.opts.mode === "screen+camera") {
        this.displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
      }

      if (this.opts.mode === "camera" || this.opts.mode === "screen+camera") {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: this.opts.cameraDeviceId
            ? { deviceId: { exact: this.opts.cameraDeviceId } }
            : true,
          audio: false,
        });
      }

      if (this.opts.micDeviceId !== NO_MIC_DEVICE_ID) {
        // Mic is separate so user can pick explicitly; combined with system audio later.
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: this.opts.micDeviceId
              ? { deviceId: { exact: this.opts.micDeviceId } }
              : true,
            video: false,
          });
        } catch {
          // Mic is optional — if denied we still record without it.
          this.micStream = null;
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
      throw this.friendlyError(err);
    }
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

    // The MediaRecorder may have auto-stopped if all its tracks ended (e.g.
    // display-only mode with no mic). Different browsers dispatch `dataavailable`
    // either before or after state transitions to `inactive`. Yielding one
    // macrotask (setTimeout 0) ensures any still-pending `dataavailable` event
    // runs first and gets queued by our start()-time listener before we drain
    // the chunk queue and send the isFinal=1 sentinel.
    if (this.recorder.state === "inactive") {
      this.transition("stopping");
      // Yield to the event loop so any pending dataavailable event from the
      // auto-stop can fire and be queued before we drain chunkQueue.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await this.chunkQueue;
      if (this.uploadFailure) throw this.uploadFailure;
      const dimensions = this.readDimensions();
      const durationMs = Math.round(this.getElapsedMs());
      const hasAudio = this.hasAudioTrack();
      const hasCamera = !!this.cameraStream;

      // Auto-stop path: there's no extra final blob we missed. Branch on
      // size and either finalize via the streamed chunks (small clip) or
      // discard them and re-upload a compressed assembly (large clip).
      let result: Record<string, unknown> | undefined;
      try {
        if (this.totalRecordedBytes > COMPRESS_THRESHOLD_BYTES) {
          result = await this.compressAndReupload({
            durationMs,
            dimensions,
            hasAudio,
            hasCamera,
          });
        } else {
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
            },
          );
        }
      } finally {
        // Always release hardware resources, even if the final upload failed.
        this.cleanupTracks();
        // Drop the in-memory chunks now that they're either uploaded or no
        // longer recoverable from this engine (a finalize failure surfaces
        // through the thrown error path, not by retrying the chunks).
        this.localChunks = [];
      }
      this.transition("complete");
      return {
        videoUrl: (result?.videoUrl as string | undefined) ?? null,
        durationMs,
        width: dimensions.width,
        height: dimensions.height,
        hasAudio,
        hasCamera,
      };
    }

    this.transition("stopping");

    const stopPromise = new Promise<Blob>((resolve) => {
      let resolved = false;
      const onData = (event: BlobEvent) => {
        if (resolved) return;
        resolved = true;
        this.recorder?.removeEventListener("dataavailable", onData);
        resolve(event.data);
      };
      this.recorder!.addEventListener("dataavailable", onData, { once: true });
      // Safety net: if dataavailable never fires (broken recorder),
      // resolve with empty blob after 10s so we don't hang forever.
      // Normal path fires within milliseconds of recorder.stop().
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.recorder?.removeEventListener("dataavailable", onData);
        resolve(new Blob([], { type: this.mimeType }));
      }, 10_000);
    });

    try {
      this.recorder.stop();
    } catch (err) {
      this.emitError(err);
      throw err;
    }

    const finalBlob = await stopPromise;
    if (finalBlob.size > 0) {
      // Mirror the final dataavailable into the local buffer so the
      // compression path (if any) sees the complete recording. The
      // streaming path also pushed every prior `dataavailable` here.
      this.localChunks.push(finalBlob);
      this.totalRecordedBytes += finalBlob.size;
    }
    const finalIndex = this.chunkIndex++;

    // Wait for all pending in-flight chunks before we send the isFinal one.
    await this.chunkQueue;
    if (this.uploadFailure) throw this.uploadFailure;

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
        this.transition("uploading", { progress: 100 });
        result = await this.uploadChunk(finalBlob, finalIndex, {
          isFinal: true,
          total: this.chunkIndex,
          mimeType: this.mimeType,
          durationMs,
          width: dimensions.width,
          height: dimensions.height,
          hasAudio,
          hasCamera,
        });
      }
    } finally {
      this.cleanupTracks();
      this.localChunks = [];
    }
    this.transition("complete");

    return {
      videoUrl: (result?.videoUrl as string | undefined) ?? null,
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

    const assembled = new Blob(this.localChunks, { type: this.mimeType });
    const originalBytes = assembled.size;

    let compression: CompressionResult | null = null;
    let compressionError: {
      message: string;
      stderrTail: string[];
      elapsedMs: number;
    } | null = null;
    try {
      compression = await compressBlobIfTooLarge(assembled, this.mimeType, {
        width: meta.dimensions.width,
        height: meta.dimensions.height,
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
      // compressBlobIfTooLarge swallows ffmpeg failures (returns the input
      // blob with compressed=false). A throw here would mean something
      // genuinely unexpected, e.g. an OOM during the assembled-blob
      // creation. Surface it as the user-facing error.
      throw err instanceof Error ? err : new Error(String(err));
    }

    const finalBlob = compression.blob;
    const compressedBytes = finalBlob.size;

    // Tell the server to wipe the chunks we streamed up during recording
    // (they came from an un-compressed source) and stash the compression
    // metadata so finalize-recording can include it in any Sentry capture
    // if the upload still fails downstream.
    try {
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
      const resetRes = await fetch(resetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compression: compressionPayload }),
      });
      if (!resetRes.ok) {
        // Reset failed but we'll plough on — the worst case is finalize
        // assembles BOTH the old streamed chunks AND the new compressed
        // ones, in which case its existing size handling will surface the
        // problem. Logging here so the bug is at least visible.
        console.warn(
          "[recorder] reset-chunks failed; proceeding with re-upload",
          { status: resetRes.status },
        );
      }
    } catch (err) {
      console.warn("[recorder] reset-chunks request failed", err);
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
      });
      this.opts.onChunk?.({
        index,
        bytes: slice.size,
        total: totalSlices,
      });
    }

    return lastResult;
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
    this.cleanupTracks();
    this.chunkIndex = 0;
    this.uploadFailure = null;
    this.startedAtMs = null;
    this.pausedAccumMs = 0;
    this.pausedStartedMs = null;
    this.localChunks = [];
    this.totalRecordedBytes = 0;
    this.transition("idle");

    try {
      await fetch(this.opts.abortUrl, { method: "POST" });
    } catch {
      // ignore — best effort
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
      try {
        await this.uploadChunk(blob, index, {
          isFinal,
          mimeType: this.mimeType,
        });
        this.opts.onChunk?.({
          index,
          bytes: blob.size,
          total: null,
        });
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        await this.markUploadFailed(failure);
        this.emitError(failure);
      }
    });
  }

  private async markUploadFailed(err: Error): Promise<void> {
    if (!this.uploadFailure) {
      this.uploadFailure = err;
    }
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
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Chunk ${index} upload failed (${res.status}): ${text || res.statusText}`,
      );
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

  private friendlyError(err: unknown): Error {
    const message =
      err instanceof Error ? err.message : String(err || "Unknown error");
    if (/Permission denied|NotAllowedError|denied/i.test(message)) {
      return new Error(
        "Screen, camera, or microphone access was blocked. In Chrome, open Site settings for this app and allow Camera and Microphone. On macOS, also check System Settings > Privacy & Security for Screen Recording, Camera, and Microphone, then quit and reopen Chrome.",
      );
    }
    if (/NotFoundError|no device/i.test(message)) {
      return new Error(
        "No camera or microphone found. Plug one in or pick a different device.",
      );
    }
    return err instanceof Error ? err : new Error(message);
  }
}
