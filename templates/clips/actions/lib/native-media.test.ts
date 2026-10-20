import { describe, expect, it } from "vitest";

import {
  assertNativeRecordingMedia,
  assertTranscribableRecordingMedia,
} from "./native-media";

const youtubeClip = {
  kind: "video",
  sourceAppName: "YouTube",
  sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
};
const loomEmbed = {
  kind: "video",
  sourceAppName: "Loom",
  videoUrl: "https://www.loom.com/embed/abcdefgh",
};

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

  it("rejects YouTube clips with a reason that points at transcript import", () => {
    expect(() => assertNativeRecordingMedia(youtubeClip)).toThrow(
      expect.objectContaining({
        errorCode: "native_media_required",
        statusCode: 422,
        message: expect.stringContaining("import-transcript"),
      }),
    );
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

describe("assertTranscribableRecordingMedia", () => {
  it("refuses YouTube clips, which have no audio Clips can read", () => {
    expect(() => assertTranscribableRecordingMedia(youtubeClip)).toThrow(
      expect.objectContaining({ errorCode: "native_media_required" }),
    );
  });

  it("still lets Loom embeds and hosted videos request a transcript", () => {
    expect(() => assertTranscribableRecordingMedia(loomEmbed)).not.toThrow();
    expect(() =>
      assertTranscribableRecordingMedia({
        kind: "video",
        videoUrl: "https://store.example/clip.webm",
      }),
    ).not.toThrow();
  });
});
