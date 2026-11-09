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

vi.mock("@agent-native/toolkit/app/settings", () => ({
  openBuilderConnectPopup: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values
      ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "")
      : key,
  useFormatters: () => ({
    formatRelativeTime: (value: number, unit: string) => `${value} ${unit}`,
    formatDate: (date: Date) => date.toISOString(),
  }),
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
          audience="viewer"
          onRetry={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "transcriptPanel.noTranscriptCaptured",
    );
    expect(container.textContent).not.toContain(
      "transcriptPanel.noSpeechDetected",
    );
    expect(container.textContent).not.toContain(
      "transcriptPanel.noSpeechDescription",
    );
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("shows captured segments with a partial marker when a transcript failed after capturing text", () => {
    for (const audience of ["creator", "viewer"] as const) {
      act(() => {
        root.render(
          <TooltipProvider>
            <TranscriptPanel
              segments={[{ startMs: 0, endMs: 2000, text: "captured words" }]}
              currentMs={0}
              onSeek={vi.fn()}
              status="failed"
              failureReason="Recording ended before the transcript finished."
              audience={audience}
            />
          </TooltipProvider>,
        );
      });

      expect(container.textContent).toContain("captured words");
      expect(container.textContent).toContain(
        "transcriptPanel.partialTranscript",
      );
      expect(container.textContent).not.toContain(
        "transcriptPanel.noTranscriptCaptured",
      );
    }
  });

  it("keeps every viewer transcript failure neutral", () => {
    for (const failureReason of [
      "No transcription provider configured.",
      "Builder credits exhausted.",
      "The media decoder returned malformed input.",
    ]) {
      act(() => {
        root.render(
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            status="failed"
            failureReason={failureReason}
            audience="viewer"
            onRetry={vi.fn()}
          />,
        );
      });

      expect(container.textContent).toContain(
        "transcriptPanel.noTranscriptCaptured",
      );
      expect(container.textContent).not.toContain(failureReason);
      expect(container.textContent).not.toContain(
        "transcriptPanel.enableTranscriptionTitle",
      );
      expect(container.textContent).not.toContain("builderCredits.pausedTitle");
    }
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

  it("says a transcript whose saved lines can't be read couldn't be read, not that there is none", () => {
    for (const audience of ["creator", "viewer"] as const) {
      act(() => {
        root.render(
          <TooltipProvider>
            <TranscriptPanel
              segments={[]}
              currentMs={0}
              onSeek={vi.fn()}
              status="ready"
              unreadable
              audience={audience}
            />
          </TooltipProvider>,
        );
      });

      expect(container.textContent).toContain("transcriptBubbles.unreadable");
      expect(container.textContent).not.toContain(
        "transcriptPanel.noTranscript",
      );
    }
  });

  it("keeps saying an unreadable transcript couldn't be read while searching", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
            unreadable
          />
        </TooltipProvider>,
      );
    });
    const input = container.querySelector<HTMLInputElement>("input");
    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(input).not.toBeNull();
    expect(inputValueSetter).toBeDefined();

    act(() => {
      if (!input || !inputValueSetter) return;
      inputValueSetter.call(input, "launch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("transcriptBubbles.unreadable");
    expect(container.textContent).not.toContain("transcriptPanel.noMatches");
  });

  it("offers to regenerate an unreadable transcript under the message when the clip can be regenerated", () => {
    const onRegenerate = vi.fn();
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
            unreadable
            onRegenerate={onRegenerate}
          />
        </TooltipProvider>,
      );
    });

    const emptyState = container.querySelector('[data-slot="empty"]');
    const button = Array.from(
      emptyState?.querySelectorAll("button") ?? [],
    ).find((el) => el.textContent === "transcriptPanel.regenerate");
    expect(button).toBeDefined();

    act(() => button?.click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("offers no regenerate button under the message without a way to regenerate, or when there is simply no transcript", () => {
    for (const unreadable of [true, false]) {
      act(() => {
        root.render(
          <TooltipProvider>
            <TranscriptPanel
              segments={[]}
              currentMs={0}
              onSeek={vi.fn()}
              status="ready"
              unreadable={unreadable}
              {...(unreadable
                ? { audience: "viewer" as const }
                : { onRegenerate: vi.fn() })}
            />
          </TooltipProvider>,
        );
      });

      const emptyState = container.querySelector('[data-slot="empty"]');
      expect(emptyState?.querySelector("button")).toBeNull();
    }
  });

  it("still says there is no transcript yet when there is none", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
          />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("transcriptPanel.noTranscript");
    expect(container.textContent).not.toContain("transcriptBubbles.unreadable");
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

  it("hides transcript cues that start inside an edited-out range", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[
              { startMs: 0, endMs: 1_000, text: "Keep this." },
              { startMs: 1_000, endMs: 2_000, text: "Cut this." },
              { startMs: 2_000, endMs: 3_000, text: "Keep that." },
            ]}
            editsJson={JSON.stringify({
              version: 1,
              trims: [{ startMs: 1_000, endMs: 2_000, excluded: true }],
              blurs: [],
            })}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
          />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("Keep this.");
    expect(container.textContent).toContain("Keep that.");
    expect(container.textContent).not.toContain("Cut this.");
  });
});

describe("TranscriptPanel earlier transcripts", () => {
  let container: HTMLDivElement;
  let root: Root;
  const versions = [
    {
      id: "version-1",
      replacedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      source: null,
      preview: "Automatic words from before the import.",
    },
  ];

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

  function historyTrigger() {
    return Array.from(document.body.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") === "transcriptHistory.title" ||
        button.textContent === "transcriptHistory.title",
    );
  }

  it("lets an editor restore an earlier transcript from the panel header", async () => {
    const onRestore = vi.fn(async () => true);
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[{ startMs: 0, endMs: 2_000, text: "Imported words." }]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
            transcriptVersions={versions}
            onRestoreTranscript={onRestore}
          />
        </TooltipProvider>,
      );
    });

    act(() => historyTrigger()!.click());
    expect(document.body.textContent).toContain(
      "Automatic words from before the import.",
    );
    expect(document.body.textContent).toContain(
      "transcriptHistory.automatic · -5 minute",
    );
    const restore = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "transcriptHistory.restore",
    );
    await act(async () => restore!.click());

    expect(onRestore).toHaveBeenCalledWith("version-1");
    expect(document.body.textContent).not.toContain(
      "Automatic words from before the import.",
    );
  });

  it("shows no earlier transcripts without a way to restore them", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[{ startMs: 0, endMs: 2_000, text: "Imported words." }]}
            currentMs={0}
            onSeek={vi.fn()}
            status="ready"
            transcriptVersions={versions}
          />
        </TooltipProvider>,
      );
    });

    expect(historyTrigger()).toBeUndefined();
  });

  it("offers earlier transcripts beside the file button when transcription failed", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            status="failed"
            failureReason="The media decoder returned malformed input."
            onImportTranscript={vi.fn(async () => undefined)}
            transcriptVersions={versions}
            onRestoreTranscript={vi.fn(async () => true)}
          />
        </TooltipProvider>,
      );
    });

    expect(historyTrigger()?.textContent).toBe("transcriptHistory.title");
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
