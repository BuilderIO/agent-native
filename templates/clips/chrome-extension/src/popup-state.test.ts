import { describe, expect, it } from "vitest";

import {
  classifyAuthProbe,
  popupStartAuthDecision,
  recordFirstUrl,
  recordingControlVisibility,
} from "./popup";

describe("popup auth probe", () => {
  it.each([500, 503, 504, null])(
    "preserves stored auth when the session service is unavailable (%s)",
    (status) => {
      expect(
        classifyAuthProbe(status, { error: "Session unavailable" }, true),
      ).toEqual({
        status: "unavailable",
        clearStoredAuth: false,
      });
    },
  );

  it("preserves stored auth when the response cannot confirm a session", () => {
    expect(classifyAuthProbe(404, null, true)).toEqual({
      status: "unavailable",
      clearStoredAuth: false,
    });
    expect(classifyAuthProbe(200, null, true)).toEqual({
      status: "unavailable",
      clearStoredAuth: false,
    });
  });

  it("clears stored auth only after the endpoint confirms the session is invalid", () => {
    expect(
      classifyAuthProbe(200, { error: "Not authenticated" }, true),
    ).toEqual({ status: "signed-out", clearStoredAuth: true });
    expect(classifyAuthProbe(401, { error: "Unauthorized" }, true)).toEqual({
      status: "signed-out",
      clearStoredAuth: true,
    });
    expect(
      classifyAuthProbe(200, { error: "Not authenticated" }, false),
    ).toEqual({ status: "signed-out", clearStoredAuth: false });
  });

  it("accepts a confirmed session", () => {
    expect(
      classifyAuthProbe(200, { email: "person@example.test" }, true),
    ).toEqual({
      status: "signed-in",
      clearStoredAuth: false,
    });
  });
});

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
    expect(recordingControlVisibility(null, "unavailable")).toEqual({
      startHidden: true,
      signInHidden: true,
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

describe("popup start auth recheck", () => {
  it("starts only when the recheck confirms a signed-in session", () => {
    expect(popupStartAuthDecision("signed-in")).toBe("start");
    expect(popupStartAuthDecision("signed-out")).toBe("sign-in");
    expect(popupStartAuthDecision("unavailable")).toBe("retry");
    expect(popupStartAuthDecision("checking")).toBe("retry");
  });
});
