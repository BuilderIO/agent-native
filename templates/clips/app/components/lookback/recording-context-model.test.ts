import { describe, expect, it } from "vitest";

import {
  contextWindowSeconds,
  formatClock,
  hasUnfinishedContextItems,
  type RecordingContextItem,
} from "./recording-context-model";

function item(
  overrides: Partial<RecordingContextItem> = {},
): RecordingContextItem {
  return {
    id: "ctx_1",
    recordingId: "rec_1",
    kind: "screen_history",
    label: null,
    requestedSeconds: 30,
    originalStartedAt: "2026-10-09T10:04:30.000Z",
    originalEndedAt: "2026-10-09T10:05:00.000Z",
    startedAt: "2026-10-09T10:04:30.000Z",
    endedAt: "2026-10-09T10:05:00.000Z",
    status: "ready",
    mediaRecordingId: "media_1",
    durationMs: 30000,
    width: 1280,
    height: 720,
    error: null,
    capturedDeviceId: null,
    createdAt: "2026-10-09T10:05:01.000Z",
    updatedAt: "2026-10-09T10:05:30.000Z",
    ...overrides,
  };
}

describe("recording context model", () => {
  it("formats clock times as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(30)).toBe("0:30");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(300)).toBe("5:00");
  });

  it("reports the window length in whole seconds", () => {
    expect(contextWindowSeconds(item())).toBe(30);
    expect(
      contextWindowSeconds(
        item({
          startedAt: "2026-10-09T10:04:50.000Z",
          endedAt: "2026-10-09T10:05:00.000Z",
        }),
      ),
    ).toBe(10);
  });

  it("keeps polling only while an item is pending or processing", () => {
    expect(hasUnfinishedContextItems([])).toBe(false);
    expect(hasUnfinishedContextItems([item({ status: "ready" })])).toBe(false);
    expect(hasUnfinishedContextItems([item({ status: "failed" })])).toBe(false);
    expect(hasUnfinishedContextItems([item({ status: "pending" })])).toBe(true);
    expect(
      hasUnfinishedContextItems([
        item({ status: "ready" }),
        item({ status: "processing" }),
      ]),
    ).toBe(true);
  });

  it("does not poll for a pending item held by another device", () => {
    const heldElsewhere = item({
      status: "pending",
      mediaRecordingId: null,
      capturedDeviceId: "device-desktop-1",
    });
    expect(hasUnfinishedContextItems([heldElsewhere])).toBe(false);
    expect(
      hasUnfinishedContextItems([heldElsewhere, item({ status: "ready" })]),
    ).toBe(false);
    expect(
      hasUnfinishedContextItems([
        heldElsewhere,
        item({ status: "pending", mediaRecordingId: null }),
      ]),
    ).toBe(true);
    expect(
      hasUnfinishedContextItems([
        heldElsewhere,
        item({
          status: "processing",
          mediaRecordingId: null,
          capturedDeviceId: "device-desktop-1",
        }),
      ]),
    ).toBe(true);
  });
});
