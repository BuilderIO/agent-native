import { describe, expect, it } from "vitest";

import { buildAiRequestChatOptions } from "./use-auto-title";

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
});
