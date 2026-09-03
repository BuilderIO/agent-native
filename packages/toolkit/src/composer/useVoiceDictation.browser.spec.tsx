// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useVoiceDictation,
  type VoiceDictationApi,
} from "./useVoiceDictation.js";

class FakeSpeechRecognition {
  static last: FakeSpeechRecognition | undefined;
  continuous = false;
  interimResults = false;
  lang = "";
  onaudiostart: (() => void) | undefined;
  onresult: ((event: unknown) => void) | undefined;
  onerror: ((event: { error?: string }) => void) | undefined;
  onend: (() => void) | undefined;
  started = false;

  constructor() {
    FakeSpeechRecognition.last = this;
  }

  start() {
    this.started = true;
  }
  stop() {}
  abort() {}
}

class FakeMediaRecorder {
  static last: FakeMediaRecorder | undefined;
  static isTypeSupported = () => true;
  ondataavailable: ((event: unknown) => void) | undefined;
  onstop: (() => void) | undefined;
  mimeType = "audio/webm";
  started = false;

  constructor() {
    FakeMediaRecorder.last = this;
  }

  start() {
    this.started = true;
  }
  stop() {}
}

function stubSpeechEnvironment(getUserMedia = vi.fn()) {
  FakeSpeechRecognition.last = undefined;
  FakeMediaRecorder.last = undefined;
  vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
  vi.stubGlobal("webkitSpeechRecognition", FakeSpeechRecognition);
  vi.stubGlobal("MediaRecorder", undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
  );
  return getUserMedia;
}

async function renderVoiceDictation() {
  const seen: VoiceDictationApi[] = [];
  function Probe() {
    seen.push(useVoiceDictation({ onTranscript: vi.fn() }));
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });
  return {
    latest: () => seen[seen.length - 1]!,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVoiceDictation — browser speech path", () => {
  it("reports a session that ends before the microphone ever opened", async () => {
    stubSpeechEnvironment();
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    const recognition = FakeSpeechRecognition.last!;
    expect(recognition.started).toBe(true);
    await act(async () => {
      recognition.onerror?.({ error: "aborted" });
      recognition.onend?.();
    });

    expect(probe.latest().state).toBe("error");
    expect(probe.latest().errorMessage).toContain(
      "stopped before it captured any audio",
    );
    await probe.cleanup();
  });

  it("treats a silent but live session as an ordinary empty result", async () => {
    stubSpeechEnvironment(vi.fn().mockRejectedValue(new Error("no device")));
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    const recognition = FakeSpeechRecognition.last!;
    await act(async () => {
      recognition.onaudiostart?.();
      recognition.onerror?.({ error: "no-speech" });
      recognition.onend?.();
    });

    expect(probe.latest().state).toBe("idle");
    expect(probe.latest().errorMessage).toBeNull();
    await probe.cleanup();
  });

  it("keeps a reported speech error visible when `end` follows `error`", async () => {
    stubSpeechEnvironment(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    const recognition = FakeSpeechRecognition.last!;
    await act(async () => {
      recognition.onaudiostart?.();
      recognition.onerror?.({ error: "network" });
      recognition.onend?.();
    });

    expect(probe.latest().state).toBe("error");
    expect(probe.latest().errorMessage).toContain("couldn't reach its service");
    await probe.cleanup();
  });

  it("falls back to the upload path when the speech service is unreachable", async () => {
    stubSpeechEnvironment(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    await act(async () => {
      FakeSpeechRecognition.last!.onaudiostart?.();
      FakeSpeechRecognition.last!.onerror?.({ error: "network" });
      FakeSpeechRecognition.last!.onend?.();
    });
    await act(async () => {});

    expect(FakeMediaRecorder.last?.started).toBe(true);
    expect(probe.latest().state).toBe("recording");
    expect(probe.latest().errorMessage).toBeNull();
    await probe.cleanup();
  });

  it("delivers partial speech instead of failing over after a mid-session drop", async () => {
    stubSpeechEnvironment(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    await act(async () => {
      const recognition = FakeSpeechRecognition.last!;
      recognition.onaudiostart?.();
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "make it blue" }, isFinal: true }],
      });
      recognition.onerror?.({ error: "network" });
      recognition.onend?.();
    });
    await act(async () => {});

    expect(FakeMediaRecorder.last).toBeUndefined();
    expect(probe.latest().state).toBe("idle");
    await probe.cleanup();
  });

  it("falls back to the upload path when the recognizer has no speech backend", async () => {
    const getUserMedia = stubSpeechEnvironment(
      vi.fn().mockResolvedValue({ getTracks: () => [] }),
    );
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    await act(async () => {
      FakeSpeechRecognition.last!.onerror?.({ error: "aborted" });
      FakeSpeechRecognition.last!.onend?.();
    });
    await act(async () => {});

    expect(getUserMedia).toHaveBeenCalled();
    expect(FakeMediaRecorder.last?.started).toBe(true);
    expect(probe.latest().state).toBe("recording");
    expect(probe.latest().errorMessage).toBeNull();
    await probe.cleanup();
  });

  it("does not retry through the upload path after a denied microphone", async () => {
    stubSpeechEnvironment(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    await act(async () => {
      FakeSpeechRecognition.last!.onerror?.({ error: "not-allowed" });
      FakeSpeechRecognition.last!.onend?.();
    });
    await act(async () => {});

    expect(FakeMediaRecorder.last).toBeUndefined();
    expect(probe.latest().state).toBe("error");
    expect(probe.latest().errorMessage).toContain("site controls icon");
    await probe.cleanup();
  });

  it("opens the meter capture only after recognition owns the microphone", async () => {
    const getUserMedia = stubSpeechEnvironment(
      vi.fn().mockResolvedValue({ getTracks: () => [] }),
    );
    const probe = await renderVoiceDictation();
    await act(async () => {
      await probe.latest().start();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      FakeSpeechRecognition.last!.onaudiostart?.();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await probe.cleanup();
  });
});
