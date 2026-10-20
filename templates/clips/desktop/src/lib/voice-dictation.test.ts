// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function startDictation(
  provider: "auto" | "browser" | "macos-native" | "whisper",
) {
  const { installDesktopVoiceDictation } = await import("./voice-dictation");
  const dispose = installDesktopVoiceDictation({
    enabled: true,
    serverUrl: "https://clips.test",
    shortcut: "both",
    mode: "push-to-talk",
    provider,
  });
  await settle();
  await dispatch("voice:shortcut-start", { source: "fn" });
  const latestState = stateChanges()
    .reverse()
    .find((state) => typeof state.runId === "number");
  return { dispose, runId: latestState?.runId as number | undefined };
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

  async function release() {
    await vi.advanceTimersByTimeAsync(501);
    await dispatch("voice:shortcut-stop", { source: "fn" });
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
      const provider =
        kind === "server" ? "auto" : kind === "native" ? "macos-native" : kind;
      const started = await startDictation(provider);
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

    const started = await startDictation("auto");
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
    const started = await startDictation("auto");
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
    const started = await startDictation("macos-native");
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
    const started = await startDictation("macos-native");
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
    const started = await startDictation("macos-native");
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
    const started = await startDictation("macos-native");
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
    const first = await startDictation("auto");
    dispose = first.dispose;
    const oldRecorder = FakeRecorder.instances[0];
    await dispatch("voice:cancel");

    const second = await startDictation("auto");
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
    const started = await startDictation("auto");
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
    const started = await startDictation("auto");
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
    const started = await startDictation("auto");
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
      const started = await startDictation("auto");
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
});
