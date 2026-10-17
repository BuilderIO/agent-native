// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useLiveTranscription,
  type LiveTranscriptionApi,
} from "./use-live-transcription.js";

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;
  static failStartCount = 0;
  continuous = false;
  interimResults = false;
  lang = "";
  running = false;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeSpeechRecognition.instance = this;
  }

  start(): void {
    if (FakeSpeechRecognition.failStartCount > 0) {
      FakeSpeechRecognition.failStartCount--;
      throw new Error("InvalidStateError");
    }
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.onend?.();
  }

  abort(): void {
    this.running = false;
    this.onend?.();
  }

  endSession(): void {
    this.running = false;
    this.onend?.();
  }
}

function finalResult(transcript: string) {
  return {
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript } }],
  };
}

function Harness({
  apiRef,
}: {
  apiRef: React.RefObject<LiveTranscriptionApi | null>;
}) {
  const api = useLiveTranscription({ lang: "en-US" });
  useEffect(() => {
    apiRef.current = api;
  });
  return null;
}

describe("useLiveTranscription", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    FakeSpeechRecognition.instance = null;
    FakeSpeechRecognition.failStartCount = 0;
    vi.useRealTimers();
  });

  function mount() {
    const apiRef = React.createRef<LiveTranscriptionApi>();
    act(() => {
      root.render(<Harness apiRef={apiRef} />);
    });
    return apiRef;
  }

  it("keeps interim browser speech when stopping before finalization", async () => {
    const apiRef = React.createRef<LiveTranscriptionApi>();
    act(() => {
      root.render(<Harness apiRef={apiRef} />);
    });

    act(() => {
      apiRef.current?.start();
      FakeSpeechRecognition.instance?.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: false, 0: { transcript: "Speech still being finalized" } },
        ],
      });
    });

    await act(async () => {
      await expect(apiRef.current?.stopAndWait()).resolves.toBe(
        "Speech still being finalized",
      );
    });
  });

  it("retries a restart that throws so the rest of the recording is captured", () => {
    vi.useFakeTimers();
    const apiRef = mount();

    act(() => {
      apiRef.current?.start();
      FakeSpeechRecognition.instance?.onresult?.(finalResult("first session"));
    });

    FakeSpeechRecognition.failStartCount = 1;
    act(() => {
      FakeSpeechRecognition.instance?.endSession();
      vi.advanceTimersByTime(5_000);
    });

    expect(FakeSpeechRecognition.instance?.running).toBe(true);
    expect(apiRef.current?.getIncompleteReason()).toBeNull();

    act(() => {
      FakeSpeechRecognition.instance?.onresult?.(
        finalResult(" second session"),
      );
    });
    expect(apiRef.current?.stop()).toBe("first session second session");
  });

  it("reports an incomplete capture when restarts never succeed", () => {
    vi.useFakeTimers();
    const apiRef = mount();

    act(() => {
      apiRef.current?.start();
      FakeSpeechRecognition.instance?.onresult?.(finalResult("only this much"));
    });

    FakeSpeechRecognition.failStartCount = Number.MAX_SAFE_INTEGER;
    act(() => {
      FakeSpeechRecognition.instance?.endSession();
      vi.advanceTimersByTime(60_000);
    });

    expect(apiRef.current?.getIncompleteReason()).toMatch(
      /could not be restarted/,
    );
    expect(apiRef.current?.stop()).toBe("only this much");
  });

  it("reports an incomplete capture when the speech service cuts off mid-recording", () => {
    const apiRef = mount();

    act(() => {
      apiRef.current?.start();
      FakeSpeechRecognition.instance?.onresult?.(finalResult("only this much"));
      FakeSpeechRecognition.instance?.onerror?.({
        error: "service-not-allowed",
      });
    });

    expect(apiRef.current?.getIncompleteReason()).toMatch(
      /service-not-allowed/,
    );
  });

  it("stops reporting active after repeated network errors", () => {
    vi.useFakeTimers();
    const apiRef = mount();

    act(() => apiRef.current?.start());
    for (let attempt = 0; attempt < 4; attempt++) {
      act(() => {
        FakeSpeechRecognition.instance?.onerror?.({ error: "network" });
        FakeSpeechRecognition.instance?.endSession();
        vi.advanceTimersByTime(30_000);
      });
    }

    expect(apiRef.current?.isActive).toBe(false);
    expect(apiRef.current?.getIncompleteReason()).toMatch(/network errors/);
  });

  it("ignores delayed events from a recognizer replaced by a new session", () => {
    vi.useFakeTimers();
    const apiRef = mount();
    const recognizers: {
      previous?: FakeSpeechRecognition;
      current?: FakeSpeechRecognition;
    } = {};

    act(() => {
      apiRef.current?.start();
      recognizers.previous = FakeSpeechRecognition.instance ?? undefined;
      apiRef.current?.start();
      recognizers.current = FakeSpeechRecognition.instance ?? undefined;
    });

    expect(recognizers.previous).toBeDefined();
    expect(recognizers.current).not.toBe(recognizers.previous);

    act(() => {
      recognizers.previous?.onresult?.(finalResult("stale transcript"));
      for (let attempt = 0; attempt < 4; attempt++) {
        recognizers.previous?.onerror?.({ error: "network" });
      }
      recognizers.previous?.endSession();
      vi.runOnlyPendingTimers();
    });

    expect(apiRef.current?.isActive).toBe(true);
    expect(apiRef.current?.getIncompleteReason()).toBeNull();
    expect(recognizers.current?.running).toBe(true);
    expect(apiRef.current?.stop()).toBe("");
  });

  it("settles an earlier stop waiter without changing a replacement session", async () => {
    const apiRef = mount();
    const recognizer: { previous?: FakeSpeechRecognition } = {};

    act(() => {
      apiRef.current?.start();
      recognizer.previous = FakeSpeechRecognition.instance ?? undefined;
      recognizer.previous?.onresult?.(finalResult("previous session"));
    });

    let stopped: Promise<string> | undefined;
    act(() => {
      if (recognizer.previous) recognizer.previous.onend = null;
      stopped = apiRef.current?.stopAndWait();
      apiRef.current?.start();
    });

    await act(async () => {
      await expect(stopped).resolves.toBe("previous session");
    });

    expect(apiRef.current?.isActive).toBe(true);
    expect(apiRef.current?.stop()).toBe("");
  });
});
