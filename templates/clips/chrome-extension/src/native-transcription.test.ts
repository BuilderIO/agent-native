import { afterEach, describe, expect, it } from "vitest";

import { createNativeTranscriptionCapture } from "./native-transcription";

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeSpeechRecognition.instance = this;
  }

  start(): void {}

  stop(): void {
    this.onend?.();
  }

  abort(): void {
    this.onend?.();
  }
}

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  FakeSpeechRecognition.instance = null;
});

describe("createNativeTranscriptionCapture", () => {
  it("returns final Web Speech text without a backend round trip", async () => {
    setWindow({ SpeechRecognition: FakeSpeechRecognition });
    const capture = createNativeTranscriptionCapture({ lang: "en-US" });
    capture.start();

    FakeSpeechRecognition.instance?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "Hello from Chrome" } }],
    });

    await expect(capture.stop()).resolves.toEqual({
      text: "Hello from Chrome",
      failureReason: null,
    });
  });

  it("returns a concrete fallback reason when Web Speech is unavailable", async () => {
    setWindow({});
    const capture = createNativeTranscriptionCapture();

    await expect(capture.stop()).resolves.toEqual({
      text: "",
      failureReason:
        "Chrome Web Speech recognition is unavailable in this context.",
    });
  });
});
