import { describe, expect, it } from "vitest";

import { recordingProcessingTransition } from "./recording-processing-lifecycle";

describe("recordingProcessingTransition", () => {
  it("shows progress when the current recording is still processing", () => {
    expect(
      recordingProcessingTransition(null, {
        recordingId: "rec_a",
        phase: "processing",
      }),
    ).toBe("processing");
  });

  it("completes processing only for a transition on the same recording", () => {
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "processing" },
        { recordingId: "rec_a", phase: "ready" },
      ),
    ).toBe("ready");
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "processing" },
        { recordingId: "rec_b", phase: "ready" },
      ),
    ).toBeNull();
  });

  it("fails processing only for a transition on the same recording", () => {
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "processing" },
        { recordingId: "rec_a", phase: "failed" },
      ),
    ).toBe("failed");
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "ready" },
        { recordingId: "rec_b", phase: "failed" },
      ),
    ).toBeNull();
  });
});
