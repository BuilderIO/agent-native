import { describe, expect, it } from "vitest";

import { assertNativeRecordingMedia } from "./native-media";

describe("assertNativeRecordingMedia", () => {
  it("refuses a screenshot", () => {
    // The video edit actions rewrite editsJson in their own shape, which
    // would drop the marker that keeps a mid-burn screenshot hidden.
    try {
      assertNativeRecordingMedia({ kind: "image" });
      throw new Error("Expected native media validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "native_media_required",
        statusCode: 422,
      });
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining(
          "Screenshots are edited in the screenshot editor",
        ),
      );
    }
  });

  it("rejects embed-backed Loom videos as a typed client error", () => {
    try {
      assertNativeRecordingMedia({
        kind: "video",
        sourceAppName: "Loom",
        videoUrl: "https://www.loom.com/embed/abcdefgh",
      });
      throw new Error("Expected native media validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "native_media_required",
        statusCode: 422,
      });
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("This Loom import is embed-backed"),
      );
    }
  });

  it("allows a Clips-hosted video", () => {
    expect(() =>
      assertNativeRecordingMedia({
        kind: "video",
        videoUrl: "https://store.example/clip.webm",
      }),
    ).not.toThrow();
  });
});
