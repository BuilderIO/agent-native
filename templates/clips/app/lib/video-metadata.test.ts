// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { resolveVideoMimeType } from "./video-metadata";

describe("resolveVideoMimeType", () => {
  it("accepts supported types and falls back to known file extensions", () => {
    expect(
      resolveVideoMimeType(
        new File(["video"], "clip.mp4", { type: "video/mp4; codecs=avc1" }),
      ),
    ).toBe("video/mp4");
    expect(
      resolveVideoMimeType(new File(["video"], "clip.MOV", { type: "" })),
    ).toBe("video/quicktime");
    expect(resolveVideoMimeType(new File(["data"], "notes.txt"))).toBeNull();
  });
});
