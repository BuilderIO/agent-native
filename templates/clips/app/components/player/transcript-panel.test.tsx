// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptPanel } from "./transcript-panel";

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  appPath: (path: string) => path,
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  openBuilderConnectPopup: vi.fn(),
  useT: () => (key: string, values?: Record<string, string>) =>
    values
      ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "")
      : key,
}));

describe("TranscriptPanel no-audio failures", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses the neutral no-speech presentation when the recording has no audio track", () => {
    act(() => {
      root.render(
        <TranscriptPanel
          segments={[]}
          currentMs={0}
          onSeek={vi.fn()}
          status="failed"
          failureReason={
            "Transcript unavailable: This recording has no audio track, so there was nothing to transcribe."
          }
          onRetry={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("transcriptPanel.noSpeechDetected");
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("keeps provider failures styled as errors", () => {
    act(() => {
      root.render(
        <TranscriptPanel
          segments={[]}
          currentMs={0}
          onSeek={vi.fn()}
          status="failed"
          failureReason="The media decoder returned malformed input."
        />,
      );
    });

    expect(container.querySelector(".text-destructive")).not.toBeNull();
  });
});
