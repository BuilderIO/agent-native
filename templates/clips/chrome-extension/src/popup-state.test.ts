import { describe, expect, it } from "vitest";

import { recordFirstUrl, recordingControlVisibility } from "./popup";

describe("record first without storage", () => {
  const base = {
    clipsBaseUrl: "https://clips.example.com/",
    includeMicrophone: true,
    includeDeveloperLogs: false,
    videoDeviceId: "",
    audioDeviceId: "",
  };

  it("opens the Clips recorder preset to the popup's screen choice", () => {
    expect(
      recordFirstUrl({
        ...base,
        captureSurface: "window",
        includeCamera: true,
      }),
    ).toBe(
      "https://clips.example.com/record?mode=screen%2Bcamera&surface=window",
    );
    expect(
      recordFirstUrl({
        ...base,
        captureSurface: "browser",
        includeCamera: false,
      }),
    ).toBe("https://clips.example.com/record?mode=screen&surface=browser");
  });

  it("opens a camera-only recorder without a screen surface", () => {
    expect(
      recordFirstUrl({
        ...base,
        captureSurface: "camera",
        includeCamera: true,
      }),
    ).toBe("https://clips.example.com/record?mode=camera");
  });
});

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
