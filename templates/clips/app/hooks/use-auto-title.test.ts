import { describe, expect, it } from "vitest";

import {
  buildAiRequestChatOptions,
  nextAutoTitleFallbackDelay,
} from "./use-auto-title";

const recording = {
  id: "rec_123",
  title: "Demo recording",
} as any;

describe("buildAiRequestChatOptions", () => {
  it("keeps queued AI requests hidden by default", () => {
    const options = buildAiRequestChatOptions(recording, {
      kind: "regenerate-chapters",
      recordingId: "rec_123",
      message: "Generate chapters",
    });

    expect(options.newTab).toBe(true);
    expect(options.background).toBe(true);
    expect(options.openSidebar).toBe(false);
  });

  it("focuses requests that were explicitly opened from the UI", () => {
    const options = buildAiRequestChatOptions(recording, {
      kind: "regenerate-chapters",
      recordingId: "rec_123",
      message: "Generate chapters",
      openInChat: true,
    });

    expect(options.newTab).toBe(true);
    expect(options.background).toBe(false);
    expect(options.openSidebar).toBe(true);
  });

  it("passes combined title and summary context to the agent", () => {
    const options = buildAiRequestChatOptions(recording, {
      kind: "generate-metadata",
      recordingId: "rec_123",
      currentDescription: "",
      transcriptText: "The clip explains activity grouping by project.",
      includeSummary: true,
      message: "Generate recording metadata",
    });

    expect(JSON.parse(options.context ?? "{}")).toMatchObject({
      recordingId: "rec_123",
      currentDescription: "",
      transcript: "The clip explains activity grouping by project.",
      includeSummary: true,
    });
  });
});

describe("nextAutoTitleFallbackDelay", () => {
  const now = Date.parse("2026-07-11T12:02:00.000Z");
  const readyRecording = {
    id: "rec_123",
    title: "Untitled recording",
    titleSource: "default",
    status: "ready",
    transcriptStatus: "ready",
    transcriptHasText: true,
    createdAt: "2026-07-11T12:01:00.000Z",
  } as any;

  it("schedules one wake-up when a fallback becomes eligible", () => {
    expect(nextAutoTitleFallbackDelay([readyRecording], new Set(), now)).toBe(
      60_000,
    );
  });

  it("runs an overdue transcript-backed fallback immediately", () => {
    expect(
      nextAutoTitleFallbackDelay(
        [
          {
            ...readyRecording,
            createdAt: "2026-07-11T11:59:00.000Z",
          },
        ],
        new Set(),
        now,
      ),
    ).toBe(0);
  });

  it("does not schedule work for pending transcripts or dispatched fallbacks", () => {
    expect(
      nextAutoTitleFallbackDelay(
        [{ ...readyRecording, transcriptStatus: "pending" }],
        new Set(),
        now,
      ),
    ).toBeNull();
    expect(
      nextAutoTitleFallbackDelay(
        [readyRecording],
        new Set(["rec_123:fallback"]),
        now,
      ),
    ).toBeNull();
  });
});
