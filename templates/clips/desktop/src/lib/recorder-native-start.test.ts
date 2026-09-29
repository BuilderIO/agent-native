import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  emit: vi.fn(),
  transcribe: vi.fn(),
  prepareLocalExport: vi.fn(),
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
vi.mock("./local-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-export")>();
  return {
    ...actual,
    prepareLocalRecordingExport: mocks.prepareLocalExport,
  };
});

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

class TestMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }
}

class TestMediaRecorder {
  static isTypeSupported = vi.fn(() => true);

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  private eventListeners = new Map<string, Set<(event: Event) => void>>();
  start = vi.fn(() => {
    mediaRecorderStart();
    this.state = "recording";
  });
  stop = vi.fn(() => {
    if (emitStopChunk) {
      this.ondataavailable?.({
        data: new Blob(["clip"], { type: "video/webm" }),
      } as BlobEvent);
    }
    this.state = "inactive";
    for (const listener of this.eventListeners.get("stop") ?? []) {
      listener(new Event("stop"));
    }
  });
  pause = vi.fn(() => {
    this.state = "paused";
  });
  resume = vi.fn(() => {
    this.state = "recording";
  });
  requestData = vi.fn();
  addEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
    const listeners = this.eventListeners.get(type) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
  });
}

const mediaRecorderStart = vi.fn();
let emitStopChunk = false;

function installRecordingBackupStore() {
  const stores = new Set<string>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string) {
      stores.add(name);
      return { createIndex: vi.fn() };
    },
    transaction() {
      const tx: {
        error: null;
        oncomplete: (() => void) | null;
        onabort: (() => void) | null;
        onerror: (() => void) | null;
        objectStore: () => {
          put: ReturnType<typeof vi.fn>;
          delete: ReturnType<typeof vi.fn>;
          index: () => {
            openCursor: () => {
              result: null;
              onsuccess: (() => void) | null;
            };
          };
        };
      } = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore: () => ({
          put: vi.fn(),
          delete: vi.fn(),
          index: () => ({
            openCursor: () => {
              const request = {
                result: null,
                onsuccess: null as (() => void) | null,
              };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
          }),
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: vi.fn(),
  };
  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        result: database,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }),
  };
  vi.stubGlobal("indexedDB", indexedDB as unknown as IDBFactory);
  vi.stubGlobal("IDBKeyRange", { only: (key: string) => key });
}

function createLocalExport() {
  return {
    folderPath: "/recordings/test",
    start: vi.fn(),
    stop: vi.fn(async () => []),
    cancel: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

const localExports: ReturnType<typeof createLocalExport>[] = [];

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
  emitStopChunk = false;
  handlers.clear();
  nativeCommands.clear();
  getUserMedia = vi.fn(() => new Promise(() => {}));
  localExports.length = 0;
  mocks.prepareLocalExport.mockImplementation(async () => {
    const localExport = createLocalExport();
    localExports.push(localExport);
    return localExport;
  });
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
    if (name === "rewind_capture_suspension_acquire") {
      return { leaseId: null, suspendedRewind: false };
    }
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
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const requestBody = (
      typeof init?.body === "string" ? JSON.parse(init.body) : {}
    ) as {
      id?: string;
    };
    const isFinalChunk =
      url.includes("/chunk?") &&
      new URL(url).searchParams.get("isFinal") === "1";
    return new Response(
      JSON.stringify(
        url.endsWith("/create-recording")
          ? {
              result: {
                id: requestBody.id ?? `recording-${++nextRecordingId}`,
                uploadMode: "streaming",
              },
            }
          : isFinalChunk
            ? {
                ok: true,
                finalized: true,
                status: "ready",
                sourceSizeBytes: 4,
                durationMs: 100,
              }
            : {},
      ),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  mocks.transcribe.mockResolvedValue(capture());
});

function createdRecordingId() {
  const request = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/create-recording"),
  );
  return JSON.parse(String(request?.[1]?.body ?? "{}")).id as string;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  emitStopChunk = false;
});

describe("native recording startup", () => {
  it("starts the full countdown only after a slow overlay has presented", async () => {
    const overlay = deferred<number>();
    nativeCommands.set("show_countdown", async () => {
      const generation = await overlay.promise;
      setTimeout(() => {
        void mocks.emit("clips:countdown-done", { cause: "timer" });
      }, 3_600);
      return generation;
    });

    const pending = startRecording(params);
    await flush();
    expect(calls("show_countdown")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_500);
    overlay.resolve(1);
    await flush();
    await vi.advanceTimersByTimeAsync(3_600);

    const handle = await pending;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    await handle.cancel();
  });

  it("waits for the start cue before beginning native capture", async () => {
    const cue = deferred<void>();
    const playBeforeCapture = vi.fn(async () => cue.promise);
    const audioCue = { playBeforeCapture, cleanup: vi.fn() };

    const pending = startRecording(params, audioCue);
    await vi.advanceTimersByTimeAsync(3_600);
    await flush();
    expect(playBeforeCapture).toHaveBeenCalledOnce();
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);

    cue.resolve();
    const handle = await pending;
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    await handle.cancel();
  });

  it("does not activate Rewind capture when startup is aborted during the cue", async () => {
    nativeCommands.set("rewind_clip_status", async () => ({
      compatibility: "compatible",
      active: false,
    }));
    const cue = deferred<void>();
    const controller = new AbortController();
    const audioCue = {
      playBeforeCapture: vi.fn(async () => cue.promise),
      cleanup: vi.fn(),
    };
    const pending = startRecording(
      {
        ...params,
        source: "full-screen",
        localRecordingMode: "composed",
        signal: controller.signal,
      },
      audioCue,
    );
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(3_600);
    await flush();
    expect(audioCue.playBeforeCapture).toHaveBeenCalledOnce();

    controller.abort();
    await failed;
    cue.resolve();
    await flush();

    expect(calls("rewind_clip_start")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
  });

  it("fails cleanly when native countdown presentation stalls", async () => {
    const overlay = deferred<number>();
    nativeCommands.set("show_countdown", () => overlay.promise);

    const pending = startRecording(params);
    const failed = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;

    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_cancel").length).toBeGreaterThan(
      0,
    );

    overlay.resolve(1);
    await flush();
    expect(calls("finish_countdown_shortcuts")).toContainEqual([
      "finish_countdown_shortcuts",
      { generation: 1 },
    ]);
  });

  it("fails startup when the visible countdown never completes", async () => {
    nativeCommands.set("show_countdown", async () => 1);

    const pending = startRecording(params);
    const failed = expect(pending).rejects.toThrow(
      "timeout waiting for clips:countdown-done",
    );
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;

    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_cancel").length).toBeGreaterThan(
      0,
    );
  });

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

  it("aborts the known recording ID when the create response is lost", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));
    const pending = startRecording(params);
    const failed = expect(pending).rejects.toThrow("SERVER_UNAVAILABLE");

    await flush();
    await failed;

    const id = createdRecordingId();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/uploads/${id}/abort`),
      expect.objectContaining({
        body: expect.stringContaining('"failureCode":"upload_failed"'),
      }),
    );
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
  });

  it("marks native begin as requested before its IPC response arrives", async () => {
    const begin = deferred<void>();
    nativeCommands.set(
      "native_fullscreen_recording_begin",
      () => begin.promise,
    );
    const onCaptureStartRequested = vi.fn();
    const pending = startRecording({ ...params, onCaptureStartRequested });

    await vi.advanceTimersByTimeAsync(3_600);

    expect(calls("native_fullscreen_recording_begin")).toHaveLength(1);
    expect(onCaptureStartRequested).toHaveBeenCalledWith(createdRecordingId());

    begin.resolve();
    const handle = await pending;
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

  it("waits to show the countdown until the native warm invoke completes", async () => {
    const warm = deferred<void>();
    nativeCommands.set("native_fullscreen_recording_warm", () => warm.promise);
    const pending = startRecording(params);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls("show_countdown")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    warm.resolve();
    await flush();
    expect(calls("show_countdown")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_600);
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
    expect(calls("show_countdown")).toHaveLength(0);
    expect(calls("native_fullscreen_recording_begin")).toHaveLength(0);
    transcription.resolve(transcript);
    await flush();
    expect(calls("show_countdown")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_600);
    const handle = await pending;
    expect(transcript.cancel).not.toHaveBeenCalled();
    expect(transcript.resetTimeline).toHaveBeenCalledOnce();
    await handle.cancel();
    expect(transcript.cancel).toHaveBeenCalledOnce();
  });

  it("does not start transcription or begin after cancellation during warm", async () => {
    const warm = deferred<void>();
    nativeCommands.set("native_fullscreen_recording_warm", () => warm.promise);
    const controller = new AbortController();
    const pending = startRecording({ ...params, signal: controller.signal });
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await flush();
    expect(calls("show_countdown")).toHaveLength(0);
    controller.abort();
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

describe("browser recording startup cancellation", () => {
  function useBrowserCameraCapture() {
    const track = {
      kind: "video",
      readyState: "live",
      stop: vi.fn(),
      getSettings: () => ({ width: 1280, height: 720 }),
    } as unknown as MediaStreamTrack;
    getUserMedia.mockImplementation(
      async () => new TestMediaStream([track]) as unknown as MediaStream,
    );
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn() },
    });
    vi.stubGlobal("MediaStream", TestMediaStream);
    vi.stubGlobal("MediaRecorder", TestMediaRecorder);
    vi.stubGlobal("document", undefined);
    return track;
  }

  async function reachCue(playBeforeCapture: ReturnType<typeof vi.fn>) {
    await vi.advanceTimersByTimeAsync(3_600);
    await flush();
    expect(playBeforeCapture).toHaveBeenCalledOnce();
  }

  it("does not start local export after cancellation during the cue", async () => {
    useBrowserCameraCapture();
    const cue = deferred<void>();
    const controller = new AbortController();
    const audioCue = {
      playBeforeCapture: vi.fn(async () => cue.promise),
      cleanup: vi.fn(),
    };
    const pending = startRecording(
      {
        ...params,
        mode: "camera",
        cameraOn: true,
        micOn: false,
        systemAudioOn: false,
        localRecordingMode: "composed",
        signal: controller.signal,
      },
      audioCue,
    );

    await reachCue(audioCue.playBeforeCapture);
    await mocks.emit("clips:recorder-cancel");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    cue.resolve();
    await flush();

    expect(localExports).toHaveLength(1);
    expect(localExports[0].start).not.toHaveBeenCalled();
    expect(localExports[0].cancel).toHaveBeenCalledOnce();
    expect(audioCue.cleanup).toHaveBeenCalled();
  });

  it("retains cloud Cancel during the cue and skips MediaRecorder.start", async () => {
    useBrowserCameraCapture();
    const cue = deferred<void>();
    const audioCue = {
      playBeforeCapture: vi.fn(async () => cue.promise),
      cleanup: vi.fn(),
    };
    const pending = startRecording(
      {
        ...params,
        mode: "camera",
        cameraOn: true,
        micOn: false,
        systemAudioOn: false,
      },
      audioCue,
    );
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await reachCue(audioCue.playBeforeCapture);
    const id = createdRecordingId();
    await mocks.emit("clips:recorder-cancel");
    cue.resolve();
    await failed;
    await flush();

    expect(mediaRecorderStart).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/uploads/${id}/abort`),
      expect.objectContaining({
        body: expect.stringContaining('"failureCode":"user_cancelled"'),
      }),
    );
    expect(audioCue.cleanup).toHaveBeenCalled();
  });

  it("aborts a created row when cancelled before the create response arrives", async () => {
    useBrowserCameraCapture();
    const createResponse = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/create-recording")) return createResponse.promise;
      return new Response("{}", { status: 200 });
    });
    const controller = new AbortController();
    const pending = startRecording({
      ...params,
      mode: "camera",
      cameraOn: true,
      micOn: false,
      systemAudioOn: false,
      signal: controller.signal,
    });
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await flush();
    const id = createdRecordingId();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      id,
    });
    controller.abort();
    await failed;
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/uploads/${id}/abort`),
      expect.objectContaining({
        body: expect.stringContaining('"failureCode":"user_cancelled"'),
      }),
    );
    expect(mediaRecorderStart).not.toHaveBeenCalled();

    createResponse.resolve(
      new Response(
        JSON.stringify({ result: { id, uploadMode: "streaming" } }),
        { status: 200 },
      ),
    );
    await flush();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes(`/api/uploads/${id}/abort`),
      ),
    ).toHaveLength(2);
  });

  it("cancels startup when Stop arrives during the countdown", async () => {
    useBrowserCameraCapture();
    const playBeforeCapture = vi.fn(async () => {});
    const pending = startRecording(
      {
        ...params,
        mode: "camera",
        cameraOn: true,
        micOn: false,
        systemAudioOn: false,
      },
      { playBeforeCapture, cleanup: vi.fn() },
    );
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await flush();
    expect(calls("show_countdown")).toHaveLength(1);
    const id = createdRecordingId();
    await mocks.emit("clips:recorder-stop");
    await failed;

    expect(playBeforeCapture).not.toHaveBeenCalled();
    expect(mediaRecorderStart).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/uploads/${id}/abort`),
      expect.objectContaining({
        body: expect.stringContaining('"failureCode":"user_cancelled"'),
      }),
    );
  });

  it("cancels a live upload when Cancel arrives during transcription startup", async () => {
    useBrowserCameraCapture();
    const cue = deferred<void>();
    const transcription = deferred<TranscriptionCapture>();
    const transcript = capture();
    const audioCue = {
      playBeforeCapture: vi.fn(async () => cue.promise),
      cleanup: vi.fn(),
    };
    mocks.transcribe.mockReturnValueOnce(transcription.promise);
    const pending = startRecording(
      {
        ...params,
        mode: "camera",
        cameraOn: true,
        systemAudioOn: false,
      },
      audioCue,
    );
    const failed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await reachCue(audioCue.playBeforeCapture);
    cue.resolve();
    await flush();
    expect(mediaRecorderStart).toHaveBeenCalledOnce();
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    const id = createdRecordingId();

    await mocks.emit("clips:recorder-cancel");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/uploads/${id}/abort`),
      expect.objectContaining({
        body: expect.stringContaining('"failureCode":"user_cancelled"'),
      }),
    );

    transcription.resolve(transcript);
    await failed;
    await flush();
    expect(transcript.cancel).toHaveBeenCalledOnce();
    expect(audioCue.cleanup).toHaveBeenCalled();
  });

  it("returns the stopped handle when Stop arrives during transcription startup", async () => {
    useBrowserCameraCapture();
    installRecordingBackupStore();
    emitStopChunk = true;
    const cue = deferred<void>();
    const transcription = deferred<TranscriptionCapture>();
    const transcript = capture();
    const audioCue = {
      playBeforeCapture: vi.fn(async () => cue.promise),
      cleanup: vi.fn(),
    };
    mocks.transcribe.mockReturnValueOnce(transcription.promise);
    const pending = startRecording(
      {
        ...params,
        mode: "camera",
        cameraOn: true,
        systemAudioOn: false,
      },
      audioCue,
    );

    await reachCue(audioCue.playBeforeCapture);
    cue.resolve();
    await flush();
    expect(mediaRecorderStart).toHaveBeenCalledOnce();
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);

    await mocks.emit("clips:recorder-stop");
    transcription.resolve(transcript);
    const handle = await pending;
    const id = createdRecordingId();
    await expect(handle.stop()).resolves.toMatchObject({
      recordingId: id,
      viewUrl: `/r/${id}`,
    });
    expect(transcript.cancel).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        if (
          !String(url).includes("/api/uploads/") ||
          !String(url).includes("/chunk?")
        ) {
          return false;
        }
        const requestUrl = new URL(String(url));
        return (
          requestUrl.searchParams.get("isFinal") === "1" &&
          init?.method === "POST"
        );
      }),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url).includes("/api/uploads/") &&
          String(url).endsWith("/abort"),
      ),
    ).toBe(false);
  });
});
