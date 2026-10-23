import { describe, expect, it, vi } from "vitest";

import { classifyVideoLink, resolveVideoLink } from "./video-link";

const clipsOrigins = [
  "https://clips.agent-native.com",
  "https://agent-workspace.builder.io/clips",
];
const on = { clipsOrigins, clipsEnabled: true };
const off = { clipsOrigins, clipsEnabled: false };

describe("classifyVideoLink", () => {
  it.each([
    ["https://clips.agent-native.com/r/rec_Abc-123", "rec_Abc-123"],
    ["https://clips.agent-native.com/share/rec_Abc-123", "rec_Abc-123"],
    ["https://clips.agent-native.com/embed/rec_Abc-123", "rec_Abc-123"],
    ["https://clips.agent-native.com/share/rec_Abc-123/?t=30", "rec_Abc-123"],
    ["https://agent-workspace.builder.io/clips/r/rec_9", "rec_9"],
    ["  https://clips.agent-native.com/r/rec_9#comments  ", "rec_9"],
  ])("makes %s a Clip block for %s", (link, recordingId) => {
    expect(classifyVideoLink(link, on)).toEqual({ kind: "clip", recordingId });
  });

  it("refuses a Clips link while the Clip block is off", () => {
    for (const link of [
      "https://clips.agent-native.com/r/rec_1",
      "https://clips.agent-native.com/share/rec_1",
      "https://clips.agent-native.com/embed/rec_1",
    ]) {
      expect(classifyVideoLink(link, off)).toEqual({
        kind: "refused",
        reason: "clips-disabled",
      });
    }
  });

  it("refuses a Clips page that isn't a recording", () => {
    for (const link of [
      "https://clips.agent-native.com/",
      "https://clips.agent-native.com/library",
      "https://clips.agent-native.com/r/",
      "https://clips.agent-native.com/r/rec_1/edit",
      "https://clips.agent-native.com/share/..%2Fsecret",
    ]) {
      expect(classifyVideoLink(link, on)).toEqual({
        kind: "refused",
        reason: "clips-page",
      });
    }
  });

  it("does not treat a Clips-shaped path on another origin as a Clip", () => {
    expect(
      classifyVideoLink("https://clips.example.com/share/rec_1", on),
    ).toEqual({ kind: "probe" });
    expect(
      classifyVideoLink("http://clips.agent-native.com/r/rec_1", on),
    ).toEqual({ kind: "probe" });
    // Same host as a Clips mount, but outside its base path: another app.
    expect(
      classifyVideoLink("https://agent-workspace.builder.io/r/rec_1", on),
    ).toEqual({ kind: "probe" });
  });

  it("refuses YouTube and other video pages, with the flag on or off", () => {
    for (const options of [on, off]) {
      for (const link of [
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        "https://youtu.be/jNQXAC9IVRw",
        "https://m.youtube.com/shorts/jNQXAC9IVRw",
        "https://www.youtube.com/embed/jNQXAC9IVRw",
        "https://vimeo.com/76979871",
        "https://www.loom.com/share/abcdef123456",
      ]) {
        expect(classifyVideoLink(link, options)).toEqual({
          kind: "refused",
          reason: "video-page",
        });
      }
    }
  });

  it("accepts a link to a video file without checking it", () => {
    for (const link of [
      "https://cdn.example.com/a/demo.mp4",
      "https://cdn.example.com/a/demo.WEBM?sig=1",
      "https://cdn.example.com/a/demo.mov",
    ]) {
      expect(classifyVideoLink(link, off)).toEqual({ kind: "video" });
    }
  });

  it("asks the browser about any other http link", () => {
    expect(classifyVideoLink("https://example.com/watch/42", off)).toEqual({
      kind: "probe",
    });
  });

  it("refuses what isn't an http link", () => {
    for (const link of [
      "",
      "not a url",
      "javascript:alert(1)",
      "ftp://x/a.mp4",
    ]) {
      expect(classifyVideoLink(link, on)).toEqual({
        kind: "refused",
        reason: "invalid",
      });
    }
  });
});

describe("resolveVideoLink", () => {
  it("embeds a link only once the browser has loaded it as a video", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    await expect(
      resolveVideoLink("https://example.com/stream?id=4", { ...off, probe }),
    ).resolves.toEqual({
      kind: "video",
      src: "https://example.com/stream?id=4",
    });
    expect(probe).toHaveBeenCalledWith("https://example.com/stream?id=4");
  });

  it("refuses a web page the browser can't play", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await expect(
      resolveVideoLink("https://example.com/blog/post", { ...on, probe }),
    ).resolves.toEqual({ kind: "refused", reason: "not-video" });
  });

  it("refuses a Clips-shaped link on another origin that isn't a video", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await expect(
      resolveVideoLink("https://clips.example.com/share/rec_1", {
        ...on,
        probe,
      }),
    ).resolves.toEqual({ kind: "refused", reason: "not-video" });
  });

  it("never asks the browser about a Clip, a video page or a video file", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    await expect(
      resolveVideoLink("https://clips.agent-native.com/r/rec_1", {
        ...on,
        probe,
      }),
    ).resolves.toEqual({ kind: "clip", recordingId: "rec_1" });
    await expect(
      resolveVideoLink("https://youtu.be/jNQXAC9IVRw", { ...on, probe }),
    ).resolves.toEqual({ kind: "refused", reason: "video-page" });
    await expect(
      resolveVideoLink("https://cdn.example.com/a.mp4", { ...on, probe }),
    ).resolves.toEqual({ kind: "video", src: "https://cdn.example.com/a.mp4" });
    expect(probe).not.toHaveBeenCalled();
  });
});
