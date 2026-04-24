/**
 * Recorder engine — non-React orchestration for screen + camera + mic capture,
 * MediaRecorder lifecycle, and chunked upload to the server.
 *
 * Designed to run in the browser. The UI wires it up in `app/routes/record.tsx`,
 * but no React state lives here — callers subscribe via `onState`, `onChunk`,
 * and `onError`.
 */

export type RecordingMode = "screen" | "camera" | "screen+camera";

export type RecorderState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
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
export function pickMimeType(): string {
  // Prefer MP4 (H.264) — produces faststart-friendly files that stream well
  // with HTTP range requests. Chrome 121+ and Safari both support MP4 in
  // MediaRecorder; Firefox falls back to WebM.
  const candidates = [
    "video/mp4;codecs=avc1,opus",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const type of candidates) {
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

  private state: RecorderState = "idle";

  constructor(options: RecorderEngineOptions) {
    this.opts = {
      chunkIntervalMs: options.chunkIntervalMs ?? DEFAULT_CHUNK_MS,
      uploadUrl:
        options.uploadUrl ?? `/api/uploads/${options.recordingId}/chunk`,
      abortUrl: options.abortUrl ?? `/api/uploads/${options.recordingId}/abort`,
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

      // If the display stream's video track ends (user hit "Stop sharing" in
      // browser chrome) we want to end the recording gracefully.
      if (this.displayStream) {
        for (const track of this.displayStream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            if (this.state === "recording" || this.state === "paused") {
              void this.stop();
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

    this.mimeType = pickMimeType();
    // `pickMimeType` returns "" when MediaRecorder exists but nothing in the
    // candidate list is supported. Fail here with a user-readable message
    // instead of letting the empty type propagate to the chunk uploader
    // (which would surface a confusing "Missing mimeType query param").
    if (!this.mimeType) {
      throw new Error(
        "Your browser doesn't support any of the video codecs Clips needs. Try a recent Chrome, Edge, Safari, or Firefox.",
      );
    }
    this.recorder = new MediaRecorder(this.combinedStream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    this.chunkIndex = 0;

    this.recorder.addEventListener("dataavailable", (event) => {
      const blob = event.data;
      if (!blob || blob.size === 0) return;
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

    if (this.recorder.state === "inactive") {
      throw new Error("Recorder already stopped");
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
    const finalIndex = this.chunkIndex++;

    // Wait for all pending in-flight chunks before we send the isFinal one.
    await this.chunkQueue.catch(() => {});

    const dimensions = this.readDimensions();
    const durationMs = Math.round(this.getElapsedMs());

    this.transition("uploading", { progress: 100 });

    const result = await this.uploadChunk(finalBlob, finalIndex, {
      isFinal: true,
      total: this.chunkIndex,
      mimeType: this.mimeType,
      durationMs,
      width: dimensions.width,
      height: dimensions.height,
      hasAudio: this.hasAudioTrack(),
      hasCamera: !!this.cameraStream,
    });

    this.cleanupTracks();
    this.transition("complete");

    return {
      videoUrl: (result?.videoUrl as string | undefined) ?? null,
      durationMs,
      width: dimensions.width,
      height: dimensions.height,
      hasAudio: this.hasAudioTrack(),
      hasCamera: !!this.cameraStream,
    };
  }

  /** Cancel: abort server-side, release tracks, reset state. */
  async cancel(): Promise<void> {
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {
      // ignore
    }
    try {
      await fetch(this.opts.abortUrl, { method: "POST" });
    } catch {
      // ignore — best effort
    }
    this.cleanupTracks();
    this.chunkIndex = 0;
    this.startedAtMs = null;
    this.pausedAccumMs = 0;
    this.pausedStartedMs = null;
    this.transition("idle");
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
    this.chunkQueue = this.chunkQueue.then(() =>
      this.uploadChunk(blob, index, { isFinal, mimeType: this.mimeType }).then(
        () => {
          this.opts.onChunk?.({
            index,
            bytes: blob.size,
            total: null,
          });
        },
        (err) => this.emitError(err),
      ),
    );
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
        "Screen or camera access was denied. On macOS, grant access in System Settings → Privacy & Security → Screen Recording and reload.",
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
