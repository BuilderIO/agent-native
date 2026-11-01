// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoicePolish } from "./voice-settings";

const tauri = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(event: { payload: unknown }) => void>
  >();
  return {
    listeners,
    events: [] as Array<{ name: string; payload: unknown }>,
    invoke: vi.fn((_command: string, _args?: unknown) =>
      Promise.resolve<unknown>(undefined),
    ),
    emit: vi.fn(async (name: string, payload: unknown) => {
      tauri.events.push({ name, payload });
      for (const listener of tauri.listeners.get(name) ?? []) {
        listener({ payload });
      }
    }),
    listen: vi.fn(
      async (name: string, listener: (event: { payload: unknown }) => void) => {
        const handlers = tauri.listeners.get(name) ?? new Set();
        handlers.add(listener);
        tauri.listeners.set(name, handlers);
        return () => handlers.delete(listener);
      },
    ),
    transcripts: {
      final: new Set<(event: Record<string, unknown>) => void>(),
      partial: new Set<(event: Record<string, unknown>) => void>(),
      error: new Set<(event: Record<string, unknown>) => void>(),
      level: new Set<(event: Record<string, unknown>) => void>(),
    },
  };
});

const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: tauri.emit,
  listen: tauri.listen,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboard);
vi.mock("./backtrack", () => ({ applyBacktrack: (text: string) => text }));
vi.mock("./personal-vocabulary", () => ({
  configureVocabularyClient: vi.fn(),
  currentVocabularyEntries: vi.fn(() => []),
  loadVocabulary: vi.fn(async () => []),
  loadVocabularyEntries: vi.fn(async () => []),
  recordPasteForLearn: vi.fn(),
}));
vi.mock("./transcription-engine", () => ({
  onAudioLevel: (callback: (event: Record<string, unknown>) => void) => {
    tauri.transcripts.level.add(callback);
    return Promise.resolve(() => tauri.transcripts.level.delete(callback));
  },
  onFinalTranscript: (callback: (event: Record<string, unknown>) => void) => {
    tauri.transcripts.final.add(callback);
    return Promise.resolve(() => tauri.transcripts.final.delete(callback));
  },
  onPartialTranscript: (callback: (event: Record<string, unknown>) => void) => {
    tauri.transcripts.partial.add(callback);
    return Promise.resolve(() => tauri.transcripts.partial.delete(callback));
  },
  onSpeechError: (callback: (event: Record<string, unknown>) => void) => {
    tauri.transcripts.error.add(callback);
    return Promise.resolve(() => tauri.transcripts.error.delete(callback));
  },
}));

class FakeRecorder {
  static isTypeSupported() {
    return true;
  }

  static instances: FakeRecorder[] = [];
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    FakeRecorder.instances.push(this);
  }

  start() {}
  stop() {}
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void | Promise<void>) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {}
  stop() {}
  abort() {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const dispatch = async (name: string, payload: unknown = {}) => {
  await tauri.emit(name, payload);
  await settle();
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value,
  });
}

function installMediaRecorder() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => []),
    },
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  return { stream, track };
}

function installAudioContext() {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "AudioContext",
  );
  class FakeAudioContext {
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    createAnalyser = vi.fn(() => ({
      fftSize: 0,
      getByteTimeDomainData: vi.fn(),
    }));
    close = vi.fn(async () => {});
  }

  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "AudioContext", previousDescriptor);
    } else {
      Reflect.deleteProperty(window, "AudioContext");
    }
  };
}

function stateChanges() {
  return tauri.events
    .filter((event) => event.name === "voice:state-change")
    .map((event) => event.payload as Record<string, unknown>);
}

// "server" is the built-in engine off a Mac with no browser speech, which
// falls back to server transcription.
async function startDictation(
  route: "server" | "browser" | "native" | "whisper" | "parakeet",
  polish: VoicePolish = "off",
) {
  if (route === "native" || route === "parakeet") setPlatform("MacIntel");
  const { installDesktopVoiceDictation } = await import("./voice-dictation");
  const dispose = installDesktopVoiceDictation({
    enabled: true,
    serverUrl: "https://clips.test",
    shortcut: "both",
    mode: "push-to-talk",
    engine: route === "whisper" || route === "parakeet" ? route : "native",
    polish,
  });
  await settle();
  await dispatch("voice:shortcut-start", { source: "fn" });
  const latestState = stateChanges()
    .reverse()
    .find((state) => typeof state.runId === "number");
  return { dispose, runId: latestState?.runId as number | undefined };
}

// How long the engines keep recording after the key comes up.
const RELEASE_TAIL_MS = 200;

// Parakeet's stop call returns the finished text instead of a final event.
function parakeetReturns(text: string) {
  tauri.invoke.mockImplementation((command, args) => {
    if (
      command === "audio_transcription_stop" &&
      !(args as { discard?: boolean } | undefined)?.discard
    ) {
      return Promise.resolve({
        voice: "heard",
        transcript: {
          text,
          pass: "live",
          releaseToTextMs: 120,
          audioMs: 2_000,
        },
      });
    }
    return Promise.resolve(
      command === "complete_voice_dictation" ? "inserted" : undefined,
    );
  });
}

function emitFinal(runId: number, text: string) {
  for (const callback of tauri.transcripts.final) {
    callback({ text, source: "mic", segments: [], runId });
  }
}

describe("desktop voice dictation runs", () => {
  let dispose: (() => void) | undefined;
  let restoreAudioContext: (() => void) | undefined;
  let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    tauri.listeners.clear();
    tauri.events.length = 0;
    tauri.invoke
      .mockReset()
      .mockImplementation((command) =>
        Promise.resolve(
          command === "complete_voice_dictation" ? "inserted" : undefined,
        ),
      );
    tauri.emit.mockClear();
    tauri.listen.mockClear();
    tauri.transcripts.final.clear();
    tauri.transcripts.partial.clear();
    tauri.transcripts.error.clear();
    tauri.transcripts.level.clear();
    clipboard.writeText.mockReset().mockResolvedValue(undefined);
    FakeRecorder.instances = [];
    FakeRecognition.instances = [];
    installMediaRecorder();
    setPlatform("Win32");
    Reflect.deleteProperty(window, "SpeechRecognition");
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("transcribe-voice")) {
        return jsonResponse({ text: "recognized words" });
      }
      if (url.includes("create-dictation")) {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({ id: body.id });
      }
      return jsonResponse({
        builder: false,
        gemini: false,
        groq: false,
        native: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    restoreAudioContext?.();
    restoreAudioContext = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "SpeechRecognition");
  });

  // Holds the key long enough to dictate, then lets the release tail run out.
  async function release() {
    await vi.advanceTimersByTimeAsync(501);
    await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 501 });
    await vi.advanceTimersByTimeAsync(RELEASE_TAIL_MS);
  }

  it.each(["server", "browser", "native", "whisper"] as const)(
    "finalizes a %s provider result through the shared lifecycle",
    async (kind) => {
      if (kind === "browser") {
        Object.defineProperty(window, "SpeechRecognition", {
          configurable: true,
          value: FakeRecognition,
        });
      }
      const started = await startDictation(kind);
      dispose = started.dispose;
      expect(started.runId).toEqual(expect.any(Number));

      if (kind === "server") {
        const recorder = FakeRecorder.instances[0];
        recorder.ondataavailable?.({ data: new Blob(["audio"]) });
        await release();
        await recorder.onstop?.();
      } else if (kind === "browser") {
        const recognition = FakeRecognition.instances[0];
        const result = Object.assign([{ transcript: "recognized words" }], {
          isFinal: true,
        });
        recognition.onresult?.({ results: [result] });
        recognition.onend?.();
      } else {
        await release();
        emitFinal(started.runId!, "recognized words");
        await vi.advanceTimersByTimeAsync(250);
      }
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
      expect(stateChanges().at(-1)).toMatchObject({
        state: "complete",
        insertion: "inserted",
        historySaved: true,
      });
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("create-dictation"),
        ),
      ).toBe(true);
    },
  );

  it("stops the browser audio meter when recognition start throws", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const startError = new Error("recognition start failed");
    const recognitionStart = vi
      .spyOn(FakeRecognition.prototype, "start")
      .mockImplementation(() => {
        throw startError;
      });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const started = await startDictation("browser");
    dispose = started.dispose;

    expect(recognitionStart).toHaveBeenCalledOnce();
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      runId: started.runId,
      failure: "provider",
    });
    expect(
      tauri.events.some(
        (event) =>
          event.name === "voice:audio-level" &&
          (event.payload as { level?: number; runId?: number }).level === 0 &&
          (event.payload as { level?: number; runId?: number }).runId ===
            started.runId,
      ),
    ).toBe(true);

    recognitionStart.mockRestore();
    consoleError.mockRestore();
  });

  it("stops the server audio meter when recorder start throws", async () => {
    restoreAudioContext = installAudioContext();
    const { track } = installMediaRecorder();
    const startError = new Error("recorder start failed");
    const recorderStart = vi
      .spyOn(FakeRecorder.prototype, "start")
      .mockImplementation(() => {
        throw startError;
      });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const started = await startDictation("server");
    dispose = started.dispose;

    expect(recorderStart).toHaveBeenCalledOnce();
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      runId: started.runId,
      failure: "microphone-unavailable",
    });
    expect(
      tauri.events.some(
        (event) =>
          event.name === "voice:audio-level" &&
          (event.payload as { level?: number; runId?: number }).level === 0 &&
          (event.payload as { level?: number; runId?: number }).runId ===
            started.runId,
      ),
    ).toBe(true);

    recorderStart.mockRestore();
    consoleError.mockRestore();
  });

  it("re-shows the active processing status when another press is rejected", async () => {
    let resolveInsertion!: (result: unknown) => void;
    tauri.invoke.mockImplementation((command) => {
      if (command === "complete_voice_dictation") {
        return new Promise((resolve) => {
          resolveInsertion = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const started = await startDictation("server");
    dispose = started.dispose;
    const recorder = FakeRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["audio"]) });
    await release();
    void recorder.onstop?.();
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "processing",
      stage: "pasting",
      runId: started.runId,
    });
    tauri.invoke.mockClear();
    await dispatch("voice:shortcut-start", { source: "fn" });

    expect(FakeRecorder.instances).toHaveLength(1);
    expect(tauri.invoke).toHaveBeenCalledWith("show_flow_bar");
    expect(stateChanges().at(-1)).toMatchObject({
      state: "processing",
      stage: "pasting",
      runId: started.runId,
      busyAcknowledgement: true,
    });

    resolveInsertion("inserted");
    await settle();
  });

  it("terminalizes an empty browser result as no speech", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    FakeRecognition.instances[0].onend?.();
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "no-speech",
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
    await vi.advanceTimersByTimeAsync(1_999);
    expect(tauri.invoke).not.toHaveBeenCalledWith("hide_flow_bar");
    await vi.advanceTimersByTimeAsync(1);
    expect(stateChanges().at(-1)).toMatchObject({ state: "idle" });
    expect(tauri.invoke).toHaveBeenCalledWith("hide_flow_bar");
  });

  it("cancels browser recognition during the transcript tail window", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    const recognition = FakeRecognition.instances[0];
    const result = Object.assign([{ transcript: "recognized words" }], {
      isFinal: true,
    });
    recognition.onresult?.({ results: [result] });
    await release();
    const abort = vi.spyOn(recognition, "abort");

    await dispatch("voice:cancel");

    expect(abort).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
    expect(recognition.onerror).toBeNull();
    expect(recognition.onend).toBeNull();

    await vi.advanceTimersByTimeAsync(1_500);
    await settle();

    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
  });

  it("uses stop and reports when browser recognition abort fails", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    const recognition = FakeRecognition.instances[0];
    const result = Object.assign([{ transcript: "recognized words" }], {
      isFinal: true,
    });
    recognition.onresult?.({ results: [result] });
    await release();
    const abortError = new Error("abort unavailable");
    const abort = vi.spyOn(recognition, "abort").mockImplementation(() => {
      throw abortError;
    });
    const stop = vi.spyOn(recognition, "stop");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await dispatch("voice:cancel");

    expect(abort).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "[voice-dictation] browser recognition abort failed; stop fallback succeeded:",
      abortError,
    );
    expect(recognition.onresult).toBeNull();
    expect(recognition.onerror).toBeNull();
    expect(recognition.onend).toBeNull();

    warning.mockRestore();
    await vi.advanceTimersByTimeAsync(1_500);
    await settle();

    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
  });

  it("keeps browser cancellation failure visible when abort and stop fail", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    const recognition = FakeRecognition.instances[0];
    const result = Object.assign([{ transcript: "recognized words" }], {
      isFinal: true,
    });
    recognition.onresult?.({ results: [result] });
    await release();
    const abortError = new Error("abort unavailable");
    const stopError = new Error("stop unavailable");
    const abort = vi.spyOn(recognition, "abort").mockImplementation(() => {
      throw abortError;
    });
    const stop = vi.spyOn(recognition, "stop").mockImplementation(() => {
      throw stopError;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatch("voice:cancel");

    expect(abort).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[voice-dictation] browser recognition abort and stop failed:",
      { abortError, stopError },
    );
    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "provider",
      recoverable: true,
      transcript: "recognized words",
    });

    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(tauri.invoke).not.toHaveBeenCalledWith("hide_flow_bar");
    await vi.advanceTimersByTimeAsync(1_250);
    await settle();
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
    error.mockRestore();
  });

  it("surfaces browser recognition cleanup failure during early stop", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    const recognition = FakeRecognition.instances[0];
    const abortError = new Error("abort unavailable");
    const stopError = new Error("stop unavailable");
    const abort = vi.spyOn(recognition, "abort").mockImplementation(() => {
      throw abortError;
    });
    const stop = vi.spyOn(recognition, "stop").mockImplementation(() => {
      throw stopError;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatch("voice:shortcut-stop", { source: "fn" });

    expect(abort).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[voice-dictation] browser recognition abort and stop failed:",
      { abortError, stopError },
    );
    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "provider",
    });
    error.mockRestore();
  });

  it("finalizes browser recognition after capturing its transcript tail", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const started = await startDictation("browser");
    dispose = started.dispose;
    const recognition = FakeRecognition.instances[0];
    const result = Object.assign([{ transcript: "recognized words" }], {
      isFinal: true,
    });
    recognition.onresult?.({ results: [result] });
    await release();

    await vi.advanceTimersByTimeAsync(1_500);
    await settle();

    expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
      text: "recognized words",
    });
  });

  it("classifies a native no-speech event separately from provider failure", async () => {
    const started = await startDictation("native");
    dispose = started.dispose;
    for (const callback of tauri.transcripts.error) {
      callback({ error: "no-speech", source: "mic", runId: started.runId });
    }
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "no-speech",
    });
  });

  it("classifies meeting-owned speech engine as an actionable dictation failure", async () => {
    const started = await startDictation("native");
    dispose = started.dispose;
    for (const callback of tauri.transcripts.error) {
      callback({
        error: "speech-engine-busy-meeting",
        source: "mic",
        runId: started.runId,
      });
    }
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "meeting-capture-active",
    });
  });

  it("includes late final transcript events received just after stop", async () => {
    const started = await startDictation("native");
    dispose = started.dispose;
    await release();

    emitFinal(started.runId!, "first segment");
    await vi.advanceTimersByTimeAsync(100);
    emitFinal(started.runId!, "late segment");
    await vi.advanceTimersByTimeAsync(249);

    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
      text: "first segment late segment",
    });
    expect(stateChanges().at(-1)).toMatchObject({ state: "complete" });
  });

  it("clears a cancelled native startup before accepting the next run", async () => {
    let finishFirstStart!: () => void;
    let holdFirstStart = true;
    tauri.invoke.mockImplementation((command) => {
      if (command === "native_speech_start" && holdFirstStart) {
        holdFirstStart = false;
        return new Promise<void>((resolve) => {
          finishFirstStart = resolve;
        });
      }
      return Promise.resolve(
        command === "complete_voice_dictation" ? "inserted" : undefined,
      );
    });
    const started = await startDictation("native");
    dispose = started.dispose;
    await dispatch("voice:cancel");
    await dispatch("voice:shortcut-start", { source: "fn" });
    await settle();
    expect(
      tauri.invoke.mock.calls.filter(
        ([command]) => command === "native_speech_start",
      ),
    ).toHaveLength(2);

    finishFirstStart();
    await settle();
    const recordingRuns = stateChanges()
      .filter((state) => state.state === "recording")
      .map((state) => state.runId as number);
    expect(recordingRuns).toHaveLength(1);
    expect(recordingRuns[0]).toBeGreaterThan(started.runId!);
    expect(tauri.invoke).toHaveBeenCalledWith("native_speech_cancel", {
      owner: "dictation",
      runId: started.runId,
    });
  });

  it("cancels an in-flight Whisper startup before accepting a newer run", async () => {
    let finishFirstStart!: () => void;
    let holdFirstStart = true;
    tauri.invoke.mockImplementation((command) => {
      if (command === "audio_transcription_start" && holdFirstStart) {
        holdFirstStart = false;
        return new Promise<void>((resolve) => {
          finishFirstStart = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const started = await startDictation("whisper");
    dispose = started.dispose;
    await dispatch("voice:cancel");

    expect(tauri.invoke).toHaveBeenCalledWith("audio_transcription_stop", {
      owner: "dictation",
      runId: started.runId,
      discard: true,
    });

    await dispatch("voice:shortcut-start", { source: "fn" });
    await settle();
    finishFirstStart();
    await settle();

    const recordingRuns = stateChanges()
      .filter((state) => state.state === "recording")
      .map((state) => state.runId as number);
    expect(recordingRuns).toHaveLength(1);
    expect(recordingRuns[0]).toBeGreaterThan(started.runId!);
  });

  describe("Parakeet", () => {
    it("pastes the text the stop call returns, without logging it", async () => {
      const info = vi.spyOn(console, "info");
      parakeetReturns("recognized words");
      const started = await startDictation("parakeet");
      dispose = started.dispose;
      expect(tauri.invoke).toHaveBeenCalledWith(
        "audio_transcription_start",
        expect.objectContaining({ owner: "dictation", engine: "parakeet" }),
      );

      await release();
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
      expect(stateChanges().at(-1)).toMatchObject({
        state: "complete",
        insertion: "inserted",
      });
      expect(info).toHaveBeenCalledWith(
        "[voice-dictation] timing finalization:complete",
        expect.objectContaining({
          kind: "parakeet",
          pass: "live",
          releaseToTextMs: 120,
          audioMs: 2_000,
        }),
      );
      expect(JSON.stringify(info.mock.calls)).not.toContain("recognized");
    });

    it("dictates with Apple Speech until Parakeet is ready", async () => {
      tauri.invoke.mockImplementation((command) => {
        if (command === "audio_transcription_start") {
          return Promise.reject("parakeet-model-not-ready");
        }
        return Promise.resolve(
          command === "complete_voice_dictation" ? "inserted" : undefined,
        );
      });
      const started = await startDictation("parakeet");
      dispose = started.dispose;
      const { runId } = started;
      if (runId === undefined) throw new Error("Dictation did not start.");
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_speech_start",
        expect.objectContaining({ owner: "dictation" }),
      );

      await release();
      emitFinal(runId, "recognized words");
      await vi.advanceTimersByTimeAsync(250);
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
    });

    it("discards the recording when the dictation is cancelled", async () => {
      parakeetReturns("recognized words");
      const started = await startDictation("parakeet");
      dispose = started.dispose;
      await vi.advanceTimersByTimeAsync(501);
      await dispatch("voice:cancel");
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("audio_transcription_stop", {
        owner: "dictation",
        runId: started.runId,
        discard: true,
      });
      expect(tauri.invoke).not.toHaveBeenCalledWith(
        "complete_voice_dictation",
        expect.anything(),
      );
    });

    it("discards a dictation cancelled while it is still transcribing", async () => {
      const warn = vi.spyOn(console, "warn");
      let rejectStop!: (reason: string) => void;
      tauri.invoke.mockImplementation((command, args) => {
        if (command === "audio_transcription_stop") {
          if ((args as { discard?: boolean }).discard) {
            rejectStop("parakeet-dictation-discarded");
            return Promise.resolve(undefined);
          }
          return new Promise((_, reject) => {
            rejectStop = reject;
          });
        }
        return Promise.resolve(undefined);
      });
      const started = await startDictation("parakeet");
      dispose = started.dispose;
      await release();
      await settle();
      expect(stateChanges().at(-1)).toMatchObject({ state: "processing" });

      await dispatch("voice:cancel");
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("audio_transcription_stop", {
        owner: "dictation",
        runId: started.runId,
        discard: true,
      });
      expect(tauri.invoke).not.toHaveBeenCalledWith(
        "complete_voice_dictation",
        expect.anything(),
      );
      expect(warn).not.toHaveBeenCalledWith(
        "[voice-dictation] Parakeet stop failed:",
        expect.anything(),
      );
    });

    it("fails the run when the stop call returns no transcript", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const started = await startDictation("parakeet");
      dispose = started.dispose;
      await release();
      await settle();

      expect(stateChanges().at(-1)).toMatchObject({
        state: "error",
        failure: "provider",
      });
      expect(error).toHaveBeenCalledWith(
        "[voice-dictation] Parakeet stop returned no transcript for a dictation",
      );
    });
  });

  describe("recording edges", () => {
    type OnDeviceKind = "native" | "whisper" | "parakeet";
    const onDeviceKinds = ["native", "whisper", "parakeet"] as const;

    const stopCommand = (kind: OnDeviceKind) =>
      kind === "native" ? "native_speech_stop" : "audio_transcription_stop";

    const stopCalls = (kind: OnDeviceKind) =>
      tauri.invoke.mock.calls.filter(
        ([command, args]) =>
          command === stopCommand(kind) &&
          !(args as { discard?: boolean } | undefined)?.discard,
      );

    const expectDiscarded = (kind: OnDeviceKind, runId: number) => {
      if (kind === "native") {
        expect(tauri.invoke).toHaveBeenCalledWith("native_speech_cancel", {
          owner: "dictation",
          runId,
        });
      } else {
        expect(tauri.invoke).toHaveBeenCalledWith("audio_transcription_stop", {
          owner: "dictation",
          runId,
          discard: true,
        });
      }
    };

    async function startRun(kind: OnDeviceKind) {
      const started = await startDictation(kind);
      dispose = started.dispose;
      if (started.runId === undefined) {
        throw new Error("Dictation did not start.");
      }
      return started.runId;
    }

    const runStates = (runId: number) =>
      stateChanges()
        .filter((state) => state.runId === runId)
        .map((state) => state.state);

    // The engine's stop call answers with the speech detector's verdict.
    function engineStopReturns(result: unknown) {
      tauri.invoke.mockImplementation((command, args) => {
        if (
          (command === "native_speech_stop" ||
            command === "audio_transcription_stop") &&
          !(args as { discard?: boolean } | undefined)?.discard
        ) {
          return Promise.resolve(result);
        }
        return Promise.resolve(
          command === "complete_voice_dictation" ? "inserted" : undefined,
        );
      });
    }

    it("fetches the speech detector once dictation is on", async () => {
      await startRun("native");
      expect(tauri.invoke).toHaveBeenCalledWith("speech_detector_prepare");
    });

    it.each(onDeviceKinds)(
      "keeps %s recording for the release tail before stopping",
      async (kind) => {
        if (kind === "parakeet") parakeetReturns("recognized words");
        const runId = await startRun(kind);
        await vi.advanceTimersByTimeAsync(501);
        await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 501 });
        expect(stateChanges().at(-1)).toMatchObject({ state: "processing" });

        await vi.advanceTimersByTimeAsync(RELEASE_TAIL_MS - 1);
        expect(stopCalls(kind)).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(stopCalls(kind)).toEqual([
          [stopCommand(kind), { owner: "dictation", runId: runId }],
        ]);
      },
    );

    it.each(onDeviceKinds)(
      "drops a %s recording cancelled during the release tail",
      async (kind) => {
        if (kind === "parakeet") parakeetReturns("recognized words");
        const runId = await startRun(kind);
        await vi.advanceTimersByTimeAsync(501);
        await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 501 });
        await vi.advanceTimersByTimeAsync(RELEASE_TAIL_MS / 2);
        await dispatch("voice:cancel");
        await vi.advanceTimersByTimeAsync(5_000);

        expectDiscarded(kind, runId);
        expect(stopCalls(kind)).toHaveLength(0);
        expect(tauri.invoke).not.toHaveBeenCalledWith(
          "complete_voice_dictation",
          expect.anything(),
        );
      },
    );

    it.each(onDeviceKinds)(
      "leaves no trace of a %s tap shorter than 300 ms",
      async (kind) => {
        if (kind === "parakeet") parakeetReturns("recognized words");
        const runId = await startRun(kind);
        await vi.advanceTimersByTimeAsync(299);
        await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 299 });
        await vi.advanceTimersByTimeAsync(10_000);
        await settle();

        expectDiscarded(kind, runId);
        expect(stopCalls(kind)).toHaveLength(0);
        expect(runStates(runId)).not.toContain("cancelled");
        expect(runStates(runId)).not.toContain("error");
        expect(stateChanges().at(-1)).toMatchObject({ state: "idle" });
        expect(tauri.invoke).toHaveBeenCalledWith("hide_flow_bar");
        expect(tauri.invoke).not.toHaveBeenCalledWith(
          "complete_voice_dictation",
          expect.anything(),
        );
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).includes("create-dictation"),
          ),
        ).toBe(false);
      },
    );

    it("dictates a 300 ms hold", async () => {
      const runId = await startRun("native");
      await vi.advanceTimersByTimeAsync(300);
      await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 300 });
      await vi.advanceTimersByTimeAsync(RELEASE_TAIL_MS);
      emitFinal(runId, "yes");
      await vi.advanceTimersByTimeAsync(250);
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "yes",
      });
    });

    it("leaves no trace of a tap released before the engine started", async () => {
      let finishStart!: () => void;
      tauri.invoke.mockImplementation((command) => {
        if (command === "audio_transcription_start") {
          return new Promise<void>((resolve) => {
            finishStart = resolve;
          });
        }
        return Promise.resolve(undefined);
      });
      const runId = await startRun("whisper");
      await dispatch("voice:shortcut-stop", { source: "fn", heldMs: 120 });
      finishStart();
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();

      expectDiscarded("whisper", runId);
      expect(runStates(runId)).not.toContain("cancelled");
      expect(runStates(runId)).not.toContain("error");
      expect(runStates(runId)).not.toContain("recording");
    });

    it.each(onDeviceKinds)(
      "ends a silent %s hold as no speech without waiting",
      async (kind) => {
        engineStopReturns({ voice: "silent" });
        const runId = await startRun(kind);
        await release();
        await settle();

        expect(stateChanges().at(-1)).toMatchObject({
          runId: runId,
          state: "error",
          failure: "no-speech",
        });
        expect(tauri.invoke).not.toHaveBeenCalledWith(
          "complete_voice_dictation",
          expect.anything(),
        );
      },
    );

    it.each(["native", "whisper"] as const)(
      "pastes what %s heard even when the detector called the hold silent",
      async (kind) => {
        engineStopReturns({ voice: "silent" });
        const runId = await startRun(kind);
        emitFinal(runId, "recognized words");
        await release();
        await settle();
        expect(runStates(runId)).not.toContain("error");

        await vi.advanceTimersByTimeAsync(8_000);
        await settle();
        expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
          text: "recognized words",
        });
      },
    );

    it("pastes what Parakeet heard even when the detector called the hold silent", async () => {
      engineStopReturns({
        voice: "silent",
        transcript: {
          text: "recognized words",
          pass: "live",
          releaseToTextMs: 120,
          audioMs: 2_000,
        },
      });
      const runId = await startRun("parakeet");
      await release();
      await settle();

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
    });

    it.each(["heard", "unchecked"] as const)(
      "waits for the transcript when the detector answers %s",
      async (voice) => {
        engineStopReturns({ voice });
        const runId = await startRun("whisper");
        await release();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(runStates(runId)).not.toContain("error");

        emitFinal(runId, "recognized words");
        await vi.advanceTimersByTimeAsync(250);
        await settle();
        expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
          text: "recognized words",
        });
      },
    );
  });

  it("does not let an old recorder stop replace the newer finalizing run", async () => {
    let resolveTranscription!: (response: Response) => void;
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("transcribe-voice")) {
          return new Promise<Response>((resolve) => {
            resolveTranscription = resolve;
          });
        }
        if (url.includes("create-dictation")) {
          const body = JSON.parse(String(init?.body));
          return Promise.resolve(jsonResponse({ id: body.id }));
        }
        return Promise.resolve(
          jsonResponse({
            builder: false,
            gemini: false,
            groq: false,
            native: false,
          }),
        );
      },
    );
    const first = await startDictation("server");
    dispose = first.dispose;
    const oldRecorder = FakeRecorder.instances[0];
    await dispatch("voice:cancel");

    const second = await startDictation("server");
    const newRecorder = FakeRecorder.instances[1];
    newRecorder.ondataavailable?.({ data: new Blob(["audio"]) });
    await release();
    const newFinalization = newRecorder.onstop?.();
    await settle();
    expect(resolveTranscription).toEqual(expect.any(Function));
    await oldRecorder.onstop?.();
    await dispatch("voice:cancel");
    resolveTranscription(jsonResponse({ text: "recognized words" }));
    await newFinalization;
    await settle();

    expect(second.runId).toBeGreaterThan(first.runId!);
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
  });

  it("does not let an old recognition end replace the newer finalizing run", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const first = await startDictation("browser");
    dispose = first.dispose;
    const oldRecognition = FakeRecognition.instances[0];
    await dispatch("voice:cancel");

    const second = await startDictation("browser");
    const newRecognition = FakeRecognition.instances[1];
    const result = Object.assign([{ transcript: "recognized words" }], {
      isFinal: true,
    });
    newRecognition.onresult?.({ results: [result] });
    await release();
    oldRecognition.onend?.();
    await dispatch("voice:cancel");
    await vi.advanceTimersByTimeAsync(1_500);
    await settle();

    expect(second.runId).toBeGreaterThan(first.runId!);
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "complete_voice_dictation",
      expect.anything(),
    );
  });

  it("hides the flow bar when dictation is disposed", async () => {
    const started = await startDictation("server");
    dispose = started.dispose;
    tauri.invoke.mockClear();

    started.dispose();
    dispose = undefined;

    expect(tauri.invoke).toHaveBeenCalledWith("hide_flow_bar");
  });

  it("dismisses the flow bar after a history retry succeeds", async () => {
    let historyAttempts = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("transcribe-voice")) {
        return jsonResponse({ text: "recognized words" });
      }
      if (url.includes("create-dictation")) {
        historyAttempts += 1;
        if (historyAttempts === 1) {
          return {
            ok: false,
            status: 503,
            text: async () =>
              JSON.stringify({ error: "temporarily unavailable" }),
          } as Response;
        }
        const body = JSON.parse(String(init?.body));
        return jsonResponse({ id: body.id });
      }
      return jsonResponse({
        builder: false,
        gemini: false,
        groq: false,
        native: false,
      });
    });
    const started = await startDictation("server");
    dispose = started.dispose;
    const recorder = FakeRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["audio"]) });
    await release();
    await recorder.onstop?.();
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "history-save",
      retryHistory: true,
    });
    tauri.invoke.mockClear();

    await dispatch("voice:retry-history", { runId: started.runId });

    expect(historyAttempts).toBe(2);
    expect(stateChanges().at(-1)).toMatchObject({
      state: "complete",
      historySaved: true,
    });
    await vi.advanceTimersByTimeAsync(1_200);
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "idle",
      runId: started.runId,
    });
    expect(tauri.invoke).toHaveBeenCalledWith("hide_flow_bar");
  });

  it("keeps history recovery until its matching dismissal, then allows a new run", async () => {
    let historyAttempts = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("transcribe-voice")) {
        return jsonResponse({ text: "recognized words" });
      }
      if (url.includes("create-dictation")) {
        historyAttempts += 1;
        if (historyAttempts === 1) {
          return {
            ok: false,
            status: 503,
            text: async () => JSON.stringify({ error: "try again" }),
          } as Response;
        }
        const body = JSON.parse(String(init?.body));
        return jsonResponse({ id: body.id });
      }
      return jsonResponse({
        builder: false,
        gemini: false,
        groq: false,
        native: false,
      });
    });
    const started = await startDictation("server");
    dispose = started.dispose;
    const recorder = FakeRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["audio"]) });
    await release();
    await recorder.onstop?.();
    await settle();

    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      failure: "history-save",
      retryHistory: true,
      recoverable: true,
    });
    await dispatch("voice:shortcut-start", { source: "fn" });
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(stateChanges().at(-1)).toMatchObject({
      state: "error",
      runId: started.runId,
      retryHistory: true,
    });

    await dispatch("voice:dismiss-recovery", {
      runId: started.runId! + 1,
    });
    await dispatch("voice:shortcut-start", { source: "fn" });
    expect(FakeRecorder.instances).toHaveLength(1);

    await dispatch("voice:dismiss-recovery", { runId: started.runId });
    await dispatch("voice:shortcut-start", { source: "fn" });
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(stateChanges().at(-1)).toMatchObject({ state: "recording" });
    expect(stateChanges().at(-1)?.runId).toBeGreaterThan(started.runId!);
  });

  it.each(["pasting", "saving-history"] as const)(
    "does not hide recoverable controls when cancellation arrives during %s",
    async (stage) => {
      let rejectInsertion!: (error: Error) => void;
      let rejectHistorySave!: (error: Error) => void;
      tauri.invoke.mockImplementation((command) => {
        if (command === "complete_voice_dictation" && stage === "pasting") {
          return new Promise<unknown>((_resolve, reject) => {
            rejectInsertion = reject;
          });
        }
        if (command === "copy_voice_dictation") {
          return Promise.reject(new Error("copy failed"));
        }
        return Promise.resolve(
          command === "complete_voice_dictation" ? "inserted" : undefined,
        );
      });
      clipboard.writeText.mockRejectedValue(new Error("copy failed"));
      fetchMock.mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("transcribe-voice")) {
          return jsonResponse({ text: "recognized words" });
        }
        if (url.includes("create-dictation")) {
          if (stage === "saving-history") {
            return new Promise<Response>((_resolve, reject) => {
              rejectHistorySave = reject;
            });
          }
          const body = JSON.parse(String(init?.body));
          return jsonResponse({ id: body.id });
        }
        return jsonResponse({
          builder: false,
          gemini: false,
          groq: false,
          native: false,
        });
      });
      const started = await startDictation("server");
      dispose = started.dispose;
      const recorder = FakeRecorder.instances[0];
      recorder.ondataavailable?.({ data: new Blob(["audio"]) });
      await release();
      void recorder.onstop?.();
      await settle();

      expect(stateChanges().at(-1)).toMatchObject({
        state: "processing",
        stage,
      });
      tauri.invoke.mockClear();
      await dispatch("voice:cancel");
      await vi.advanceTimersByTimeAsync(250);
      expect(tauri.invoke).not.toHaveBeenCalledWith("hide_flow_bar");

      if (stage === "pasting") {
        rejectInsertion(new Error("paste failed"));
      } else {
        rejectHistorySave(new Error("history save failed"));
      }
      await settle();

      expect(stateChanges().at(-1)).toMatchObject({
        state: "error",
        recoverable: true,
        transcript: "recognized words",
        failure: stage === "pasting" ? "paste" : "history-save",
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(stateChanges().at(-1)).toMatchObject({
        state: "error",
        recoverable: true,
      });
      expect(tauri.invoke).not.toHaveBeenCalledWith("hide_flow_bar");
    },
  );

  describe("AI polish", () => {
    function cleanupRequests() {
      return fetchMock.mock.calls
        .filter(([url, init]) => {
          if (!String(url).includes("transcribe-voice")) return false;
          return (init?.body as FormData | undefined)?.get("text") !== null;
        })
        .map(([, init]) => init?.body as FormData);
    }

    function savedHistory() {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("create-dictation"),
      );
      return call ? JSON.parse(String(call[1]?.body)) : undefined;
    }

    function respondToCleanup(
      respond: (init: RequestInit | undefined) => Promise<Response>,
    ) {
      const fallback = fetchMock;
      fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const isCleanup =
            String(input).includes("transcribe-voice") &&
            (init?.body as FormData | undefined)?.get("text") !== null;
          return isCleanup ? respond(init) : fallback(input, init);
        },
      );
      vi.stubGlobal("fetch", fetchMock);
    }

    async function speak(runId: number | undefined, text: string) {
      if (runId === undefined) throw new Error("Dictation did not start.");
      await release();
      emitFinal(runId, text);
      await vi.advanceTimersByTimeAsync(250);
      await settle();
    }

    it.each([
      ["native", "builder-gemini"],
      ["native", "groq"],
      ["whisper", "builder-gemini"],
      ["whisper", "gemini"],
    ] as const)(
      "pastes the polished text from %s speech with %s polish",
      async (route, polish) => {
        respondToCleanup(async () =>
          jsonResponse({ text: "Recognized words." }),
        );
        const started = await startDictation(route, polish);
        dispose = started.dispose;
        await speak(started.runId, "recognized words");

        expect(
          cleanupRequests().map((form) => [
            form.get("text"),
            form.get("provider"),
          ]),
        ).toEqual([["recognized words", polish]]);
        expect(stateChanges()).toContainEqual(
          expect.objectContaining({ state: "processing", stage: "cleaning" }),
        );
        expect(
          tauri.invoke.mock.calls.filter(
            ([command]) => command === "complete_voice_dictation",
          ),
        ).toEqual([
          ["complete_voice_dictation", { text: "Recognized words." }],
        ]);
        expect(stateChanges().at(-1)).toMatchObject({
          state: "complete",
          cleanupFailed: false,
        });
        expect(savedHistory()).toMatchObject({
          fullText: "recognized words",
          cleanedText: "Recognized words.",
        });
      },
    );

    it("pastes the polished text from Parakeet speech", async () => {
      respondToCleanup(async () => jsonResponse({ text: "Recognized words." }));
      parakeetReturns("recognized words");
      const started = await startDictation("parakeet", "builder-gemini");
      dispose = started.dispose;
      await release();
      await settle();

      expect(
        cleanupRequests().map((form) => [
          form.get("text"),
          form.get("provider"),
        ]),
      ).toEqual([["recognized words", "builder-gemini"]]);
      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "Recognized words.",
      });
    });

    it("pastes the raw text when polish fails", async () => {
      respondToCleanup(
        async () =>
          ({
            ok: false,
            status: 502,
            json: async () => ({ error: "Builder.io cleanup failed" }),
            text: async () => "",
          }) as Response,
      );
      const started = await startDictation("native", "builder-gemini");
      dispose = started.dispose;
      await speak(started.runId, "recognized words");

      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
      expect(stateChanges().at(-1)).toMatchObject({
        state: "complete",
        cleanupFailed: true,
      });
      expect(savedHistory()).toMatchObject({
        fullText: "recognized words",
        cleanedText: null,
      });
    });

    it("pastes the raw text when polish takes longer than 2.5 seconds", async () => {
      let cleanupAborted = false;
      respondToCleanup(
        (init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              cleanupAborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      const started = await startDictation("whisper", "gemini");
      dispose = started.dispose;
      await speak(started.runId, "recognized words");

      expect(cleanupRequests()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2_400);
      expect(tauri.invoke).not.toHaveBeenCalledWith(
        "complete_voice_dictation",
        expect.anything(),
      );
      expect(stateChanges().at(-1)).toMatchObject({
        state: "processing",
        stage: "cleaning",
      });

      await vi.advanceTimersByTimeAsync(200);
      await settle();

      expect(cleanupAborted).toBe(true);
      expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
        text: "recognized words",
      });
      expect(stateChanges().at(-1)).toMatchObject({
        state: "complete",
        cleanupFailed: true,
      });
    });

    it.each(["native", "whisper"] as const)(
      "pastes %s speech without a polish step when polish is off",
      async (route) => {
        const started = await startDictation(route, "off");
        dispose = started.dispose;
        await speak(started.runId, "recognized words");

        expect(cleanupRequests()).toHaveLength(0);
        expect(stateChanges()).not.toContainEqual(
          expect.objectContaining({ stage: "cleaning" }),
        );
        expect(tauri.invoke).toHaveBeenCalledWith("complete_voice_dictation", {
          text: "recognized words",
        });
        expect(stateChanges().at(-1)).toMatchObject({
          state: "complete",
          cleanupFailed: false,
        });
      },
    );
  });
});
