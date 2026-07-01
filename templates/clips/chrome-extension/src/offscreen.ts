// Offscreen recording engine (Loom-style, MV3).
//
// This document holds the getDisplayMedia()/getUserMedia() stream and the
// MediaRecorder. Living in an offscreen document (reason DISPLAY_MEDIA) is what
// lets a recording survive page navigations — the capture is decoupled from any
// tab. Controls render as on-page overlays. For SCREEN+CAMERA we capture the
// camera HERE and composite it (canvas) into the recording, because the on-page
// bubble can't get the camera on pages that send `Permissions-Policy: camera=()`
// (an iframe can't escape its parent's policy). Screen-only records the display
// directly; camera-only records the webcam directly.
//
// Lifecycle: ACQUIRE (show picker, hold stream) → BEGIN (start recorder after
// the countdown) → PAUSE/RESUME → STOP/CANCEL, plus RESTART (discard and start
// over on the same stream).
//
// MIME selection and the chunk-upload URL/param protocol are shared with the web
// app recorder via @shared/recording-core so the server contract can't drift.

import { scheduleReadyChime } from "@shared/recording-audio";
import {
  chunkUploadUrl,
  pickMimeType,
  type UploadMode,
} from "@shared/recording-core";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits";

import { waitForReadyRecordingAfterFinalizeError } from "./finalize-recovery";
import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("offscreen");

const STORAGE_SETUP_REQUIRED_MESSAGE =
  "Connect storage to finish saving this clip: Builder.io (free tier storage + AI) or S3-compatible storage.";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|connect builder|s3-compatible/i;

function isStorageSetupFailureMessage(message: string | null | undefined) {
  return STORAGE_SETUP_FAILURE_RE.test(message ?? "");
}

function isFinalUploadRecoveryCandidate(error: Error): boolean {
  const tagged = error as {
    finalUpload?: boolean;
    status?: number;
    storageSetupRequired?: boolean;
  };
  if (!tagged.finalUpload || tagged.storageSetupRequired) return false;
  if (tagged.status === 413) return false;
  return !/too large|exceeds.*limit|chunk too large/i.test(error.message);
}

type CaptureMode = "screen" | "camera";

type AcquireMessage = {
  type: "CLIPS_OFFSCREEN_ACQUIRE";
  sessionId: string;
  mode: CaptureMode;
  surface: "browser" | "window" | "monitor";
  includeMicrophone: boolean;
  // Screen+camera: capture the camera here and composite it into the recording
  // (the on-page bubble can be blocked by the page's Permissions-Policy).
  includeCamera: boolean;
};

type BeginMessage = {
  type: "CLIPS_OFFSCREEN_BEGIN";
  sessionId: string;
  recordingId: string;
  uploadUrl: string;
  uploadMode?: UploadMode;
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
  finalized?: boolean;
  recoveredAfterFinalizeError?: boolean;
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
  uploadMode: UploadMode;
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
  // Local safety buffer: every recorded blob is kept here (browser-managed,
  // disk-backed Blob refs — not raw heap) so that if the upload fails (storage
  // not connected, network drop, size cap) we can still save the finished
  // recording to disk instead of losing it. Mirrors the web/desktop recorders.
  recordedBlobs: Blob[];
  recordedBytes: number;
  // Set if the recording grew past the buffer ceiling and we stopped retaining
  // — at that point a local save can't be guaranteed, so we don't promise one.
  localBufferOverflow: boolean;
  pendingStreamBlobs: Blob[];
  pendingStreamBytes: number;
  cancelled: boolean;
  // Set when the recorder is being torn down to start over on the same source
  // streams, so the stop handler skips the usual track cleanup.
  restarting: boolean;
  // Pending pre-roll timer; non-null means the recorder hasn't started yet.
  startTimer: ReturnType<typeof setTimeout> | null;
  // Canvas compositor draw loop (screen+camera only); stop it on teardown.
  stopCompositor: (() => void) | null;
  // Original capture streams, kept distinct so restart can re-home exactly the
  // right ones (sourceStreams also holds the derived canvas stream).
  displaySource: MediaStream | null;
  cameraSource: MediaStream | null;
  micSource: MediaStream | null;
  dimensions: { width: number; height: number };
  hasAudio: boolean;
  hasCamera: boolean;
  stopped: Promise<UploadResult>;
  resolveStopped: (result: UploadResult) => void;
  rejectStopped: (error: Error) => void;
};

const GCS_CHUNK_ALIGN_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 15 * GCS_CHUNK_ALIGN_BYTES; // 3.75 MiB
const UPLOAD_SLICE_BYTES = 3 * 1024 * 1024;

// Don't retain more than the upload ceiling — past it the server rejects the
// recording anyway, so there is nothing a local save could recover.
const MAX_LOCAL_BUFFER_BYTES = MAX_UPLOAD_BYTES;
// Below this, a failed recording is too short to be worth dumping a file into
// the user's Downloads (e.g. the storage gate was bypassed and the very first
// chunk was rejected ~2s in). The connect-storage message is enough there.
const MIN_LOCAL_SAVE_BYTES = 2 * 1024 * 1024;

let prepared: PreparedStreams | null = null;
let activeRecording: ActiveRecording | null = null;
// Blob URLs handed to the background for save-to-disk recovery downloads. Kept
// alive until the next recording starts so the download can finish reading.
const pendingSaveUrls = new Set<string>();

function releasePendingSaveUrls(): void {
  for (const url of pendingSaveUrls) URL.revokeObjectURL(url);
  pendingSaveUrls.clear();
}

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

// The user's chosen camera/mic devices (set in the popup, saved to storage).
async function readDeviceIds(): Promise<{ video: string; audio: string }> {
  try {
    const v = await chrome.storage.sync.get(["videoDeviceId", "audioDeviceId"]);
    return {
      video: typeof v.videoDeviceId === "string" ? v.videoDeviceId : "",
      audio: typeof v.audioDeviceId === "string" ? v.audioDeviceId : "",
    };
  } catch {
    return { video: "", audio: "" };
  }
}

function cameraConstraints(deviceId: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  if (deviceId) base.deviceId = { exact: deviceId };
  else base.facingMode = "user";
  return base;
}

async function getMicStream(deviceId: string): Promise<MediaStream | null> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch {
    return null;
  }
}

/* ----------------------------------------------------- camera compositing --- */

// On many pages the on-page camera bubble can't run (the page sets
// `Permissions-Policy: camera=()`, which an iframe cannot escape). So for
// screen+camera we capture the camera HERE in the offscreen document (extension
// origin — always allowed) and draw it into a canvas on top of the screen, then
// record the canvas. The face ends up in the video on every page.

async function readyVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await waitForMetadata(video).catch(() => undefined);
  await video.play().catch(() => undefined);
  return video;
}

function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  camera: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): void {
  const size = Math.round(Math.min(canvas.width, canvas.height) * 0.22);
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.035);
  const cx = margin + size / 2;
  const cy = canvas.height - margin - size / 2;
  const r = size / 2;
  const vw = camera.videoWidth || size;
  const vh = camera.videoHeight || size;
  const scale = Math.max(size / vw, size / vh);
  const dw = vw * scale;
  const dh = vh * scale;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  // Mirror the camera horizontally to match how people expect to see themselves.
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(camera, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, Math.round(size * 0.03));
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.stroke();
  ctx.restore();
}

type Compositor = {
  videoTrack: MediaStreamTrack;
  canvasStream: MediaStream;
  stop: () => void;
};

async function buildCompositor(
  displayStream: MediaStream,
  cameraStream: MediaStream,
  dims: { width: number; height: number },
): Promise<Compositor> {
  const displayVideo = await readyVideo(displayStream);
  const cameraVideo = await readyVideo(cameraStream);
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable for compositing.");

  let running = true;
  let raf = 0;
  const draw = () => {
    if (!running) return;
    ctx.drawImage(displayVideo, 0, 0, canvas.width, canvas.height);
    if (cameraVideo.readyState >= 2) drawCameraBubble(ctx, cameraVideo, canvas);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(30);
  return {
    videoTrack: canvasStream.getVideoTracks()[0],
    canvasStream,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      displayVideo.srcObject = null;
      cameraVideo.srcObject = null;
    },
  };
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
  const url = chunkUploadUrl(recording.uploadUrl, {
    index,
    total: extra.total,
    isFinal: extra.isFinal,
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
  let data: UploadResult = {};
  if (text) {
    try {
      data = JSON.parse(text) as UploadResult;
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    console.error(
      "[clips-offscreen] chunk upload failed",
      res.status,
      "hadAuth:",
      Boolean(recording.authToken),
      text.slice(0, 200),
    );
    const storageSetupRequired =
      data?.storageSetupRequired === true ||
      isStorageSetupFailureMessage(data?.error || text);
    const error = new Error(
      storageSetupRequired
        ? STORAGE_SETUP_REQUIRED_MESSAGE
        : data?.error ||
            `Upload failed (${res.status}): ${text || res.statusText}`,
    );
    const uploadError = error as {
      status?: number;
      storageSetupRequired?: boolean;
    };
    uploadError.status = res.status;
    uploadError.storageSetupRequired = storageSetupRequired;
    captureExtensionError(error, {
      tags: {
        surface: "offscreen",
        recordingStep: "chunk-upload",
        httpStatus: String(res.status),
        isFinal: extra.isFinal ? "true" : "false",
      },
      extra: {
        recordingId: recording.recordingId,
        chunkIndex: index,
        chunkBytes: blob.size,
        total: extra.total,
        mimeType: blob.type || recording.mimeType,
        responseBodyTail: text.slice(0, 2000),
        hadAuth: Boolean(recording.authToken),
      },
    });
    throw error;
  }
  return data;
}

function uploadAbortUrl(uploadUrl: string): string | null {
  try {
    const url = new URL(uploadUrl);
    url.pathname = url.pathname.replace(/\/chunk$/, "/abort");
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function abortServerUpload(
  recording: ActiveRecording,
  reason: string,
): Promise<void> {
  const url = uploadAbortUrl(recording.uploadUrl);
  if (!url) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Native-Frontend": "1",
  };
  if (recording.authToken) {
    headers.Authorization = `Bearer ${recording.authToken}`;
  }
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller
    ? window.setTimeout(() => controller.abort(), 4_000)
    : undefined;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ reason }),
      signal: controller?.signal,
    });
    if (!response.ok) {
      console.warn(
        "[clips-offscreen] abort upload returned",
        response.status,
        await response.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.warn("[clips-offscreen] abort upload failed", err);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

// Keep a local copy of every recorded blob so a failed upload can still be
// saved to disk. Blob references are browser-managed (often disk-backed), so
// this is far cheaper than holding ArrayBuffers. We stop retaining past the
// upload ceiling (a larger recording can't be uploaded anyway).
function retainRecordedBlob(recording: ActiveRecording, blob: Blob): void {
  if (recording.localBufferOverflow) return;
  if (recording.recordedBytes + blob.size > MAX_LOCAL_BUFFER_BYTES) {
    recording.localBufferOverflow = true;
    return;
  }
  recording.recordedBlobs.push(blob);
  recording.recordedBytes += blob.size;
}

async function uploadBlobInSlices(
  recording: ActiveRecording,
  blob: Blob,
): Promise<void> {
  const totalSlices = Math.max(1, Math.ceil(blob.size / UPLOAD_SLICE_BYTES));
  for (let sliceIndex = 0; sliceIndex < totalSlices; sliceIndex += 1) {
    if (recording.cancelled || recording.uploadFailure) return;
    const start = sliceIndex * UPLOAD_SLICE_BYTES;
    const end = Math.min(start + UPLOAD_SLICE_BYTES, blob.size);
    const slice = blob.slice(start, end, blob.type || recording.mimeType);
    const index = recording.chunkIndex++;
    await uploadChunk(recording, slice, index);
  }
}

async function uploadStreamingBlob(
  recording: ActiveRecording,
  blob: Blob,
): Promise<void> {
  if (blob.size === 0) return;
  recording.pendingStreamBlobs.push(blob);
  recording.pendingStreamBytes += blob.size;

  while (recording.pendingStreamBytes >= STREAM_CHUNK_BYTES) {
    if (recording.cancelled || recording.uploadFailure) return;
    const combined = new Blob(recording.pendingStreamBlobs, {
      type: recording.mimeType,
    });
    const head = combined.slice(0, STREAM_CHUNK_BYTES, recording.mimeType);
    const tail = combined.slice(
      STREAM_CHUNK_BYTES,
      undefined,
      recording.mimeType,
    );
    recording.pendingStreamBlobs = tail.size > 0 ? [tail] : [];
    recording.pendingStreamBytes = tail.size;
    const index = recording.chunkIndex++;
    await uploadChunk(recording, head, index);
  }
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
  recording.stopCompositor?.();
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
  // A prior recording's recovery download has finished by now; free its URL.
  releasePendingSaveUrls();

  let displayStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let cameraStream: MediaStream | null = null;
  const devices = await readDeviceIds();

  if (message.mode === "camera") {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: cameraConstraints(devices.video),
      audio: message.includeMicrophone
        ? devices.audio
          ? { deviceId: { exact: devices.audio } }
          : true
        : false,
    });
  } else {
    // Native "Choose what to share" picker. This is the screenshot Steve showed.
    displayStream = await navigator.mediaDevices.getDisplayMedia(
      displayConstraints(message.surface),
    );
    if (message.includeMicrophone)
      micStream = await getMicStream(devices.audio);
    // The screen+camera face comes from the on-page bubble (captured in the
    // display pixels), NOT composited here: canvas/requestAnimationFrame does
    // not run in a hidden offscreen document, so compositing produced an empty
    // recording ("No chunks found"). We record the display stream directly.
    void message.includeCamera;
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
  const directVideoTrack = videoStream?.getVideoTracks()[0];
  if (!directVideoTrack) throw new Error("Capture video track was lost.");

  // Screen + camera → composite the camera bubble into a canvas and record that,
  // so the face is in the video even on pages that block the on-page bubble.
  let compositor: Compositor | null = null;
  let videoTrack = directVideoTrack;
  if (ready.displayStream && ready.cameraStream) {
    compositor = await buildCompositor(
      ready.displayStream,
      ready.cameraStream,
      {
        width: ready.width,
        height: ready.height,
      },
    );
    videoTrack = compositor.videoTrack;
  }

  const audioInputs = [
    ...(ready.displayStream ? [ready.displayStream] : []),
    ...(ready.micStream ? [ready.micStream] : []),
    ...(ready.mode === "camera" && ready.cameraStream
      ? [ready.cameraStream]
      : []),
  ];
  const mixedAudio = await createMixedAudio(audioInputs);

  const outputStream = new MediaStream([videoTrack, ...mixedAudio.tracks]);
  const mimeType = pickMimeType() || "video/webm";
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
    uploadMode: message.uploadMode ?? "buffered",
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
      ...(compositor ? [compositor.canvasStream] : []),
    ],
    audioContext: mixedAudio.audioContext,
    chunkIndex: 0,
    uploadPromises: [],
    uploadFailure: null,
    recordedBlobs: [],
    recordedBytes: 0,
    localBufferOverflow: false,
    pendingStreamBlobs: [],
    pendingStreamBytes: 0,
    cancelled: false,
    restarting: false,
    startTimer: null,
    stopCompositor: compositor?.stop ?? null,
    displaySource: ready.displayStream,
    cameraSource: ready.cameraStream,
    micSource: ready.micStream,
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
    if (recording.cancelled || !event.data || event.data.size === 0) {
      return;
    }
    // Always keep a local copy first — even after an upload failure — so the
    // saved-to-disk fallback can assemble the COMPLETE recording. Without this,
    // a recording whose upload is rejected (storage disconnected, network drop,
    // size cap) would be lost; the extension has no other on-disk copy.
    retainRecordedBlob(recording, event.data);
    if (recording.uploadFailure) return;
    // Record the failure and stop, but do NOT re-throw: re-throwing leaves a
    // rejected promise that surfaces as an "Uncaught (in promise)" error (bad
    // look in a Chrome Web Store review). finalizeStop reads recording.upload-
    // Failure and surfaces it through the normal error path instead.
    const upload = (
      recording.uploadMode === "streaming"
        ? uploadStreamingBlob(recording, event.data)
        : uploadBlobInSlices(recording, event.data)
    ).catch((err) => {
      recording.uploadFailure =
        err instanceof Error ? err : new Error(String(err));
      captureExtensionError(recording.uploadFailure, {
        tags: {
          surface: "offscreen",
          recordingStep: "dataavailable-upload",
        },
        extra: {
          recordingId: recording.recordingId,
          blobBytes: event.data.size,
          chunkIndex: recording.chunkIndex,
          mimeType: event.data.type || recording.mimeType,
        },
      });
      reportStatus(recording.sessionId, "error", {
        error: recording.uploadFailure.message,
      });
      if (recorder.state !== "inactive") recorder.stop();
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

// The canonical Clips "ready" chime when recording starts — shared with the web
// app recorder (and matching the desktop app) so every surface sounds the same.
function playStartChime(): void {
  try {
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    void scheduleReadyChime(ctx).finally(() => {
      void ctx.close().catch(() => undefined);
    });
  } catch {
    /* audio unavailable */
  }
}

function startRecorderNow(recording: ActiveRecording): void {
  if (recording.cancelled) return;
  try {
    // Chime first (on "Go") so it mostly lands before the recording begins.
    playStartChime();
    recording.recorder.start(2000);
    recording.startedAtMs = Date.now();
    console.log("[clips-offscreen] recorder.start ok");
    reportStatus(recording.sessionId, "recording", {
      recordingId: recording.recordingId,
      width: recording.dimensions.width,
      height: recording.dimensions.height,
      hasAudio: recording.hasAudio,
      hasCamera: recording.hasCamera,
    });
  } catch (err) {
    captureExtensionError(err, {
      tags: {
        surface: "offscreen",
        recordingStep: "recorder-start",
      },
      extra: {
        recordingId: recording.recordingId,
        mimeType: recording.mimeType,
        width: recording.dimensions.width,
        height: recording.dimensions.height,
        hasAudio: recording.hasAudio,
        hasCamera: recording.hasCamera,
      },
    });
    reportStatus(recording.sessionId, "error", {
      recordingId: recording.recordingId,
      error: err instanceof Error ? err.message : "Could not start recording.",
    });
  }
}

function recordingDownloadFilename(recording: ActiveRecording): string {
  const ext = /mp4/i.test(recording.mimeType) ? "mp4" : "webm";
  const stamp = new Date(recording.startedAtMs || Date.now())
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return `clip-${stamp}.${ext}`;
}

// Last-resort recovery: if a finished recording can't be uploaded, save the
// locally-buffered bytes to the user's Downloads so the recording is never
// lost. The offscreen document can't call chrome.downloads, so it hands the
// background a blob URL to download. The URL is revoked on the next acquire().
async function saveRecordingToDisk(
  recording: ActiveRecording,
): Promise<{ savedToDisk: boolean; savedFilename?: string }> {
  if (
    recording.cancelled ||
    recording.localBufferOverflow ||
    recording.recordedBlobs.length === 0 ||
    recording.recordedBytes < MIN_LOCAL_SAVE_BYTES
  ) {
    return { savedToDisk: false };
  }
  try {
    const blob = new Blob(recording.recordedBlobs, {
      type: recording.mimeType,
    });
    const objectUrl = URL.createObjectURL(blob);
    pendingSaveUrls.add(objectUrl);
    const filename = recordingDownloadFilename(recording);
    const response = (await chrome.runtime.sendMessage({
      type: "CLIPS_SAVE_RECORDING_TO_DISK",
      sessionId: recording.sessionId,
      url: objectUrl,
      filename,
    })) as { ok?: boolean } | undefined;
    if (response?.ok) return { savedToDisk: true, savedFilename: filename };
    // The download was not accepted — drop the URL we just created.
    pendingSaveUrls.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
    return { savedToDisk: false };
  } catch (err) {
    captureExtensionError(err, {
      tags: { surface: "offscreen", recordingStep: "save-to-disk" },
      extra: {
        recordingId: recording.recordingId,
        bytes: recording.recordedBytes,
      },
    });
    return { savedToDisk: false };
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
    // Surface WHY a finalize might fail before the server's cryptic "No chunks
    // found": 0 chunks means the recorder emitted no non-empty data (empty
    // capture / never started), which is a different problem than an auth 401.
    if (recording.chunkIndex === 0) {
      console.warn(
        "[clips-offscreen] finalizing with 0 chunks — empty recording.",
        "recorderStarted:",
        recording.startedAtMs > 0,
        "durationMs:",
        durationMs,
        "hadAuth:",
        Boolean(recording.authToken),
      );
    } else {
      console.log(
        "[clips-offscreen] finalizing",
        recording.chunkIndex,
        "chunk(s), durationMs:",
        durationMs,
      );
    }
    let result: UploadResult;
    try {
      const finalBlob =
        recording.uploadMode === "streaming"
          ? new Blob(recording.pendingStreamBlobs, { type: recording.mimeType })
          : new Blob([], { type: recording.mimeType });
      recording.pendingStreamBlobs = [];
      recording.pendingStreamBytes = 0;
      const finalIndex = recording.chunkIndex;
      result = await uploadChunk(recording, finalBlob, finalIndex, {
        isFinal: true,
        total: finalIndex + (finalBlob.size > 0 ? 1 : 0),
        durationMs,
        width: recording.dimensions.width,
        height: recording.dimensions.height,
        hasAudio: recording.hasAudio,
        hasCamera: recording.hasCamera,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      (error as { finalUpload?: boolean }).finalUpload = true;
      throw error;
    }
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

    if (isFinalUploadRecoveryCandidate(error)) {
      const recovered = await waitForReadyRecordingAfterFinalizeError({
        uploadUrl: recording.uploadUrl,
        recordingId: recording.recordingId,
        authToken: recording.authToken,
      });
      if (recovered) {
        console.warn(
          "[clips-offscreen] final upload looked failed, but the recording is ready; treating as saved.",
          {
            recordingId: recording.recordingId,
            originalError: error.message,
          },
        );
        reportStatus(recording.sessionId, "complete", {
          recordingId: recording.recordingId,
          result: recovered,
        });
        recording.resolveStopped(recovered);
        return;
      }
    }

    captureExtensionError(error, {
      tags: {
        surface: "offscreen",
        recordingStep: "finalize-stop",
      },
      extra: {
        recordingId: recording.recordingId,
        chunkCount: recording.chunkIndex,
        mimeType: recording.mimeType,
        durationMs: Math.max(0, Date.now() - recording.startedAtMs),
      },
    });
    // The upload failed — save the buffered recording to disk so it isn't lost.
    const saved = await saveRecordingToDisk(recording);
    if (!(error as { storageSetupRequired?: boolean }).storageSetupRequired) {
      await abortServerUpload(recording, error.message);
    }
    reportStatus(recording.sessionId, "error", {
      recordingId: recording.recordingId,
      error: error.message,
      storageSetupRequired: (error as { storageSetupRequired?: boolean })
        .storageSetupRequired,
      savedToDisk: saved.savedToDisk,
      savedFilename: saved.savedFilename,
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
  // Tear down the old compositor + mixing context; keep the capture tracks alive
  // so the next BEGIN can build a fresh compositor/recorder on the same streams.
  recording.stopCompositor?.();
  void recording.audioContext?.close().catch(() => undefined);
  activeRecording = null;

  prepared = {
    sessionId: recording.sessionId,
    mode: recording.mode,
    displayStream: recording.displaySource,
    cameraStream: recording.cameraSource,
    micStream: recording.micSource,
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
