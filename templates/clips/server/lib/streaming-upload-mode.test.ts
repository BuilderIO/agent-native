import { afterEach, describe, expect, it } from "vitest";

import {
  isStreamingUploadDisabled,
  shouldEnableStreamingUpload,
} from "./streaming-upload-mode";

const originalDisable = process.env.CLIPS_DISABLE_STREAMING_UPLOAD;
const originalEnable = process.env.CLIPS_ENABLE_STREAMING_UPLOAD;

afterEach(() => {
  if (originalDisable === undefined) {
    delete process.env.CLIPS_DISABLE_STREAMING_UPLOAD;
  } else {
    process.env.CLIPS_DISABLE_STREAMING_UPLOAD = originalDisable;
  }
  if (originalEnable === undefined) {
    delete process.env.CLIPS_ENABLE_STREAMING_UPLOAD;
  } else {
    process.env.CLIPS_ENABLE_STREAMING_UPLOAD = originalEnable;
  }
});

describe("streaming upload mode", () => {
  it("keeps requested video streaming disabled by default", () => {
    delete process.env.CLIPS_DISABLE_STREAMING_UPLOAD;
    delete process.env.CLIPS_ENABLE_STREAMING_UPLOAD;

    expect(
      shouldEnableStreamingUpload({
        client: "desktop-native",
        mimeType: "video/mp4",
      }),
    ).toBe(false);
    expect(
      shouldEnableStreamingUpload({
        client: undefined,
        mimeType: "video/webm",
      }),
    ).toBe(false);
    expect(shouldEnableStreamingUpload({ mimeType: undefined })).toBe(false);
  });

  it("enables requested video streaming when buffered fallback is unavailable", () => {
    delete process.env.CLIPS_DISABLE_STREAMING_UPLOAD;
    delete process.env.CLIPS_ENABLE_STREAMING_UPLOAD;

    expect(
      shouldEnableStreamingUpload({
        client: "desktop-native",
        mimeType: "video/mp4",
        bufferedFallbackAvailable: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableStreamingUpload({
        mimeType: "audio/webm",
        bufferedFallbackAvailable: false,
      }),
    ).toBe(false);
  });

  it("honors explicit enable and disable flags", () => {
    process.env.CLIPS_ENABLE_STREAMING_UPLOAD = "true";
    delete process.env.CLIPS_DISABLE_STREAMING_UPLOAD;
    expect(shouldEnableStreamingUpload({ mimeType: "video/webm" })).toBe(true);
    expect(shouldEnableStreamingUpload({ mimeType: "audio/webm" })).toBe(false);

    process.env.CLIPS_DISABLE_STREAMING_UPLOAD = "true";
    expect(isStreamingUploadDisabled()).toBe(true);
    expect(
      shouldEnableStreamingUpload({
        client: "desktop-native",
        mimeType: "video/mp4",
      }),
    ).toBe(false);
  });
});
