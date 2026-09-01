import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __test,
  shouldStartLocalRecordingTranscription,
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
});
