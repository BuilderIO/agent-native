import { describe, expect, it } from "vitest";

import { ClipsActionError } from "./clips-action";
import {
  isTerminalMeetingStopError,
  isTerminalTranscriptSaveError,
  stopMeetingBeforeTranscriptFlush,
} from "./meeting-stop";

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

  it("classifies only typed permanent client errors as terminal", () => {
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError(
          "The meeting is no longer available.",
          404,
          "meeting_not_found",
        ),
      ),
    ).toBe(true);
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError("Not found", 404, "recording_not_found"),
      ),
    ).toBe(false);
    expect(
      isTerminalMeetingStopError(new ClipsActionError("Not found", 404)),
    ).toBe(false);
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError("Sign in required", 401, "unauthorized"),
      ),
    ).toBe(false);
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError("Access denied", 403, "forbidden"),
      ),
    ).toBe(false);
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError("Request timed out", 408),
      ),
    ).toBe(false);
    expect(
      isTerminalMeetingStopError(
        new ClipsActionError("Server unavailable", 503, "server_error"),
      ),
    ).toBe(false);
    expect(isTerminalMeetingStopError(new Error("Network unavailable"))).toBe(
      false,
    );
  });

  it("classifies only permanent transcript-save action errors as terminal", () => {
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Recording not found", 404, "recording_not_found"),
      ),
    ).toBe(true);
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Wrong error code", 403, "recording_not_found"),
      ),
    ).toBe(false);
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Wrong error code", 404, "forbidden"),
      ),
    ).toBe(false);
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Sign in required", 401, "unauthorized"),
      ),
    ).toBe(false);
    expect(
      isTerminalTranscriptSaveError(new ClipsActionError("Not found", 404)),
    ).toBe(false);
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Access denied", 403, "forbidden"),
      ),
    ).toBe(true);
    expect(
      isTerminalTranscriptSaveError(
        new ClipsActionError("Server unavailable", 503, "server_error"),
      ),
    ).toBe(false);
    expect(
      isTerminalTranscriptSaveError(new Error("Network unavailable")),
    ).toBe(false);
  });

  it.each([
    new ClipsActionError("Recording not found", 404, "recording_not_found"),
    new ClipsActionError("Access denied", 403, "forbidden"),
  ])("returns terminal when transcript save cannot succeed", async (error) => {
    const result = await stopMeetingBeforeTranscriptFlush({
      stopRecording: async () => {},
      isStopped: async () => true,
      waitForHistory: async () => {},
      flushTranscript: async () => {
        throw error;
      },
    });

    expect(result).toEqual({ status: "terminal", error });
  });

  it.each([401, 403])(
    "retries an auth error with status %i so a later stop can confirm",
    async (status) => {
      let attempts = 0;
      let stopConfirmed = false;

      const result = await stopMeetingBeforeTranscriptFlush({
        stopRecording: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new ClipsActionError(
              "Authentication failed",
              status,
              "auth_error",
            );
          }
          stopConfirmed = true;
        },
        isStopped: async () => stopConfirmed,
        waitForHistory: async () => {},
        flushTranscript: async () => {},
      });

      expect(result).toEqual({ status: "confirmed" });
      expect(attempts).toBe(2);
    },
  );

  it("keeps a terminal stop outcome when transcript flush fails and retries only the flush", async () => {
    const events: string[] = [];
    const stopError = new ClipsActionError(
      "The meeting is no longer available to stop.",
      404,
      "meeting_not_found",
    );
    let terminalStopError: ClipsActionError | undefined;
    let flushAttempts = 0;
    const options = {
      stopRecording: async () => {
        events.push("stop-recording");
        throw stopError;
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
        flushAttempts += 1;
        if (flushAttempts === 1)
          throw new Error("Temporary transcript failure");
      },
      onTerminalStopError: (error: ClipsActionError) => {
        terminalStopError = error;
      },
    };

    await expect(stopMeetingBeforeTranscriptFlush(options)).rejects.toThrow(
      "Temporary transcript failure",
    );
    expect(terminalStopError).toBe(stopError);

    await expect(
      stopMeetingBeforeTranscriptFlush({
        ...options,
        terminalStopError,
      }),
    ).resolves.toEqual({ status: "terminal", error: stopError });

    expect(events).toEqual([
      "stop-recording",
      "wait-for-history",
      "flush-transcript",
      "wait-for-history",
      "flush-transcript",
    ]);
  });

  it("returns terminal instead of confirming when a typed meeting_not_found cannot stop", async () => {
    const stopError = new ClipsActionError(
      "The meeting is no longer available to stop.",
      404,
      "meeting_not_found",
    );
    const stopRecording = async () => {
      throw stopError;
    };

    await expect(
      stopMeetingBeforeTranscriptFlush({
        stopRecording,
        isStopped: async () => false,
        waitForHistory: async () => {},
        flushTranscript: async () => {},
      }),
    ).resolves.toEqual({ status: "terminal", error: stopError });
  });
});
