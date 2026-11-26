import { describe, expect, it } from "vitest";

import {
  isRichTrackId,
  normalizeRichTrackContentType,
  richTrackFile,
} from "./rich-recording";

describe("rich recording tracks", () => {
  it("knows its seven tracks and nothing else", () => {
    expect(isRichTrackId("screen")).toBe(true);
    expect(isRichTrackId("transcript")).toBe(true);
    expect(isRichTrackId("manifest")).toBe(false);
    expect(isRichTrackId("Screen")).toBe(false);
    expect(isRichTrackId(undefined)).toBe(false);
  });

  it("takes only the content types a track is made of, without parameters", () => {
    expect(
      normalizeRichTrackContentType("screen", "video/webm;codecs=vp9"),
    ).toBe("video/webm");
    expect(normalizeRichTrackContentType("mic", "Audio/MP4")).toBe("audio/mp4");
    expect(normalizeRichTrackContentType("input", "application/gzip")).toBe(
      "application/gzip",
    );
    expect(normalizeRichTrackContentType("screen", "audio/mp4")).toBeNull();
    expect(normalizeRichTrackContentType("page", "text/html")).toBeNull();
    expect(normalizeRichTrackContentType("transcript", undefined)).toBeNull();
  });

  it("names a track's file for what it holds", () => {
    expect(richTrackFile("screen", "video/mp4")).toBe("screen.mp4");
    expect(richTrackFile("camera", "video/webm")).toBe("camera.webm");
    expect(richTrackFile("system", "audio/webm")).toBe("system.webm");
    expect(richTrackFile("input", "application/gzip")).toBe("input.jsonl.gz");
    expect(richTrackFile("transcript", "application/json")).toBe(
      "transcript.json",
    );
  });
});
