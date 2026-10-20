import { WAITING_STORAGE_EXPIRED_REASON } from "@shared/upload-interruption";
import { describe, expect, it } from "vitest";

import {
  isRecordingWaitingForStorage,
  recordingProcessingTransition,
} from "./recording-processing-lifecycle";

describe("isRecordingWaitingForStorage", () => {
  it("recognizes expired Loom and video-link imports as waiting for storage", () => {
    expect(
      isRecordingWaitingForStorage(
        { sourceAppName: "Loom" },
        WAITING_STORAGE_EXPIRED_REASON,
      ),
    ).toBe(true);
    expect(
      isRecordingWaitingForStorage(
        { sourceAppName: " Video Link " },
        WAITING_STORAGE_EXPIRED_REASON,
      ),
    ).toBe(true);
  });

  it("does not classify the expired wait reason for unrelated recordings", () => {
    expect(
      isRecordingWaitingForStorage(
        { sourceAppName: "desktop" },
        WAITING_STORAGE_EXPIRED_REASON,
      ),
    ).toBe(false);
  });

  it("recognizes storage configuration failures from any recording source", () => {
    expect(
      isRecordingWaitingForStorage(
        { sourceAppName: "desktop" },
        "Video storage is not connected",
      ),
    ).toBe(true);
  });
});

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
