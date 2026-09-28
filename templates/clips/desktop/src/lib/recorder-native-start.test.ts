import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  emit: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
  emit: mocks.emit,
}));
vi.mock("./audio-cue", () => ({
  createAudioCue: () => ({
    playBeforeCapture: async () => {},
    cleanup: () => {},
  }),
}));
vi.mock("./transcription-capture", () => ({
  startTranscriptionCapture: mocks.transcribe,
  shouldStartLocalRecordingTranscription: (enabled: boolean) => enabled,
}));

import { startRecording, type StartParams } from "./recorder";
import type { TranscriptionCapture } from "./transcription-capture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function capture(): TranscriptionCapture {
  return {
    stop: vi.fn(async () => ({ text: "", segments: [] })),
    cancel: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    resetTimeline: vi.fn(async () => {}),
  };
}

const params: StartParams = {
  serverUrl: "http://localhost:8080",
  mode: "screen",
  source: "window",
  micOn: true,
  cameraOn: false,
  micId: "webkit-selected-id",
  micLabel: "USB Microphone",
  preAcquiredCaptureSuspension: { leaseId: null, suspendedRewind: false },
};

const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
const nativeCommands = new Map<string, () => Promise<unknown>>();
let getUserMedia: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command);
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  handlers.clear();
  nativeCommands.clear();
  getUserMedia = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    mediaDevices: { getUserMedia, enumerateDevices: vi.fn() },
  });
  const storage = {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: storage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  mocks.listen.mockImplementation(async (name, callback) => {
    const callbacks = handlers.get(name) ?? new Set();
    callbacks.add(callback);
    handlers.set(name, callbacks);
    return () => callbacks.delete(callback);
  });
  mocks.emit.mockImplementation(async (name, payload) => {
    for (const handler of handlers.get(name) ?? []) handler({ payload });
  });
  mocks.invoke.mockImplementation(async (name) => {
    if (nativeCommands.has(name)) return nativeCommands.get(name)!();
    if (name === "show_countdown") {
      setTimeout(() => {
        void mocks.emit("clips:countdown-done", { cause: "timer" });
      }, 3_600);
      return 1;
    }
    if (name === "active_window_context") return { appName: "Example" };
    return undefined;
  });
  let nextRecordingId = 0;
  fetchMock = vi.fn(async (url: string) => {
    return new Response(
      JSON.stringify(
        url.endsWith("/create-recording")
          ? {
              result: {
                id: `recording-${++nextRecordingId}`,
                uploadMode: "streaming",
              },
            }
          : {},
      ),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  mocks.transcribe.mockResolvedValue(capture());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native recording startup", () => {
  it("creates and warms with the selected native mic while hidden WebKit cannot acquire audio", async () => {
    const pending = startRecording(params);
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_warm")[0][1]).toMatchObject({
      micDeviceId: params.micId,
      micDeviceLabel: params.micLabel,
      includeAudio: true,
    });
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await pending;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_begin")[0][1]).toMatchObject({
      micDeviceId: params.micId,
      micDeviceLabel: params.micLabel,
    });
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    await handle.cancel();
  });

  it("cleans up a failed server create and enables capture and toolbar on retry", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unavailable", { status: 503 }),
    );
    const first = startRecording(params);
    const failed = expect(first).rejects.toThrow("SERVER_UNAVAILABLE");
    await flush();
    await failed;
    expect(calls("native_fullscreen_recording_warm")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_cancel")).toHaveLength(1);
    expect(mocks.emit).not.toHaveBeenCalledWith("clips:toolbar-enabled", true);

    const retry = startRecording(params);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await retry;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    const commands = mocks.invoke.mock.calls.map(([name]) => name);
    expect(commands.indexOf("native_fullscreen_recording_cancel")).toBeLessThan(
      commands.indexOf("native_fullscreen_recording_warm"),
    );
    await handle.cancel();
  });

  it("keeps system-default mic selection unpinned", async () => {
    const pending = startRecording({
      ...params,
      micId: undefined,
      micLabel: undefined,
    });
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await pending;
    expect(calls("native_fullscreen_recording_begin")[0][1]).toMatchObject({
      micDeviceId: null,
      micDeviceLabel: null,
    });
    await handle.cancel();
  });

  it("preserves an explicit ID without a label and propagates native selection failure", async () => {
    const failure = new Error(
      "Selected microphone 'webkit-selected-id' is not available to ScreenCaptureKit.",
    );
    nativeCommands.set("native_fullscreen_recording_begin", async () => {
      throw failure;
    });
    const pending = startRecording({ ...params, micLabel: undefined });
    const failed = expect(pending).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(3_600);
    await failed;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(calls("native_fullscreen_recording_begin")[0][1]).toMatchObject({
      micDeviceId: params.micId,
      micDeviceLabel: null,
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does not begin or transcribe while a warm invoke outlives the old 2.5s timeout", async () => {
    const warm = deferred<void>();
    nativeCommands.set("native_fullscreen_recording_warm", () => warm.promise);
    const pending = startRecording(params);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    warm.resolve();
    const handle = await pending;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    await handle.cancel();
  });

  it("propagates warm failure without beginning a fallback capture", async () => {
    const failure = new Error("Selected microphone is unavailable");
    nativeCommands.set("native_fullscreen_recording_warm", async () => {
      throw failure;
    });
    const pending = startRecording(params);
    const failed = expect(pending).rejects.toBe(failure);
    await flush();
    await failed;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith("clips:toolbar-enabled", true);
  });

  it("waits for slow transcription and retains the capture instead of late-cancelling it", async () => {
    const transcription = deferred<TranscriptionCapture>();
    const transcript = capture();
    mocks.transcribe.mockReturnValueOnce(transcription.promise);
    const pending = startRecording(params);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    transcription.resolve(transcript);
    const handle = await pending;
    expect(transcript.cancel).not.toHaveBeenCalled();
    expect(transcript.resetTimeline).toHaveBeenCalledOnce();
    await handle.cancel();
    expect(transcript.cancel).toHaveBeenCalledOnce();
  });

  it("does not start transcription or begin after countdown cancellation during warm", async () => {
    const warm = deferred<void>();
    nativeCommands.set("native_fullscreen_recording_warm", () => warm.promise);
    const pending = startRecording(params);
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await flush();
    await mocks.emit("clips:countdown-cancel", { cause: "escape" });
    await flush();
    warm.resolve();
    await failed;
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_cancel").length).toBeGreaterThan(
      0,
    );
  });

  it("cancels transcription that resolves after startup abort and permits a later retry", async () => {
    const transcription = deferred<TranscriptionCapture>();
    const transcript = capture();
    mocks.transcribe.mockReturnValueOnce(transcription.promise);
    const controller = new AbortController();
    const first = startRecording({ ...params, signal: controller.signal });
    const failed = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    controller.abort();
    await failed;
    transcription.resolve(transcript);
    await flush();
    expect(transcript.cancel).toHaveBeenCalledOnce();
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    const second = startRecording(params);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await second;
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(transcript.cancel).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    expect(getUserMedia).not.toHaveBeenCalled();
    await handle.cancel();
  });

  it("permits retry after cancellation while the old begin invoke is still pending", async () => {
    const begin = deferred<void>();
    nativeCommands.set(
      "native_fullscreen_recording_begin",
      () => begin.promise,
    );
    const controller = new AbortController();
    const first = startRecording({ ...params, signal: controller.signal });
    const failed = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(3_600);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    controller.abort();
    await failed;
    await flush();
    expect(mocks.emit).not.toHaveBeenCalledWith("clips:toolbar-enabled", true);
    nativeCommands.delete("native_fullscreen_recording_begin");
    const second = startRecording(params);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await second;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(2);
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    begin.resolve();
    await flush();
    await handle.cancel();
  });

  it("keeps microphone-off local capture native and skips transcription", async () => {
    const pending = startRecording({
      ...params,
      micOn: false,
      localRecordingMode: "composed",
    });
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_begin")[0][1]).toMatchObject({
      includeAudio: false,
      captureSystemAudio: true,
      localOnly: true,
    });
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    await handle.cancel();
  });

  it("permits retry after the overall timeout while the original warm invoke remains pending", async () => {
    const warm = deferred<void>();
    nativeCommands.set("native_fullscreen_recording_warm", () => warm.promise);
    const pending = startRecording(params);
    const failed = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(90_000);
    await failed;
    await flush();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_cancel").length).toBeGreaterThan(
      0,
    );
    nativeCommands.delete("native_fullscreen_recording_warm");
    const retry = startRecording(params);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await retry;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(mocks.emit).toHaveBeenCalledWith("clips:toolbar-enabled", true);
    expect(getUserMedia).not.toHaveBeenCalled();
    const cancellationCount = calls(
      "native_fullscreen_recording_cancel",
    ).length;
    warm.resolve();
    await flush();
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(calls("native_fullscreen_recording_cancel")).toHaveLength(
      cancellationCount,
    );
    await handle.cancel();
  });
});
