import { describe, expect, it } from "vitest";

import { stopMeetingBeforeTranscriptFlush } from "./meeting-stop";

describe("stopMeetingBeforeTranscriptFlush", () => {
  it("persists the terminal meeting state before transcript work", async () => {
    const events: string[] = [];

    await stopMeetingBeforeTranscriptFlush({
      stopRecording: async () => {
        events.push("stop-recording");
      },
      isStopped: async () => {
        events.push("confirm-stopped");
        return true;
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
      "confirm-stopped",
      "wait-for-history",
      "flush-transcript",
    ]);
  });

  it("retries the idempotent stop until the server confirms before flushing", async () => {
    const events: string[] = [];

    await stopMeetingBeforeTranscriptFlush({
      stopRecording: async () => {
        events.push("stop-recording");
        if (events.filter((event) => event === "stop-recording").length === 1) {
          throw new Error("temporary request failure");
        }
      },
      isStopped: async () => {
        events.push("confirm-stopped");
        return (
          events.filter((event) => event === "confirm-stopped").length === 2
        );
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
      "confirm-stopped",
      "stop-recording",
      "confirm-stopped",
      "wait-for-history",
      "flush-transcript",
    ]);
  });

  it("does not flush when the server never confirms the stop", async () => {
    const events: string[] = [];

    await expect(
      stopMeetingBeforeTranscriptFlush({
        stopRecording: async () => {
          events.push("stop-recording");
        },
        isStopped: async () => {
          events.push("confirm-stopped");
          return false;
        },
        waitForHistory: async () => {
          events.push("wait-for-history");
        },
        flushTranscript: async () => {
          events.push("flush-transcript");
        },
      }),
    ).rejects.toThrow("The server did not confirm");

    expect(events).toEqual([
      "stop-recording",
      "confirm-stopped",
      "stop-recording",
      "confirm-stopped",
      "stop-recording",
      "confirm-stopped",
    ]);
  });

  it("propagates transcript save failures so the retained session can retry", async () => {
    const events: string[] = [];
    const options = {
      stopRecording: async () => {
        events.push("stop-recording");
      },
      isStopped: async () => {
        events.push("confirm-stopped");
        return true;
      },
      waitForHistory: async () => {
        events.push("wait-for-history");
      },
      flushTranscript: async () => {
        events.push("flush-transcript");
        if (
          events.filter((event) => event === "flush-transcript").length === 1
        ) {
          throw new Error("temporary transcript save failure");
        }
      },
    };

    await expect(stopMeetingBeforeTranscriptFlush(options)).rejects.toThrow(
      "temporary transcript save failure",
    );
    await stopMeetingBeforeTranscriptFlush(options);

    expect(events).toEqual([
      "stop-recording",
      "confirm-stopped",
      "wait-for-history",
      "flush-transcript",
      "stop-recording",
      "confirm-stopped",
      "wait-for-history",
      "flush-transcript",
    ]);
  });
});
