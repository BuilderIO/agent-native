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
  /** How many upcoming start() calls should throw, like Chrome's InvalidStateError. */
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

  /** Chrome ends the session on its own after silence; onend fires, no stop(). */
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

    // Chrome ends the session on silence, then rejects the immediate restart
    // because the previous session has not fully released yet.
    FakeSpeechRecognition.failStartCount = 1;
    act(() => {
      FakeSpeechRecognition.instance?.endSession();
      vi.advanceTimersByTime(5_000);
    });

    // Without a retry the recognizer stays dead and the recording keeps going
    // with a transcript frozen at the first session.
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
});
