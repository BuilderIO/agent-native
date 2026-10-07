// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applyVideoPlaybackSettings,
  insertDroppedVideoIntoSlideHtml,
  videoFileLooksLikeVideo,
  videoFileLooksSupported,
  videoPlaybackSettingsFor,
} from "./slide-video";

describe("slide video helpers", () => {
  it("recognizes MP4 and WebM while identifying other video formats for feedback", () => {
    expect(videoFileLooksSupported(new File([], "clip.mp4"))).toBe(true);
    expect(videoFileLooksSupported(new File([], "clip.webm"))).toBe(true);
    expect(videoFileLooksSupported(new File([], "clip.mov"))).toBe(false);
    expect(
      videoFileLooksLikeVideo(
        new File([], "clip.mov", { type: "video/quicktime" }),
      ),
    ).toBe(true);
  });

  it("inserts a positioned video object with click-to-play controls", () => {
    const content =
      '<div class="fmd-slide" style="background:#fff"><h1>Title</h1></div>';
    const html = insertDroppedVideoIntoSlideHtml(
      content,
      "https://media.example.com/clip.mp4",
      {
        position: { x: 500, y: 300 },
        objectId: "video-1",
        label: "clip.mp4",
      },
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const video = doc.querySelector("video");

    expect(video?.getAttribute("src")).toBe(
      "https://media.example.com/clip.mp4",
    );
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);
    expect(video?.getAttribute("data-slide-object-id")).toBe("video-1");
    expect(video?.getAttribute("aria-label")).toBe("clip.mp4");
    expect(video?.style.left).toBe("340px");
    expect(video?.style.top).toBe("210px");
    expect(doc.querySelector<HTMLElement>(".fmd-slide")?.style.position).toBe(
      "relative",
    );
  });

  it("applies autoplay, click-to-play, and loop settings", () => {
    const video = document.createElement("video");
    applyVideoPlaybackSettings(video, { mode: "autoplay", loop: true });
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(videoPlaybackSettingsFor(video)).toEqual({
      mode: "autoplay",
      loop: true,
    });

    applyVideoPlaybackSettings(video, { mode: "click", loop: false });
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.hasAttribute("muted")).toBe(false);
    expect(video.hasAttribute("loop")).toBe(false);
    expect(videoPlaybackSettingsFor(video)).toEqual({
      mode: "click",
      loop: false,
    });
  });
});
