// Offscreen recording engine (Loom-style, MV3).
//
// This document holds the getDisplayMedia()/getUserMedia() stream and the
// MediaRecorder. Living in an offscreen document (reason DISPLAY_MEDIA) is what
// lets a recording survive page navigations — the capture is decoupled from any
// tab. The camera bubble and controls are rendered as on-page overlays by the
// content script, so we no longer composite the camera into a canvas here; for
// screen modes we record the display stream directly (+ mixed mic audio), and
// the bubble shows up in the recording naturally when a full screen/window/tab
// surface that contains it is captured.
//
// Lifecycle: ACQUIRE (show picker, hold stream) → BEGIN (start recorder after
// the countdown) → PAUSE/RESUME → STOP/CANCEL, plus RESTART (discard and start
// over on the same stream).

type CaptureMode = "screen" | "camera";

type AcquireMessage = {
  type: "CLIPS_OFFSCREEN_ACQUIRE";
  sessionId: string;
  mode: CaptureMode;
  surface: "browser" | "window" | "monitor";
  includeMicrophone: boolean;
};

type BeginMessage = {
  type: "CLIPS_OFFSCREEN_BEGIN";
  sessionId: string;
  recordingId: string;
  uploadUrl: string;
  hasCamera?: boolean;
  // Pre-roll countdown delay, owned here in the offscreen document (a reliable
  // context) rather than the service worker (which can suspend and drop timers).
  startDelayMs?: number;
  // Bearer token so chunk uploads authenticate the same way create-recording
  // does. The offscreen document has no Clips session cookie of its own.
  authToken?: string;
};

type SimpleMessage = {
  type:
    | "CLIPS_OFFSCREEN_PAUSE"
    | "CLIPS_OFFSCREEN_RESUME"
    | "CLIPS_OFFSCREEN_STOP"
    | "CLIPS_OFFSCREEN_CANCEL"
    | "CLIPS_OFFSCREEN_RESTART"
    | "CLIPS_OFFSCREEN_START_NOW";
  sessionId: string;
};

type StatusName = "recording" | "paused" | "uploading" | "complete" | "error";

type UploadResult = {
  ok?: boolean;
  id?: string;
  recordingId?: string;
  videoUrl?: string;
  status?: string;
  waitingForStorage?: boolean;
  storageSetupRequired?: boolean;
  error?: string;
};

type PreparedStreams = {
  sessionId: string;
  mode: CaptureMode;
  displayStream: MediaStream | null;
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
  width: number;
  height: number;
  endedListener: (() => void) | null;
  endedTrack: MediaStreamTrack | null;
};

type ActiveRecording = {
  sessionId: string;
  recordingId: string;
  uploadUrl: string;
  authToken: string | null;
  mode: CaptureMode;
  startedAtMs: number;
  mimeType: string;
  recorder: MediaRecorder;
  outputStream: MediaStream;
  sourceStreams: MediaStream[];
  audioContext: AudioContext | null;
  chunkIndex: number;
  uploadPromises: Promise<unknown>[];
  uploadFailure: Error | null;
  cancelled: boolean;
  // Set when the recorder is being torn down to start over on the same source
  // streams, so the stop handler skips the usual track cleanup.
  restarting: boolean;
  // Pending pre-roll timer; non-null means the recorder hasn't started yet.
  startTimer: ReturnType<typeof setTimeout> | null;
  dimensions: { width: number; height: number };
  hasAudio: boolean;
  hasCamera: boolean;
  stopped: Promise<UploadResult>;
  resolveStopped: (result: UploadResult) => void;
  rejectStopped: (error: Error) => void;
};

let prepared: PreparedStreams | null = null;
let activeRecording: ActiveRecording | null = null;

function reportStatus(
  sessionId: string,
  status: StatusName,
  extra: Record<string, unknown> = {},
): void {
  chrome.runtime.sendMessage({
    type: "CLIPS_NATIVE_STATUS",
    sessionId,
    status,
    ...extra,
  });
}

function chooseMimeType(): string {
  const preferred = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  return (
    preferred.find((type) => MediaRecorder.isTypeSupported(type)) ??
    "video/webm"
  );
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not load capture preview."));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function streamDimensions(
  stream: MediaStream,
): Promise<{ width: number; height: number }> {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.();
  if (settings?.width && settings?.height) {
    return { width: settings.width, height: settings.height };
  }
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await waitForMetadata(video).catch(() => undefined);
  return {
    width: video.videoWidth || 1280,
    height: video.videoHeight || 720,
  };
}

function displayConstraints(
  surface: "browser" | "window" | "monitor",
): MediaStreamConstraints {
  const displaySurface =
    surface === "browser"
      ? "browser"
      : surface === "window"
        ? "window"
        : "monitor";
  return {
    video: {
      frameRate: { ideal: 30, max: 30 },
      ...({ displaySurface } as object),
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  } as MediaStreamConstraints;
}

async function getMicStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  } catch {
    return null;
  }
}

async function createMixedAudio(
  streams: MediaStream[],
): Promise<{ audioContext: AudioContext | null; tracks: MediaStreamTrack[] }> {
  const streamsWithAudio = streams.filter(
    (stream) => stream.getAudioTracks().length,
  );
  if (!streamsWithAudio.length) return { audioContext: null, tracks: [] };
  if (streamsWithAudio.length === 1) {
    return { audioContext: null, tracks: streamsWithAudio[0].getAudioTracks() };
  }

  const audioContext = new AudioContext();
  await audioContext.resume().catch(() => undefined);
  const destination = audioContext.createMediaStreamDestination();
  for (const stream of streamsWithAudio) {
    audioContext.createMediaStreamSource(stream).connect(destination);
  }
  return { audioContext, tracks: destination.stream.getAudioTracks() };
}

function appendUploadParams(
  uploadUrl: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(uploadUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(
      key,
      typeof value === "boolean" ? (value ? "1" : "0") : String(value),
    );
  }
  return url.toString();
}

async function uploadChunk(
  recording: ActiveRecording,
  blob: Blob,
  index: number,
  extra: {
    isFinal?: boolean;
    total?: number;
    durationMs?: number;
    width?: number;
    height?: number;
    hasAudio?: boolean;
    hasCamera?: boolean;
  } = {},
): Promise<UploadResult> {
  const url = appendUploadParams(recording.uploadUrl, {
    index,
    total: extra.total,
    isFinal: extra.isFinal ? 1 : 0,
    mimeType: recording.mimeType,
    durationMs: extra.durationMs,
    width: extra.width,
    height: extra.height,
    hasAudio: extra.hasAudio,
    hasCamera: extra.hasCamera,
  });
  const body = await blob.arrayBuffer();
  const headers: Record<string, string> = {
    "Content-Type": blob.type || recording.mimeType,
    "X-Agent-Native-Frontend": "1",
  };
  if (recording.authToken) {
    headers.Authorization = `Bearer ${recording.authToken}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body,
  });
  const text = await res.text().catch(() => "");
  const data = text ? (JSON.parse(text) as UploadResult) : {};
  if (!res.ok) {
    throw new Error(
      data?.error || `Upload failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return data;
}

function stopStreams(streams: (MediaStream | null)[]): void {
  for (const stream of streams) {
    if (!stream) continue;
    for (const track of stream.getTracks()) track.stop();
  }
}

function disposePrepared(): void {
  if (!prepared) return;
  if (prepared.endedTrack && prepared.endedListener) {
    prepared.endedTrack.removeEventListener("ended", prepared.endedListener);
  }
  prepared = null;
}

function cleanup(recording: ActiveRecording): void {
  stopStreams([recording.outputStream, ...recording.sourceStreams]);
  void recording.audioContext?.close().catch(() => undefined);
}

/* ---------------------------------------------------------------- acquire --- */

async function acquire(message: AcquireMessage): Promise<{
  ok: boolean;
  width: number;
  height: number;
}> {
  if (activeRecording) throw new Error("Clips is already recording.");
  // Discard any half-prepared capture from a cancelled attempt.
  stopPreparedStreams();
  disposePrepared();

  let displayStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let cameraStream: MediaStream | null = null;

  if (message.mode === "camera") {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: message.includeMicrophone,
    });
  } else {
    // Native "Choose what to share" picker. This is the screenshot Steve showed.
    displayStream = await navigator.mediaDevices.getDisplayMedia(
      displayConstraints(message.surface),
    );
    if (message.includeMicrophone) micStream = await getMicStream();
  }

  const videoStream = displayStream ?? cameraStream;
  if (!videoStream) throw new Error("No media stream was available to record.");
  const { width, height } = await streamDimensions(videoStream);

  // If the user stops sharing via Chrome's native control, tell the worker so it
  // can run the normal stop/finalize flow.
  const endedTrack = videoStream.getVideoTracks()[0] ?? null;
  const endedListener = () => {
    chrome.runtime.sendMessage({
      type: "CLIPS_NATIVE_ENDED",
      sessionId: message.sessionId,
    });
  };
  endedTrack?.addEventListener("ended", endedListener);

  prepared = {
    sessionId: message.sessionId,
    mode: message.mode,
    displayStream,
    micStream,
    cameraStream,
    width,
    height,
    endedListener,
    endedTrack,
  };
  return { ok: true, width, height };
}

function stopPreparedStreams(): void {
  if (!prepared) return;
  stopStreams([
    prepared.displayStream,
    prepared.micStream,
    prepared.cameraStream,
  ]);
}

/* ------------------------------------------------------------------ begin --- */

async function begin(message: BeginMessage): Promise<{
  ok: boolean;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
}> {
  const ready = prepared;
  if (!ready || ready.sessionId !== message.sessionId) {
    throw new Error("No prepared Clips capture was found.");
  }
  if (activeRecording) throw new Error("Clips is already recording.");

  const videoStream = ready.displayStream ?? ready.cameraStream;
  const videoTrack = videoStream?.getVideoTracks()[0];
  if (!videoTrack) throw new Error("Capture video track was lost.");

  const audioInputs = [
    ...(ready.displayStream ? [ready.displayStream] : []),
    ...(ready.micStream ? [ready.micStream] : []),
    ...(ready.mode === "camera" && ready.cameraStream
      ? [ready.cameraStream]
      : []),
  ];
  const mixedAudio = await createMixedAudio(audioInputs);

  const outputStream = new MediaStream([videoTrack, ...mixedAudio.tracks]);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(outputStream, {
    mimeType,
    // Crisp 1080p capture — matches the web/desktop recorders. Files upload
    // directly (no client-side shrink), so we favor sharpness over a budget.
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 128_000,
  });

  let resolveStopped: (result: UploadResult) => void = () => undefined;
  let rejectStopped: (error: Error) => void = () => undefined;
  const stopped = new Promise<UploadResult>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });

  const recording: ActiveRecording = {
    sessionId: ready.sessionId,
    recordingId: message.recordingId,
    uploadUrl: message.uploadUrl,
    authToken: message.authToken ?? null,
    mode: ready.mode,
    startedAtMs: 0,
    mimeType,
    recorder,
    outputStream,
    sourceStreams: [
      ...(ready.displayStream ? [ready.displayStream] : []),
      ...(ready.micStream ? [ready.micStream] : []),
      ...(ready.cameraStream ? [ready.cameraStream] : []),
    ],
    audioContext: mixedAudio.audioContext,
    chunkIndex: 0,
    uploadPromises: [],
    uploadFailure: null,
    cancelled: false,
    restarting: false,
    startTimer: null,
    dimensions: { width: ready.width, height: ready.height },
    hasAudio: outputStream.getAudioTracks().length > 0,
    hasCamera:
      typeof message.hasCamera === "boolean"
        ? message.hasCamera
        : ready.mode === "camera",
    stopped,
    resolveStopped,
    rejectStopped,
  };
  // The prepared streams are now owned by the active recording.
  prepared = null;
  activeRecording = recording;

  recorder.addEventListener("dataavailable", (event) => {
    if (
      recording.cancelled ||
      !event.data ||
      event.data.size === 0 ||
      recording.uploadFailure
    ) {
      return;
    }
    const index = recording.chunkIndex++;
    const upload = uploadChunk(recording, event.data, index).catch((err) => {
      recording.uploadFailure =
        err instanceof Error ? err : new Error(String(err));
      reportStatus(recording.sessionId, "error", {
        error: recording.uploadFailure.message,
      });
      if (recorder.state !== "inactive") recorder.stop();
      throw recording.uploadFailure;
    });
    recording.uploadPromises.push(upload);
  });

  recorder.addEventListener("stop", () => {
    void finalizeStop(recording);
  });

  // Run the pre-roll countdown here (reliable) then start the recorder. The
  // worker is told "recording" via reportStatus once it actually starts.
  const delay = Math.max(0, message.startDelayMs ?? 0);
  if (delay > 0) {
    recording.startTimer = setTimeout(() => {
      recording.startTimer = null;
      startRecorderNow(recording);
    }, delay);
  } else {
    startRecorderNow(recording);
  }

  return {
    ok: true,
    width: recording.dimensions.width,
    height: recording.dimensions.height,
    hasAudio: recording.hasAudio,
    hasCamera: recording.hasCamera,
  };
}

function startRecorderNow(recording: ActiveRecording): void {
  if (recording.cancelled) return;
  try {
    recording.recorder.start(2000);
    recording.startedAtMs = Date.now();
    reportStatus(recording.sessionId, "recording", {
      recordingId: recording.recordingId,
      width: recording.dimensions.width,
      height: recording.dimensions.height,
      hasAudio: recording.hasAudio,
      hasCamera: recording.hasCamera,
    });
  } catch (err) {
    reportStatus(recording.sessionId, "error", {
      recordingId: recording.recordingId,
      error: err instanceof Error ? err.message : "Could not start recording.",
    });
  }
}

async function finalizeStop(recording: ActiveRecording): Promise<void> {
  if (recording.restarting) {
    // restart() re-homes the source streams; do not stop or upload anything.
    return;
  }
  if (recording.cancelled) {
    cleanup(recording);
    if (activeRecording === recording) activeRecording = null;
    recording.resolveStopped({ ok: true, status: "cancelled" });
    return;
  }
  reportStatus(recording.sessionId, "uploading", {
    recordingId: recording.recordingId,
  });
  try {
    const settled = await Promise.allSettled(recording.uploadPromises);
    if (recording.uploadFailure) throw recording.uploadFailure;
    const rejected = settled.find(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    if (rejected) {
      throw rejected.reason instanceof Error
        ? rejected.reason
        : new Error(String(rejected.reason));
    }
    const durationMs = Math.max(0, Date.now() - recording.startedAtMs);
    const result = await uploadChunk(
      recording,
      new Blob([], { type: recording.mimeType }),
      recording.chunkIndex,
      {
        isFinal: true,
        total: recording.chunkIndex,
        durationMs,
        width: recording.dimensions.width,
        height: recording.dimensions.height,
        hasAudio: recording.hasAudio,
        hasCamera: recording.hasCamera,
      },
    );
    cleanup(recording);
    if (activeRecording === recording) activeRecording = null;
    reportStatus(recording.sessionId, "complete", {
      recordingId: recording.recordingId,
      result,
    });
    recording.resolveStopped(result);
  } catch (err) {
    cleanup(recording);
    if (activeRecording === recording) activeRecording = null;
    const error = err instanceof Error ? err : new Error(String(err));
    reportStatus(recording.sessionId, "error", {
      recordingId: recording.recordingId,
      error: error.message,
    });
    recording.rejectStopped(error);
  }
}

/* ------------------------------------------------------- pause/resume/stop --- */

function pause(message: SimpleMessage): { ok: boolean } {
  const recording = activeRecording;
  if (recording && recording.sessionId === message.sessionId) {
    if (recording.recorder.state === "recording") recording.recorder.pause();
    reportStatus(recording.sessionId, "paused", {
      recordingId: recording.recordingId,
    });
  }
  return { ok: true };
}

function resume(message: SimpleMessage): { ok: boolean } {
  const recording = activeRecording;
  if (recording && recording.sessionId === message.sessionId) {
    if (recording.recorder.state === "paused") recording.recorder.resume();
    reportStatus(recording.sessionId, "recording", {
      recordingId: recording.recordingId,
    });
  }
  return { ok: true };
}

async function stop(
  message: SimpleMessage,
): Promise<{ ok: boolean; result: UploadResult }> {
  const recording = activeRecording;
  if (!recording || recording.sessionId !== message.sessionId) {
    throw new Error("No active Clips recording was found.");
  }
  if (recording.startTimer !== null) {
    // Stopped during the pre-roll, before the recorder ever started: there is
    // nothing to save, so discard instead of hanging on `stopped`.
    clearTimeout(recording.startTimer);
    recording.startTimer = null;
    recording.cancelled = true;
    cleanup(recording);
    if (activeRecording === recording) activeRecording = null;
    return { ok: true, result: { ok: true, status: "cancelled" } };
  }
  if (recording.recorder.state !== "inactive") recording.recorder.stop();
  return { ok: true, result: await recording.stopped };
}

function cancel(message: SimpleMessage): { ok: boolean } {
  const recording = activeRecording;
  if (recording && recording.sessionId === message.sessionId) {
    recording.cancelled = true;
    if (recording.startTimer !== null) {
      clearTimeout(recording.startTimer);
      recording.startTimer = null;
    }
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    cleanup(recording);
    activeRecording = null;
  } else if (prepared && prepared.sessionId === message.sessionId) {
    stopPreparedStreams();
    disposePrepared();
  }
  return { ok: true };
}

// Skip the remaining pre-roll: start the recorder right now.
function startNow(message: SimpleMessage): { ok: boolean } {
  const recording = activeRecording;
  if (
    recording &&
    recording.sessionId === message.sessionId &&
    recording.startTimer !== null
  ) {
    clearTimeout(recording.startTimer);
    recording.startTimer = null;
    startRecorderNow(recording);
  }
  return { ok: true };
}

// Restart: discard the in-progress recording but keep the same source streams
// (so the user does not have to re-pick a screen), then re-home them into a
// prepared slot. A fresh recorder is built on the next BEGIN.
async function restart(
  message: SimpleMessage,
): Promise<{ ok: boolean; width: number; height: number }> {
  const recording = activeRecording;
  if (!recording || recording.sessionId !== message.sessionId) {
    throw new Error("No active Clips recording to restart.");
  }
  // restarting + cancelled => the stop handler returns early and the dataavailable
  // handler ignores the final flush, so the source tracks stay live.
  recording.restarting = true;
  recording.cancelled = true;
  if (recording.recorder.state !== "inactive") recording.recorder.stop();
  // Close only the old mixing context; keep the capture tracks alive.
  void recording.audioContext?.close().catch(() => undefined);
  activeRecording = null;

  const videoStream =
    recording.sourceStreams.find((s) => s.getVideoTracks().length) ?? null;
  const isCamera = recording.mode === "camera";
  prepared = {
    sessionId: recording.sessionId,
    mode: recording.mode,
    displayStream: isCamera ? null : videoStream,
    cameraStream: isCamera ? videoStream : null,
    micStream:
      recording.sourceStreams.find(
        (s) => s.getAudioTracks().length && s !== videoStream,
      ) ?? null,
    width: recording.dimensions.width,
    height: recording.dimensions.height,
    endedListener: null,
    endedTrack: null,
  };
  return {
    ok: true,
    width: recording.dimensions.width,
    height: recording.dimensions.height,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  let task: Promise<unknown> | null = null;
  switch (type) {
    case "CLIPS_OFFSCREEN_ACQUIRE":
      task = acquire(message as AcquireMessage);
      break;
    case "CLIPS_OFFSCREEN_BEGIN":
      task = begin(message as BeginMessage);
      break;
    case "CLIPS_OFFSCREEN_PAUSE":
      task = Promise.resolve(pause(message as SimpleMessage));
      break;
    case "CLIPS_OFFSCREEN_RESUME":
      task = Promise.resolve(resume(message as SimpleMessage));
      break;
    case "CLIPS_OFFSCREEN_STOP":
      task = stop(message as SimpleMessage);
      break;
    case "CLIPS_OFFSCREEN_CANCEL":
      task = Promise.resolve(cancel(message as SimpleMessage));
      break;
    case "CLIPS_OFFSCREEN_RESTART":
      task = restart(message as SimpleMessage);
      break;
    case "CLIPS_OFFSCREEN_START_NOW":
      task = Promise.resolve(startNow(message as SimpleMessage));
      break;
    default:
      return false;
  }

  void task.then(sendResponse).catch((err) =>
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : "Recording failed.",
    }),
  );
  return true;
});
