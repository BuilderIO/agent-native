import { describe, expect, it } from "vitest";

import {
  extractYouTubeVideoId,
  isYouTubeEmbedBackedRecording,
  isYouTubeUrl,
  youtubeEmbedUrl,
  youtubeVideoIdForRecording,
  youtubeWatchUrl,
} from "./youtube";

describe("YouTube URL helpers", () => {
  it.each([
    ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    [
      "https://youtube.com/watch?feature=share&v=jNQXAC9IVRw&t=12",
      "jNQXAC9IVRw",
    ],
    ["https://m.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://music.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://youtu.be/jNQXAC9IVRw?si=abc", "jNQXAC9IVRw"],
    ["https://www.youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://www.youtube.com/live/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://www.youtube.com/embed/jNQXAC9IVRw?start=3", "jNQXAC9IVRw"],
    ["https://www.youtube-nocookie.com/embed/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["  https://youtu.be/jNQXAC9IVRw  ", "jNQXAC9IVRw"],
  ])("reads the video ID from %s", (url, id) => {
    expect(extractYouTubeVideoId(url)).toBe(id);
  });

  it.each([
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
  ])("finds no video in the YouTube page %s", (url) => {
    expect(isYouTubeUrl(url)).toBe(true);
    expect(extractYouTubeVideoId(url)).toBeNull();
  });

  it.each([
    "https://www.loom.com/share/abc",
    "https://notyoutube.com/watch?v=jNQXAC9IVRw",
    "https://youtube.com.evil.example/watch?v=jNQXAC9IVRw",
    "javascript:alert(1)//youtube.com",
    "ftp://youtube.com/watch?v=jNQXAC9IVRw",
    "",
  ])("does not treat %s as YouTube", (url) => {
    expect(isYouTubeUrl(url)).toBe(false);
    expect(extractYouTubeVideoId(url)).toBeNull();
  });

  it("builds canonical watch and embed URLs", () => {
    expect(youtubeWatchUrl("jNQXAC9IVRw")).toBe(
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    );
    expect(youtubeEmbedUrl("jNQXAC9IVRw")).toBe(
      "https://www.youtube.com/embed/jNQXAC9IVRw",
    );
  });
});

describe("YouTube-backed recordings", () => {
  it("recognizes the stored canonical embed URL", () => {
    expect(
      youtubeVideoIdForRecording({
        videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
      }),
    ).toBe("jNQXAC9IVRw");
  });

  it("falls back to the source watch URL for a YouTube-sourced row", () => {
    expect(
      youtubeVideoIdForRecording({
        sourceAppName: "YouTube",
        sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        videoUrl: null,
      }),
    ).toBe("jNQXAC9IVRw");
  });

  it("ignores YouTube links that are only a window title or a hosted copy", () => {
    // A screen recording of a YouTube tab is a native clip, not an embed.
    expect(
      isYouTubeEmbedBackedRecording({
        sourceAppName: "Chrome",
        sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        videoUrl: "https://store.example/clip.webm",
      }),
    ).toBe(false);
    expect(
      isYouTubeEmbedBackedRecording({
        videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1",
      }),
    ).toBe(false);
    expect(isYouTubeEmbedBackedRecording(null)).toBe(false);
  });
});
