import { describe, expect, it } from "vitest";

import {
  hasLiveOffscreenSession,
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
});
