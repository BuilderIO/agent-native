import type { SlideImageDropPosition } from "./slide-image-replacement";

const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 180;
const VIDEO_FILE_EXTENSIONS = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "webm",
]);
const MEDIA_CONTROL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

export interface InsertSlideVideoOptions {
  position?: SlideImageDropPosition;
  objectId?: string;
  label?: string;
}

export type VideoPlaybackMode = "click" | "autoplay";

export interface VideoPlaybackSettings {
  mode: VideoPlaybackMode;
  loop: boolean;
}

export function videoPlaybackSettingsFor(
  video: HTMLVideoElement,
): VideoPlaybackSettings {
  return {
    mode:
      video.hasAttribute("autoplay") ||
      video.getAttribute("data-video-autoplay") === "true"
        ? "autoplay"
        : "click",
    loop: video.hasAttribute("loop"),
  };
}

export function isMediaKeyboardEvent(event: KeyboardEvent): boolean {
  if (!MEDIA_CONTROL_KEYS.has(event.key)) return false;
  const targetsMedia = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest("video, audio"));
  if (targetsMedia(event.target)) return true;
  if (
    typeof event.composedPath === "function" &&
    event.composedPath().some(targetsMedia)
  )
    return true;
  return targetsMedia(document.activeElement);
}

export function applyVideoPlaybackSettings(
  video: HTMLVideoElement,
  settings: VideoPlaybackSettings,
): void {
  video.setAttribute("controls", "");
  video.setAttribute("playsinline", "");
  const wasAutoplay =
    video.hasAttribute("autoplay") ||
    video.getAttribute("data-video-autoplay") === "true";
  if (settings.mode === "autoplay") {
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
  } else {
    video.removeAttribute("autoplay");
    if (wasAutoplay) video.removeAttribute("muted");
    video.removeAttribute("data-video-autoplay");
  }
  if (settings.loop) video.setAttribute("loop", "");
  else video.removeAttribute("loop");
}

export function videoFileLooksSupported(file: File): boolean {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    file.type === "video/mp4" ||
    file.type === "video/webm" ||
    extension === "mp4" ||
    extension === "webm"
  );
}

export function videoFileLooksLikeVideo(file: File): boolean {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    file.type.startsWith("video/") ||
    (extension !== undefined && VIDEO_FILE_EXTENSIONS.has(extension))
  );
}

export function insertDroppedVideoIntoSlideHtml(
  content: string,
  src: string,
  options: InsertSlideVideoOptions = {},
): string {
  const doc = new DOMParser().parseFromString(
    `<body>${content}</body>`,
    "text/html",
  );
  const video = doc.createElement("video");
  const position = options.position ?? { x: 640, y: 360 };
  const left = Math.max(0, Math.round(position.x - VIDEO_WIDTH / 2));
  const top = Math.max(0, Math.round(position.y - VIDEO_HEIGHT / 2));

  video.setAttribute("src", src);
  video.setAttribute("controls", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("preload", "metadata");
  if (options.label?.trim()) {
    video.setAttribute("aria-label", options.label.trim());
  }
  video.setAttribute(
    "data-slide-object-id",
    options.objectId ?? createSlideObjectId(),
  );
  video.className = "fmd-video-uploaded";
  video.setAttribute(
    "style",
    `position: absolute; left: ${left}px; top: ${top}px; width: ${VIDEO_WIDTH}px; height: ${VIDEO_HEIGHT}px; max-width: none; max-height: none; margin: 0; object-fit: contain; box-sizing: border-box; z-index: 1;`,
  );

  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  if (slideRoot) {
    if (!hasStyleProperty(slideRoot.getAttribute("style") ?? "", "position")) {
      slideRoot.setAttribute(
        "style",
        `${(slideRoot.getAttribute("style") ?? "").trim().replace(/;+\s*$/, "")}; position: relative;`.replace(
          /^;\s*/,
          "",
        ),
      );
    }
    slideRoot.appendChild(video);
  } else {
    doc.body.append(doc.createTextNode("\n\n"), video);
  }

  return doc.body.innerHTML;
}

function createSlideObjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slide-object-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasStyleProperty(style: string, property: string): boolean {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:`, "i").test(style);
}
