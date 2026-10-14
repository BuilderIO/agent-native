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

  it("dismisses the progress toast while a recording waits for storage", () => {
    expect(
      recordingProcessingTransition(null, {
        recordingId: "rec_a",
        phase: "waiting-storage",
      }),
    ).toBe("dismissed");
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "uploading" },
        { recordingId: "rec_a", phase: "waiting-storage" },
      ),
    ).toBe("dismissed");
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "waiting-storage" },
        { recordingId: "rec_a", phase: "waiting-storage" },
      ),
    ).toBeNull();
  });

  it("resumes progress after storage becomes available", () => {
    expect(
      recordingProcessingTransition(
        { recordingId: "rec_a", phase: "waiting-storage" },
        { recordingId: "rec_a", phase: "uploading" },
      ),
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
