// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getSlideCanvasTraversalElements,
  shouldStampBuilderId,
} from "../components/editor/slide-text-targets";
import {
  applyVideoPlaybackSettings,
  capturePendingSlideVideoGeometry,
  hasPendingSlideVideoPlaceholder,
  initialSlideVideoGeometry,
  insertPendingSlideVideoPlaceholder,
  insertDroppedVideoIntoSlideHtml,
  isMediaKeyboardEvent,
  stripPendingSlideVideoPlaceholders,
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

  it("keeps an upload placeholder selectable, resizable, and transient", () => {
    const content =
      '<div class="fmd-slide" style="background:#fff"><h1>Title</h1></div>';
    const preview = {
      objectId: "video-1",
      label: "clip.mp4",
      statusLabel: "Uploading video…",
      geometry: initialSlideVideoGeometry({ x: 500, y: 300 }),
    };
    const previewContent = insertPendingSlideVideoPlaceholder(content, preview);
    const doc = new DOMParser().parseFromString(previewContent, "text/html");
    const placeholder = doc.querySelector<HTMLElement>(
      '[data-slide-video-upload-placeholder="video-1"]',
    );

    expect(placeholder?.getAttribute("data-slide-object-id")).toBe("video-1");
    expect(placeholder?.getAttribute("role")).toBe("status");
    expect(placeholder?.getAttribute("aria-busy")).toBe("true");
    expect(placeholder?.getAttribute("aria-label")).toBe(
      "Uploading video… clip.mp4",
    );
    expect(placeholder?.classList.contains("skeleton-shimmer")).toBe(true);

    if (!placeholder) throw new Error("Video placeholder was not inserted");
    expect(shouldStampBuilderId(placeholder)).toBe(true);
    const selectablePlaceholder = placeholder.cloneNode() as HTMLElement;
    selectablePlaceholder.setAttribute("data-builder-id", "builder-video-1");
    const canvas = document.createElement("div");
    canvas.append(selectablePlaceholder);
    expect(getSlideCanvasTraversalElements(canvas)).toContain(
      selectablePlaceholder,
    );
    placeholder.style.left = "120px";
    placeholder.style.top = "80px";
    placeholder.style.width = "480px";
    placeholder.style.height = "270px";
    placeholder.after(placeholder.cloneNode(true));
    const resizedContent = doc.body.innerHTML;
    const resizedPreview = capturePendingSlideVideoGeometry(
      resizedContent,
      preview,
    );
    const stripped = stripPendingSlideVideoPlaceholders(resizedContent, [
      preview.objectId,
    ]);
    const completed = insertDroppedVideoIntoSlideHtml(
      stripped,
      "https://media.example.com/clip.mp4",
      {
        objectId: resizedPreview.objectId,
        label: resizedPreview.label,
        geometry: resizedPreview.geometry,
      },
    );
    const completedDoc = new DOMParser().parseFromString(
      completed,
      "text/html",
    );
    const video = completedDoc.querySelector("video");

    expect(resizedPreview.geometry).toEqual({
      left: 120,
      top: 80,
      width: 480,
      height: 270,
    });
    expect(hasPendingSlideVideoPlaceholder(resizedContent, "video-1")).toBe(
      true,
    );
    expect(hasPendingSlideVideoPlaceholder(stripped, "video-1")).toBe(false);
    expect(video?.getAttribute("data-slide-object-id")).toBe("video-1");
    expect(video?.style.cssText).toContain("left: 120px");
    expect(video?.style.cssText).toContain("top: 80px");
    expect(video?.style.cssText).toContain("width: 480px");
    expect(video?.style.cssText).toContain("height: 270px");
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

  it("keeps a click-to-play video's authored mute state when toggling loop", () => {
    const video = document.createElement("video");
    video.setAttribute("muted", "");

    applyVideoPlaybackSettings(video, { mode: "click", loop: true });

    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.hasAttribute("loop")).toBe(true);
  });

  it("recognizes only media-control keys when an event is retargeted", () => {
    const video = document.createElement("video");
    document.body.append(video);

    video.focus();
    const retargeted = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    });
    window.dispatchEvent(retargeted);
    expect(isMediaKeyboardEvent(retargeted)).toBe(true);

    for (const key of [
      " ",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "Home",
      "End",
    ]) {
      expect(isMediaKeyboardEvent(new KeyboardEvent("keydown", { key }))).toBe(
        true,
      );
    }

    for (const key of ["f", "s", "Escape"]) {
      expect(isMediaKeyboardEvent(new KeyboardEvent("keydown", { key }))).toBe(
        false,
      );
    }

    video.blur();
    const composedPathEvent = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
    });
    Object.defineProperty(composedPathEvent, "composedPath", {
      value: () => [video, document, window],
    });
    expect(isMediaKeyboardEvent(composedPathEvent)).toBe(true);

    expect(
      isMediaKeyboardEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })),
    ).toBe(false);
    video.remove();
  });
});
