import { describe, expect, it } from "vitest";

import {
  claimRecordingFinalization,
  hasLiveOffscreenSession,
  restartUploadModeFromResponse,
  restartUploadResetBody,
  shouldClearTerminalSavingOverlay,
  shouldReconcilePersistedRecording,
} from "./native-recording-state";

describe("persisted native recording state", () => {
  it("allows only one finalizer per recording session", () => {
    const release = claimRecordingFinalization("session-1");
    expect(release).toBeTypeOf("function");
    expect(claimRecordingFinalization("session-1")).toBeNull();

    const releaseOther = claimRecordingFinalization("session-2");
    expect(releaseOther).toBeTypeOf("function");
    releaseOther?.();

    release?.();
    const retry = claimRecordingFinalization("session-1");
    expect(retry).toBeTypeOf("function");
    retry?.();
  });

  it("recognizes an active or prepared offscreen session", () => {
    expect(
      hasLiveOffscreenSession("session-1", { activeSessionId: "session-1" }),
    ).toBe(true);
    expect(
      hasLiveOffscreenSession("session-1", { preparedSessionId: "session-1" }),
    ).toBe(true);
    expect(hasLiveOffscreenSession("session-1", {})).toBe(false);
  });

  it("reconciles non-terminal persisted state when the offscreen session is gone", () => {
    expect(
      shouldReconcilePersistedRecording("recording", "session-1", {}),
    ).toBe(true);
    expect(
      shouldReconcilePersistedRecording("uploading", "session-1", {
        activeSessionId: "session-1",
      }),
    ).toBe(false);
  });

  it("keeps terminal errors visible for recovery actions", () => {
    expect(shouldReconcilePersistedRecording("error", "session-1", {})).toBe(
      false,
    );
    expect(shouldReconcilePersistedRecording("complete", "session-1", {})).toBe(
      false,
    );
  });

  it("clears a restored saving overlay only after a terminal result", () => {
    expect(shouldClearTerminalSavingOverlay("saving", "error")).toBe(true);
    expect(shouldClearTerminalSavingOverlay("saving", "complete")).toBe(true);
    expect(shouldClearTerminalSavingOverlay("saving", "uploading")).toBe(false);
    expect(shouldClearTerminalSavingOverlay("recording", "error")).toBe(false);
  });

  it("requests a new resumable session when restarting a recording", () => {
    expect(restartUploadResetBody("video/mp4")).toEqual({
      requestStreaming: true,
      mimeType: "video/mp4",
    });
  });

  it("accepts only server-provided upload modes after reset", () => {
    expect(restartUploadModeFromResponse({ uploadMode: "streaming" })).toBe(
      "streaming",
    );
    expect(restartUploadModeFromResponse({ uploadMode: "buffered" })).toBe(
      "buffered",
    );
    expect(restartUploadModeFromResponse({ uploadMode: "unknown" })).toBeNull();
    expect(restartUploadModeFromResponse(null)).toBeNull();
  });
});
