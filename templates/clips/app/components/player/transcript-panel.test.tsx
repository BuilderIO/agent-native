// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  getTranscriptSeekMs,
  mergeTranscriptSegmentsForDisplay,
  TranscriptPanel,
} from "./transcript-panel";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  openBuilderConnectPopup: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values
      ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "")
      : key,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
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

  it("insets the active segment highlight within the panel frame", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[{ startMs: 0, endMs: 2_000, text: "Hello." }]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
          />
        </TooltipProvider>,
      );
    });

    const scrollRegion = Array.from(
      container.querySelectorAll<HTMLDivElement>("div"),
    ).find(
      (element) =>
        element.classList.contains("overflow-y-auto") &&
        element.classList.contains("px-3"),
    );
    const activeRow = container.querySelector('[role="button"]');

    expect(scrollRegion).not.toBeUndefined();
    expect(activeRow?.parentElement?.parentElement?.parentElement).toBe(
      scrollRegion,
    );
  });
});

describe("mergeTranscriptSegmentsForDisplay", () => {
  it("groups short adjacent cues into readable paragraphs", () => {
    const result = mergeTranscriptSegmentsForDisplay([
      { startMs: 0, endMs: 2_000, text: "What's up, Sean?" },
      {
        startMs: 2_000,
        endMs: 4_000,
        text: "So in terms of users and audience,",
      },
      { startMs: 4_000, endMs: 5_000, text: "not too different," },
      {
        startMs: 5_000,
        endMs: 10_000,
        text: "the big thing here is basically like,",
      },
      {
        startMs: 10_000,
        endMs: 12_000,
        text: "the builder audience is just big enough.",
      },
    ]);

    expect(result).toEqual([
      {
        startMs: 0,
        endMs: 12_000,
        text: "What's up, Sean? So in terms of users and audience, not too different, the big thing here is basically like, the builder audience is just big enough.",
      },
    ]);
  });

  it("seeks to the matching raw cue when a paragraph is searched", () => {
    const segments = [
      { startMs: 0, endMs: 2_000, text: "First thought." },
      { startMs: 2_000, endMs: 4_000, text: "The matching phrase." },
    ];
    const [displaySegment] = mergeTranscriptSegmentsForDisplay(segments);

    expect(
      getTranscriptSeekMs(displaySegment, "matching phrase", segments),
    ).toBe(2_000);
  });

  it("seeks to the first cue when a search phrase spans cues", () => {
    const segments = [
      { startMs: 0, endMs: 2_000, text: "Please ship" },
      { startMs: 2_000, endMs: 4_000, text: "this." },
    ];
    const [displaySegment] = mergeTranscriptSegmentsForDisplay(segments);

    expect(getTranscriptSeekMs(displaySegment, "ship this", segments)).toBe(0);
  });
});
