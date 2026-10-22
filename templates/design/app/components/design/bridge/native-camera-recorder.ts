export class NativeCameraRecordingError extends Error {
  constructor(
    readonly code:
      | "camera-recording-unsupported"
      | "camera-recording-unavailable"
      | "camera-recording-failed"
      | "camera-recording-too-large"
      | "camera-recording-aborted"
      | "camera-recording-timeout",
  ) {
    super(code);
    this.name = "NativeCameraRecordingError";
  }
}

const MAX_CLIP_BYTES = 96 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30.2;
const MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/mp4;codecs=avc1.42E01E",
] as const;

function recordingMimeType(): string {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  )
    throw new NativeCameraRecordingError("camera-recording-unsupported");
  const mimeType = MIME_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType)
    throw new NativeCameraRecordingError("camera-recording-unsupported");
  return mimeType;
}

export async function recordNativeCameraClip(args: {
  sourceTrack: MediaStreamTrack;
  durationSeconds: number;
  signal: AbortSignal;
  onProgress?: (elapsedSeconds: number, durationSeconds: number) => void;
}): Promise<Blob> {
  const mimeType = recordingMimeType();
  const { sourceTrack, durationSeconds, signal, onProgress } = args;
  if (
    sourceTrack.readyState !== "live" ||
    sourceTrack.kind !== "video" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > MAX_DURATION_SECONDS
  )
    throw new NativeCameraRecordingError("camera-recording-unavailable");
  if (signal.aborted)
    throw new NativeCameraRecordingError("camera-recording-aborted");
  let track: MediaStreamTrack | null = null;
  let stream: MediaStream;
  try {
    track = sourceTrack.clone();
    stream = new MediaStream([track]);
  } catch {
    track?.stop();
    throw new NativeCameraRecordingError("camera-recording-unavailable");
  }
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
  } catch {
    track.stop();
    throw new NativeCameraRecordingError("camera-recording-unsupported");
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let settled = false;
  let stopTimer = 0;
  let timeoutTimer = 0;
  let progressTimer = 0;
  let rejectResult!: (error: NativeCameraRecordingError) => void;
  let resolveResult!: (blob: Blob) => void;
  const result = new Promise<Blob>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const cleanup = () => {
    window.clearTimeout(stopTimer);
    window.clearTimeout(timeoutTimer);
    window.clearInterval(progressTimer);
    signal.removeEventListener("abort", onAbort);
    track.removeEventListener("ended", onTrackEnded);
    recorder.removeEventListener("dataavailable", onData);
    recorder.removeEventListener("stop", onStop);
    recorder.removeEventListener("error", onError);
    track.stop();
  };
  const finish = (value: Blob | NativeCameraRecordingError) => {
    if (settled) return;
    settled = true;
    if (recorder.state !== "inactive") recorder.stop();
    cleanup();
    if (value instanceof NativeCameraRecordingError) rejectResult(value);
    else resolveResult(value);
  };
  const emitProgress = (elapsedSeconds: number) => {
    try {
      onProgress?.(elapsedSeconds, durationSeconds);
    } catch {
      finish(new NativeCameraRecordingError("camera-recording-unavailable"));
    }
  };
  const onData = (event: BlobEvent) => {
    if (!event.data.size) return;
    bytes += event.data.size;
    if (bytes > MAX_CLIP_BYTES) {
      finish(new NativeCameraRecordingError("camera-recording-too-large"));
      return;
    }
    chunks.push(event.data);
  };
  const onStop = () => {
    if (signal.aborted) {
      finish(new NativeCameraRecordingError("camera-recording-aborted"));
      return;
    }
    if (chunks.length === 0) {
      finish(new NativeCameraRecordingError("camera-recording-failed"));
      return;
    }
    finish(new Blob(chunks, { type: recorder.mimeType || mimeType }));
  };
  const onError = () =>
    finish(new NativeCameraRecordingError("camera-recording-failed"));
  const onAbort = () =>
    finish(new NativeCameraRecordingError("camera-recording-aborted"));
  const onTrackEnded = () =>
    finish(new NativeCameraRecordingError("camera-recording-unavailable"));
  recorder.addEventListener("dataavailable", onData);
  recorder.addEventListener("stop", onStop);
  recorder.addEventListener("error", onError);
  signal.addEventListener("abort", onAbort, { once: true });
  track.addEventListener("ended", onTrackEnded, { once: true });
  const started = performance.now();
  try {
    recorder.start(1000);
  } catch {
    finish(new NativeCameraRecordingError("camera-recording-failed"));
    return result;
  }
  emitProgress(0);
  if (settled) return result;
  progressTimer = window.setInterval(() => {
    const elapsed = Math.min(
      durationSeconds,
      (performance.now() - started) / 1000,
    );
    emitProgress(elapsed);
  }, 250);
  stopTimer = window.setTimeout(() => {
    emitProgress(durationSeconds);
    if (settled) return;
    if (recorder.state !== "inactive") recorder.stop();
  }, durationSeconds * 1000);
  timeoutTimer = window.setTimeout(
    () => finish(new NativeCameraRecordingError("camera-recording-timeout")),
    durationSeconds * 1000 + 10_000,
  );
  return result;
}
