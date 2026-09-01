import { afterEach, describe, expect, it, vi } from "vitest";

const transcriptionEngineMocks = vi.hoisted(() => ({
  onFinalTranscript: vi.fn(),
  resetTranscriptionTimeline: vi.fn(),
  startTranscriptionEngine: vi.fn(),
  stopTranscriptionEngine: vi.fn(),
}));

vi.mock("./transcription-engine", async () => ({
  ...(await vi.importActual("./transcription-engine")),
  ...transcriptionEngineMocks,
}));

import {
  __test,
  shouldStartLocalRecordingTranscription,
  startTranscriptionCapture,
} from "./transcription-capture";

function result(transcript: string, isFinal: boolean) {
  return {
    isFinal,
    0: { transcript },
  };
}

describe("Web Speech transcription buffer", () => {
  it("keeps finalized text across recognition restarts", () => {
    const buffer = __test.createWebSpeechTranscriptBuffer();

    buffer.update({
      resultIndex: 0,
      results: [result("first session", true)],
    });
    expect(buffer.text()).toBe("first session");

    buffer.commitSession();
    buffer.update({
      resultIndex: 0,
      results: [result("second session", true)],
    });

    expect(buffer.text()).toBe("first session second session");
  });

  it("keeps trailing interim text when stopping", () => {
    const buffer = __test.createWebSpeechTranscriptBuffer();

    buffer.update({
      resultIndex: 0,
      results: [result("final text", true), result(" trailing interim", false)],
    });
    buffer.commitSession({ preserveInterim: true });

    expect(buffer.text()).toBe("final text trailing interim");
  });
});

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;
  static starts = 0;
  static failNextStart = false;
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeSpeechRecognition.instance = this;
  }

  start(): void {
    FakeSpeechRecognition.starts += 1;
    if (FakeSpeechRecognition.failNextStart) {
      FakeSpeechRecognition.failNextStart = false;
      throw new Error("InvalidStateError");
    }
  }

  stop(): void {}
  abort(): void {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  transcriptionEngineMocks.onFinalTranscript.mockReset();
  transcriptionEngineMocks.resetTranscriptionTimeline.mockReset();
  transcriptionEngineMocks.startTranscriptionEngine.mockReset();
  transcriptionEngineMocks.stopTranscriptionEngine.mockReset();
  delete (globalThis as { window?: unknown }).window;
  FakeSpeechRecognition.instance = null;
  FakeSpeechRecognition.starts = 0;
  FakeSpeechRecognition.failNextStart = false;
});

describe("Web Speech restart loop", () => {
  it("retries a restart that throws instead of ending transcription", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        SpeechRecognition: FakeSpeechRecognition,
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      },
    });
    vi.useFakeTimers();

    const capture = await __test.startBrowserTranscriptionCapture();
    expect(capture).not.toBeNull();
    expect(FakeSpeechRecognition.starts).toBe(1);

    // Chrome throws on the first restart while the previous session is still
    // releasing; nothing started, so no further `onend` arrives to retry from.
    FakeSpeechRecognition.failNextStart = true;
    FakeSpeechRecognition.instance?.onend?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSpeechRecognition.starts).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSpeechRecognition.starts).toBe(3);

    await capture?.cancel();
  });
});

describe("local recording transcription", () => {
  it("does not open a microphone capture for a system-audio-only recording", () => {
    expect(shouldStartLocalRecordingTranscription(false)).toBe(false);
    expect(shouldStartLocalRecordingTranscription(true)).toBe(true);
  });

  it("keeps active recording time continuous while a pause is excluded", () => {
    let now = 1_000;
    const timeline = __test.createActiveTimeline(() => now);

    now = 6_000;
    timeline.pause();
    expect(timeline.current()).toBe(5_000);

    now = 26_000;
    expect(timeline.current()).toBe(5_000);

    timeline.resume();
    now = 29_000;
    expect(timeline.current()).toBe(8_000);
  });

  it("rebases the active timeline to the actual recording start", () => {
    let now = 1_000;
    const timeline = __test.createActiveTimeline(() => now);

    now = 4_000;
    timeline.reset();
    now = 5_250;

    expect(timeline.current()).toBe(1_250);
  });

  it("freezes the timeline before native pause shutdown latency", async () => {
    let now = 1_000;
    let finishPause!: () => void;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    transcriptionEngineMocks.onFinalTranscript.mockResolvedValue(() => {});
    transcriptionEngineMocks.startTranscriptionEngine.mockResolvedValue(
      "whisper",
    );
    transcriptionEngineMocks.stopTranscriptionEngine
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPause = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    transcriptionEngineMocks.resetTranscriptionTimeline.mockResolvedValue(
      undefined,
    );

    const capture = await startTranscriptionCapture();
    expect(capture).not.toBeNull();

    now = 6_000;
    const pause = capture?.pause();
    now = 16_000;
    finishPause();
    await pause;
    now = 26_000;
    await capture?.resume();

    expect(
      transcriptionEngineMocks.resetTranscriptionTimeline,
    ).toHaveBeenLastCalledWith("whisper", 5_000);
    await capture?.cancel();
  });

  it("keeps the timeline live when the native pause fails", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    transcriptionEngineMocks.onFinalTranscript.mockResolvedValue(() => {});
    transcriptionEngineMocks.startTranscriptionEngine.mockResolvedValue(
      "whisper",
    );
    transcriptionEngineMocks.stopTranscriptionEngine
      .mockRejectedValueOnce(new Error("pause failed"))
      .mockResolvedValue(undefined);
    transcriptionEngineMocks.resetTranscriptionTimeline.mockResolvedValue(
      undefined,
    );

    const capture = await startTranscriptionCapture();
    expect(capture).not.toBeNull();

    now = 6_000;
    await capture?.pause();
    now = 26_000;
    await capture?.resume();
    now = 29_000;
    await capture?.pause();
    now = 40_000;
    await capture?.resume();

    expect(
      transcriptionEngineMocks.resetTranscriptionTimeline,
    ).toHaveBeenLastCalledWith("whisper", 28_000);
  });

  it("keeps the timeline paused when the native resume fails", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    transcriptionEngineMocks.onFinalTranscript.mockResolvedValue(() => {});
    transcriptionEngineMocks.startTranscriptionEngine
      .mockResolvedValueOnce("whisper")
      .mockRejectedValueOnce(new Error("resume failed"))
      .mockResolvedValueOnce("whisper");
    transcriptionEngineMocks.stopTranscriptionEngine.mockResolvedValue(
      undefined,
    );
    transcriptionEngineMocks.resetTranscriptionTimeline.mockResolvedValue(
      undefined,
    );

    const capture = await startTranscriptionCapture();
    expect(capture).not.toBeNull();

    now = 6_000;
    await capture?.pause();
    now = 26_000;
    await capture?.resume();
    now = 29_000;
    await capture?.resume();

    expect(
      transcriptionEngineMocks.resetTranscriptionTimeline,
    ).toHaveBeenLastCalledWith("whisper", 5_000);
  });
});
