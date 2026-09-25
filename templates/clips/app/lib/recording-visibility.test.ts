import { describe, expect, it } from "vitest";

import {
  decideRecordingVisibilityAction,
  isMobileRecorderRuntime,
} from "./recording-visibility";

describe("isMobileRecorderRuntime", () => {
  it("uses userAgentData when available", () => {
    expect(
      isMobileRecorderRuntime({
        userAgent: "Mozilla/5.0",
        userAgentData: { mobile: true },
      }),
    ).toBe(true);
  });

  it("falls back to mobile platform user agents", () => {
    expect(
      isMobileRecorderRuntime({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    ).toBe(true);
    expect(
      isMobileRecorderRuntime({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    ).toBe(false);
    expect(
      isMobileRecorderRuntime({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });
});

describe("decideRecordingVisibilityAction", () => {
  const base = {
    mode: "camera" as const,
    mobileRuntime: true,
    documentHidden: false,
    cameraTrackMuted: false,
    recorderState: "recording" as const,
    autoPaused: false,
  };

  it("pauses a mobile camera recording when the page is hidden", () => {
    expect(
      decideRecordingVisibilityAction({ ...base, documentHidden: true }),
    ).toEqual({ action: "pause", autoPaused: true });
  });

  it("pauses when the mobile camera track is suspended", () => {
    expect(
      decideRecordingVisibilityAction({ ...base, cameraTrackMuted: true }),
    ).toEqual({ action: "pause", autoPaused: true });
  });

  it("resumes only a recording that visibility handling auto-paused", () => {
    expect(
      decideRecordingVisibilityAction({
        ...base,
        recorderState: "paused",
        autoPaused: true,
      }),
    ).toEqual({ action: "resume", autoPaused: false });
    expect(
      decideRecordingVisibilityAction({
        ...base,
        recorderState: "paused",
        autoPaused: false,
      }),
    ).toEqual({ action: null, autoPaused: false });
  });

  it("ignores desktop and non-camera recordings", () => {
    expect(
      decideRecordingVisibilityAction({
        ...base,
        mobileRuntime: false,
        documentHidden: true,
      }),
    ).toEqual({ action: null, autoPaused: false });
    expect(
      decideRecordingVisibilityAction({
        ...base,
        mode: "screen",
        documentHidden: true,
      }),
    ).toEqual({ action: null, autoPaused: false });
  });

  it("is idempotent across repeated hidden and visible events", () => {
    expect(
      decideRecordingVisibilityAction({
        ...base,
        documentHidden: true,
        recorderState: "paused",
        autoPaused: true,
      }),
    ).toEqual({ action: null, autoPaused: true });
    expect(decideRecordingVisibilityAction(base)).toEqual({
      action: null,
      autoPaused: false,
    });
  });
});
