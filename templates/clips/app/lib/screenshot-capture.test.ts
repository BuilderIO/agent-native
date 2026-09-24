import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isScreenshotCancelled,
  resolveCaptureSize,
  screenshotCaptureUnsupportedReason,
  screenshotDisplayOptions,
  SCREENSHOT_MIME_TYPE,
} from "./screenshot-capture";

describe("screenshot capture options", () => {
  it("captures at the source's own resolution", () => {
    // Unlike the recorder, a still is not re-encoded 24 times a second, so
    // there is no reason to cap it at 1080p — capping would blur UI text.
    const video = screenshotDisplayOptions().video as MediaTrackConstraints;

    expect(video.width).toBeUndefined();
    expect(video.height).toBeUndefined();
  });

  it("asks for no audio", () => {
    expect(screenshotDisplayOptions().audio).toBe(false);
    expect(SCREENSHOT_MIME_TYPE).toBe("image/jpeg");
  });
});

describe("screenshotCaptureUnsupportedReason", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blames the insecure URL, not the browser", () => {
    // An http:// origin hides navigator.mediaDevices entirely, so a check
    // that asks about the API first reports "your browser can't do this"
    // for a page the user could simply reopen on localhost.
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});

    expect(screenshotCaptureUnsupportedReason()).toMatch(/HTTPS or localhost/);
  });

  it("still names the browser when a secure page has no capture API", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: {} });

    expect(screenshotCaptureUnsupportedReason()).toMatch(/doesn't support/);
  });

  it("says nothing is wrong when capture is available", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: () => Promise.resolve({}) },
    });

    expect(screenshotCaptureUnsupportedReason()).toBeNull();
  });
});

describe("resolveCaptureSize", () => {
  it("prefers the track's reported size", () => {
    // A <video> element can still report its layout size at this point.
    expect(
      resolveCaptureSize(
        { width: 2560, height: 1440 },
        { videoWidth: 300, videoHeight: 150 },
      ),
    ).toEqual({ width: 2560, height: 1440 });
  });

  it("falls back to the element when the track reports nothing", () => {
    expect(
      resolveCaptureSize({}, { videoWidth: 1280, videoHeight: 720 }),
    ).toEqual({ width: 1280, height: 720 });
  });

  it("reports zero when neither source knows, so the caller can fail", () => {
    expect(resolveCaptureSize({}, {})).toEqual({ width: 0, height: 0 });
  });
});

describe("isScreenshotCancelled", () => {
  it("treats a closed picker as a cancellation, not a failure", () => {
    expect(isScreenshotCancelled(new DOMException("", "AbortError"))).toBe(
      true,
    );
    expect(
      isScreenshotCancelled(
        new DOMException("Permission denied by user", "NotAllowedError"),
      ),
    ).toBe(true);
  });

  it("keeps a policy block as a real error", () => {
    expect(
      isScreenshotCancelled(
        new DOMException("Permission denied", "NotAllowedError"),
      ),
    ).toBe(false);
  });
});
