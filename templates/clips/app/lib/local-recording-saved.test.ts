import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

import { trackLocalRecordingSaved } from "./local-recording-saved";

const saved = {
  recordingPlatform: "mobile" as const,
  captureType: "screen" as const,
  durationMs: 12_400,
  stopOutcome: "stopped" as const,
  hasStoredCopy: true,
};

describe("trackLocalRecordingSaved", () => {
  beforeEach(() => {
    trackEvent.mockReset();
  });

  it("reports a local-only recording once, with its platform and length", () => {
    trackLocalRecordingSaved(new Set(), "local-1", saved);

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
      "clips_local_recording_saved",
      {
        app_name: "clips",
        template_name: "clips",
        recording_attempt_id: "local-1",
        recording_platform: "mobile",
        capture_type: "screen",
        duration_s: 12,
        stop_outcome: "stopped",
        has_stored_copy: true,
      },
    );
  });

  it("marks a copy that only memory holds, so a lost-on-reload save is not counted as safe", () => {
    trackLocalRecordingSaved(new Set(), "local-1", {
      ...saved,
      hasStoredCopy: false,
    });

    expect(trackEvent.mock.calls[0][1]).toMatchObject({
      has_stored_copy: false,
    });
  });

  it("does not report the same recording twice when the hand-off runs again", () => {
    const reported = new Set<string>();

    trackLocalRecordingSaved(reported, "local-1", saved);
    trackLocalRecordingSaved(reported, "local-1", {
      ...saved,
      stopOutcome: "stop_failed",
    });
    trackLocalRecordingSaved(reported, "local-2", saved);

    expect(
      trackEvent.mock.calls.map(([, props]) => props.recording_attempt_id),
    ).toEqual(["local-1", "local-2"]);
  });

  it("never throws when analytics fails", () => {
    trackEvent.mockImplementation(() => {
      throw new Error("tracker down");
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      trackLocalRecordingSaved(new Set(), "local-1", saved),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[clips] clips_local_recording_saved track failed:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
