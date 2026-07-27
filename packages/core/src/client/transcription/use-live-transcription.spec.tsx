// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  useLiveTranscription,
  type LiveTranscriptionApi,
} from "./use-live-transcription.js";

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
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
  });

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
});
