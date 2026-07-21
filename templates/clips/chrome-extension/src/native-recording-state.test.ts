import { describe, expect, it } from "vitest";

import {
  hasLiveOffscreenSession,
  restartUploadModeFromResponse,
  restartUploadResetBody,
  shouldReconcilePersistedRecording,
} from "./native-recording-state";

describe("persisted native recording state", () => {
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

  it("requests a new resumable session when restarting a recording", () => {
    expect(restartUploadResetBody()).toEqual({
      requestStreaming: true,
      mimeType: "video/webm",
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
