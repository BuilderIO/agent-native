import { describe, expect, it } from "vitest";

import { recordingControlVisibility } from "./popup";

describe("recording controls", () => {
  it("keeps both actions hidden while authentication is pending", () => {
    expect(recordingControlVisibility(null, "checking")).toEqual({
      startHidden: true,
      signInHidden: true,
    });
  });

  it("shows only the action allowed by the resolved auth state", () => {
    expect(recordingControlVisibility(null, "signed-in")).toEqual({
      startHidden: false,
      signInHidden: true,
    });
    expect(recordingControlVisibility(null, "signed-out")).toEqual({
      startHidden: true,
      signInHidden: false,
    });
  });

  it("hides both idle actions while a recording is active", () => {
    const activeRecording = {
      recordingId: "active",
    } as Parameters<typeof recordingControlVisibility>[0];
    expect(recordingControlVisibility(activeRecording, "signed-in")).toEqual({
      startHidden: true,
      signInHidden: true,
    });
  });
});
