import { describe, expect, it } from "vitest";

import { stopMeetingBeforeTranscriptFlush } from "./meeting-stop";

describe("stopMeetingBeforeTranscriptFlush", () => {
  it("persists the terminal meeting state before transcript work", async () => {
    const events: string[] = [];

    await stopMeetingBeforeTranscriptFlush({
      stopRecording: async () => {
        events.push("stop-recording");
      },
      waitForHistory: async () => {
        events.push("wait-for-history");
      },
      flushTranscript: async () => {
        events.push("flush-transcript");
      },
    });

    expect(events).toEqual([
      "stop-recording",
      "wait-for-history",
      "flush-transcript",
    ]);
  });
});
