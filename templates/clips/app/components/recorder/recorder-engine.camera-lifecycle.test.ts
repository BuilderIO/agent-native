import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CameraCaptureEndedError,
  NO_MIC_DEVICE_ID,
  type RecorderEngineOptions,
  type RecorderFinalizeResult,
  RecorderEngine,
  type RecordingMode,
} from "./recorder-engine";

class FakeVideoTrack extends EventTarget {
  readonly kind = "video";
  readyState: MediaStreamTrackState;
  readonly stop = vi.fn();

  constructor(readyState: MediaStreamTrackState = "live") {
    super();
    this.readyState = readyState;
  }

  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }

  getSettings(): MediaTrackSettings {
    return { width: 1280, height: 720 };
  }
}

class FakeMediaStream {
  private readonly tracks: FakeVideoTrack[];

  constructor(tracks: FakeVideoTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: FakeVideoTrack): void {
    this.tracks.push(track);
  }

  getVideoTracks(): FakeVideoTrack[] {
    return this.tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [];
  }

  getTracks(): FakeVideoTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType = "video/webm";
  state: RecordingState = "inactive";

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    const dataEvent = new Event("dataavailable");
    Object.defineProperty(dataEvent, "data", {
      value: new Blob(["camera footage"], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event("stop"));
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "recording";
  }
}

function installCaptureGlobals(options: {
  cameraStream: FakeMediaStream;
  displayStream?: FakeMediaStream;
}): void {
  vi.stubGlobal("window", {
    isSecureContext: true,
    location: { pathname: "/" },
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi.fn(async () => options.displayStream),
      getUserMedia: vi.fn(async () => options.cameraStream),
    },
  });
}

function makeEngine(
  mode: RecordingMode,
  options: Partial<RecorderEngineOptions> = {},
): RecorderEngine {
  const {
    recordingId = "__pending__",
    mode: selectedMode = mode,
    ...overrides
  } = options;
  return new RecorderEngine({
    recordingId,
    mode: selectedMode,
    micDeviceId: NO_MIC_DEVICE_ID,
    uploadUrl: "/upload",
    abortUrl: "",
    ...overrides,
  });
}

describe("RecorderEngine camera lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a camera-only stream whose video track already ended", async () => {
    const cameraTrack = new FakeVideoTrack("ended");
    installCaptureGlobals({
      cameraStream: new FakeMediaStream([cameraTrack]),
    });
    const engine = makeEngine("camera");

    await expect(engine.acquire()).rejects.toBeInstanceOf(
      CameraCaptureEndedError,
    );
    expect(engine.getCameraStream()).toBeNull();
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
  });

  it("fails loudly when the camera-only track ends during countdown", async () => {
    const cameraTrack = new FakeVideoTrack();
    const cameraStream = new FakeMediaStream([cameraTrack]);
    const onError = vi.fn();
    installCaptureGlobals({ cameraStream });
    const engine = makeEngine("camera", {
      recordingId: "__pending__",
      mode: "camera",
      onError,
    });

    await expect(engine.acquire()).resolves.toMatchObject({
      cameraStream,
    });
    cameraTrack.end();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(CameraCaptureEndedError);
    expect(engine.getState()).toBe("error");
    expect(engine.getCameraStream()).toBeNull();
  });

  it("revalidates the live camera track immediately before start", async () => {
    const cameraTrack = new FakeVideoTrack();
    installCaptureGlobals({
      cameraStream: new FakeMediaStream([cameraTrack]),
    });
    const engine = makeEngine("camera");

    await engine.acquire();
    cameraTrack.readyState = "ended";

    await expect(engine.start()).rejects.toBeInstanceOf(
      CameraCaptureEndedError,
    );
    expect(engine.getCameraStream()).toBeNull();
  });

  it("finalizes captured camera-only footage once when its track disconnects", async () => {
    const cameraTrack = new FakeVideoTrack();
    const cameraStream = new FakeMediaStream([cameraTrack]);
    installCaptureGlobals({ cameraStream });
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    let finalizePromise: Promise<RecorderFinalizeResult> | null = null;
    let engine!: RecorderEngine;
    const onRequiredVideoEnded = vi.fn(() => {
      finalizePromise = engine.stop();
    });
    engine = makeEngine("camera", {
      recordingId: "__pending__",
      mode: "camera",
      micDeviceId: NO_MIC_DEVICE_ID,
      uploadUrl: "/upload",
      abortUrl: "",
      onDisplayTrackEnded: onRequiredVideoEnded,
    });
    const uploadBlobInSlices = vi.fn(async () => ({ status: "processing" }));
    (
      engine as unknown as {
        uploadBlobInSlices: typeof uploadBlobInSlices;
      }
    ).uploadBlobInSlices = uploadBlobInSlices;

    await engine.acquire();
    await engine.start();
    cameraTrack.end();
    cameraTrack.end();

    expect(onRequiredVideoEnded).toHaveBeenCalledOnce();
    const result = await finalizePromise!;
    expect(result.hasCamera).toBe(true);
    expect(engine.getState()).toBe("complete");
    expect(uploadBlobInSlices).toHaveBeenCalledOnce();
    expect(engine.stop()).toBe(finalizePromise);
  });

  it("keeps screen capture running when its optional camera disconnects", async () => {
    const displayTrack = new FakeVideoTrack();
    const cameraTrack = new FakeVideoTrack();
    const displayStream = new FakeMediaStream([displayTrack]);
    const cameraStream = new FakeMediaStream([cameraTrack]);
    const onWarning = vi.fn();
    const onCameraEnded = vi.fn();
    const onRequiredVideoEnded = vi.fn();
    installCaptureGlobals({ cameraStream, displayStream });
    vi.stubGlobal(
      "AudioContext",
      class {
        close(): Promise<void> {
          return Promise.resolve();
        }
      },
    );
    const engine = makeEngine("screen+camera", {
      recordingId: "__pending__",
      mode: "screen+camera",
      micDeviceId: NO_MIC_DEVICE_ID,
      abortUrl: "",
      onWarning,
      onCameraEnded,
      onDisplayTrackEnded: onRequiredVideoEnded,
    });
    await engine.acquire();
    (
      engine as unknown as {
        state: "recording";
      }
    ).state = "recording";
    cameraTrack.end();

    expect(engine.getState()).toBe("recording");
    expect(engine.getCameraStream()).toBeNull();
    expect(onCameraEnded).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith(
      "Camera disconnected — recording continues without webcam.",
    );
    expect(onRequiredVideoEnded).not.toHaveBeenCalled();
    await engine.cancel();
  });
});
