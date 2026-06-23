type CaptureSurface = "browser" | "window" | "monitor" | "camera";

type OffscreenStartMessage = {
  type: "CLIPS_OFFSCREEN_START";
  sessionId: string;
  recordingId: string;
  uploadUrl: string;
  streamId?: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  title?: string | null;
};

type OffscreenStopMessage = {
  type: "CLIPS_OFFSCREEN_STOP";
  sessionId: string;
};

type OffscreenCancelMessage = {
  type: "CLIPS_OFFSCREEN_CANCEL";
  sessionId: string;
};

type StatusName = "recording" | "uploading" | "complete" | "error";

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

type ActiveRecording = {
  sessionId: string;
  recordingId: string;
  uploadUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  startedAtMs: number;
  mimeType: string;
  recorder: MediaRecorder;
  outputStream: MediaStream;
  sourceStreams: MediaStream[];
  canvas: HTMLCanvasElement;
  canvasStream: MediaStream;
  audioContext: AudioContext | null;
  frameRequestId: number | null;
  chunkIndex: number;
  uploadPromises: Promise<unknown>[];
  uploadFailure: Error | null;
  cancelled: boolean;
  dimensions: { width: number; height: number };
  hasAudio: boolean;
  hasCamera: boolean;
  stopped: Promise<UploadResult>;
  resolveStopped: (result: UploadResult) => void;
  rejectStopped: (error: Error) => void;
};

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

async function makeVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await waitForMetadata(video);
  await video.play();
  return video;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    video,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): void {
  const size = Math.max(
    148,
    Math.round(Math.min(canvas.width, canvas.height) * 0.2),
  );
  const margin = Math.max(
    24,
    Math.round(Math.min(canvas.width, canvas.height) * 0.035),
  );
  const x = margin;
  const y = canvas.height - size - margin;
  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
  ctx.shadowBlur = Math.round(size * 0.08);
  ctx.shadowOffsetY = Math.round(size * 0.035);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 4, 0, Math.PI * 2);
  ctx.clip();
  drawCover(ctx, video, x + 4, y + 4, size - 8, size - 8);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function startDrawing(params: {
  canvas: HTMLCanvasElement;
  sourceVideo: HTMLVideoElement | null;
  cameraVideo: HTMLVideoElement | null;
}): number {
  const ctx = params.canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable.");

  const draw = () => {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, params.canvas.width, params.canvas.height);

    if (params.sourceVideo) {
      drawCover(
        ctx,
        params.sourceVideo,
        0,
        0,
        params.canvas.width,
        params.canvas.height,
      );
    } else if (params.cameraVideo) {
      drawCover(
        ctx,
        params.cameraVideo,
        0,
        0,
        params.canvas.width,
        params.canvas.height,
      );
    }

    if (params.sourceVideo && params.cameraVideo) {
      drawCameraBubble(ctx, params.cameraVideo, params.canvas);
    }

    const recording = activeRecording;
    if (recording && recording.frameRequestId !== null) {
      recording.frameRequestId = requestAnimationFrame(draw);
    }
  };

  return requestAnimationFrame(draw);
}

function tabMediaConstraints(streamId: string): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  } as unknown as MediaStreamConstraints;
}

async function getTabStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(tabMediaConstraints(streamId));
}

async function getCameraStream(
  includeVideo: boolean,
  includeAudio: boolean,
): Promise<MediaStream | null> {
  if (!includeVideo && !includeAudio) return null;
  return navigator.mediaDevices.getUserMedia({
    video: includeVideo
      ? { width: { ideal: 1280 }, height: { ideal: 720 } }
      : false,
    audio: includeAudio,
  });
}

async function createMixedAudio(
  streams: MediaStream[],
  monitorStreams: MediaStream[],
): Promise<{ audioContext: AudioContext | null; tracks: MediaStreamTrack[] }> {
  const streamsWithAudio = streams.filter(
    (stream) => stream.getAudioTracks().length,
  );
  if (!streamsWithAudio.length) return { audioContext: null, tracks: [] };

  const audioContext = new AudioContext();
  await audioContext.resume().catch(() => undefined);
  const destination = audioContext.createMediaStreamDestination();

  for (const stream of streamsWithAudio) {
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(destination);
    if (monitorStreams.includes(stream)) {
      source.connect(audioContext.destination);
    }
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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || recording.mimeType,
    },
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

function cleanup(recording: ActiveRecording): void {
  if (recording.frameRequestId !== null) {
    cancelAnimationFrame(recording.frameRequestId);
    recording.frameRequestId = null;
  }
  for (const stream of [
    recording.outputStream,
    recording.canvasStream,
    ...recording.sourceStreams,
  ]) {
    for (const track of stream.getTracks()) track.stop();
  }
  void recording.audioContext?.close().catch(() => undefined);
}

async function startRecording(message: OffscreenStartMessage): Promise<{
  ok: boolean;
  recordingId: string;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
}> {
  if (activeRecording) {
    throw new Error("Clips is already recording.");
  }

  const tabStream =
    message.captureSurface === "browser" && message.streamId
      ? await getTabStream(message.streamId)
      : null;
  const wantsCamera =
    message.captureSurface === "camera" || message.includeCamera;
  const cameraStream = await getCameraStream(
    wantsCamera,
    message.includeMicrophone,
  );

  if (!tabStream && !cameraStream) {
    throw new Error("No media stream was available to record.");
  }

  const sourceVideo = tabStream ? await makeVideo(tabStream) : null;
  const cameraVideo = cameraStream?.getVideoTracks().length
    ? await makeVideo(cameraStream)
    : null;

  const width = sourceVideo?.videoWidth || cameraVideo?.videoWidth || 1280;
  const height = sourceVideo?.videoHeight || cameraVideo?.videoHeight || 720;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const canvasStream = canvas.captureStream(30);

  const audioStreams = [
    ...(tabStream ? [tabStream] : []),
    ...(cameraStream ? [cameraStream] : []),
  ];
  const monitorStreams = tabStream ? [tabStream] : [];
  const mixedAudio = await createMixedAudio(audioStreams, monitorStreams);

  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...mixedAudio.tracks,
  ]);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(outputStream, { mimeType });

  let resolveStopped: (result: UploadResult) => void = () => undefined;
  let rejectStopped: (error: Error) => void = () => undefined;
  const stopped = new Promise<UploadResult>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });

  const recording: ActiveRecording = {
    sessionId: message.sessionId,
    recordingId: message.recordingId,
    uploadUrl: message.uploadUrl,
    captureSurface: message.captureSurface,
    includeCamera: message.includeCamera,
    includeMicrophone: message.includeMicrophone,
    startedAtMs: Date.now(),
    mimeType,
    recorder,
    outputStream,
    sourceStreams: [
      ...(tabStream ? [tabStream] : []),
      ...(cameraStream ? [cameraStream] : []),
    ],
    canvas,
    canvasStream,
    audioContext: mixedAudio.audioContext,
    frameRequestId: null,
    chunkIndex: 0,
    uploadPromises: [],
    uploadFailure: null,
    cancelled: false,
    dimensions: { width, height },
    hasAudio: outputStream.getAudioTracks().length > 0,
    hasCamera: Boolean(cameraVideo),
    stopped,
    resolveStopped,
    rejectStopped,
  };
  activeRecording = recording;
  recording.frameRequestId = startDrawing({ canvas, sourceVideo, cameraVideo });

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
    void (async () => {
      if (recording.cancelled) {
        cleanup(recording);
        activeRecording = null;
        recording.resolveStopped({ ok: true, status: "cancelled" });
        return;
      }
      reportStatus(recording.sessionId, "uploading", {
        recordingId: recording.recordingId,
      });
      try {
        const settled = await Promise.allSettled(recording.uploadPromises);
        const rejected = settled.find(
          (item): item is PromiseRejectedResult => item.status === "rejected",
        );
        if (recording.uploadFailure) throw recording.uploadFailure;
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
        activeRecording = null;
        reportStatus(recording.sessionId, "complete", {
          recordingId: recording.recordingId,
          result,
        });
        recording.resolveStopped(result);
      } catch (err) {
        cleanup(recording);
        activeRecording = null;
        const error = err instanceof Error ? err : new Error(String(err));
        reportStatus(recording.sessionId, "error", {
          recordingId: recording.recordingId,
          error: error.message,
        });
        recording.rejectStopped(error);
      }
    })();
  });

  recorder.start(2000);
  reportStatus(recording.sessionId, "recording", {
    recordingId: recording.recordingId,
    width,
    height,
    hasAudio: recording.hasAudio,
    hasCamera: recording.hasCamera,
  });

  return {
    ok: true,
    recordingId: message.recordingId,
    width,
    height,
    hasAudio: recording.hasAudio,
    hasCamera: recording.hasCamera,
  };
}

async function stopRecording(
  message: OffscreenStopMessage,
): Promise<{ ok: boolean; result: UploadResult }> {
  const recording = activeRecording;
  if (!recording || recording.sessionId !== message.sessionId) {
    throw new Error("No active Clips recording was found.");
  }
  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }
  return { ok: true, result: await recording.stopped };
}

async function cancelRecording(
  message: OffscreenCancelMessage,
): Promise<{ ok: boolean }> {
  const recording = activeRecording;
  if (!recording || recording.sessionId !== message.sessionId) {
    return { ok: true };
  }
  recording.cancelled = true;
  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }
  cleanup(recording);
  activeRecording = null;
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (
    type !== "CLIPS_OFFSCREEN_START" &&
    type !== "CLIPS_OFFSCREEN_STOP" &&
    type !== "CLIPS_OFFSCREEN_CANCEL"
  ) {
    return false;
  }

  const task =
    type === "CLIPS_OFFSCREEN_START"
      ? startRecording(message as OffscreenStartMessage)
      : type === "CLIPS_OFFSCREEN_STOP"
        ? stopRecording(message as OffscreenStopMessage)
        : cancelRecording(message as OffscreenCancelMessage);

  void task.then(sendResponse).catch((err) =>
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : "Recording failed.",
    }),
  );
  return true;
});
