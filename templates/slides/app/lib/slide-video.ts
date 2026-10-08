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
  geometry?: SlideVideoGeometry;
}

export interface SlideVideoGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PendingSlideVideoPreview {
  objectId: string;
  label: string;
  statusLabel: string;
  geometry: SlideVideoGeometry;
}

export function initialSlideVideoGeometry(
  position?: SlideImageDropPosition,
): SlideVideoGeometry {
  const width = VIDEO_WIDTH;
  const height = VIDEO_HEIGHT;
  return {
    left: Math.max(0, Math.round((position?.x ?? 640) - width / 2)),
    top: Math.max(0, Math.round((position?.y ?? 360) - height / 2)),
    width,
    height,
  };
}

export function insertPendingSlideVideoPlaceholder(
  content: string,
  preview: PendingSlideVideoPreview,
): string {
  const doc = parseSlideContent(content);
  if (findPendingVideoPlaceholder(doc, preview.objectId)) return content;

  const placeholder = doc.createElement("div");
  placeholder.className = "fmd-video-upload-placeholder skeleton-shimmer";
  placeholder.setAttribute("data-slide-object-id", preview.objectId);
  placeholder.setAttribute(
    "data-slide-video-upload-placeholder",
    preview.objectId,
  );
  placeholder.setAttribute("role", "status");
  placeholder.setAttribute("aria-busy", "true");
  placeholder.setAttribute(
    "aria-label",
    `${preview.statusLabel} ${preview.label}`.trim(),
  );
  placeholder.setAttribute("style", videoGeometryStyle(preview.geometry));

  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  if (slideRoot) {
    slideRoot.appendChild(placeholder);
  } else {
    doc.body.append(placeholder);
  }

  return doc.body.innerHTML;
}

export function hasPendingSlideVideoPlaceholder(
  content: string,
  objectId: string,
): boolean {
  return Boolean(
    findPendingVideoPlaceholder(parseSlideContent(content), objectId),
  );
}

export function capturePendingSlideVideoGeometry(
  content: string,
  preview: PendingSlideVideoPreview,
): PendingSlideVideoPreview {
  const placeholder = findPendingVideoPlaceholder(
    parseSlideContent(content),
    preview.objectId,
  );
  if (!placeholder) return preview;

  const style = placeholder.style;
  const geometry = {
    left: Number.parseFloat(style.left),
    top: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
  if (Object.values(geometry).some((value) => !Number.isFinite(value))) {
    return preview;
  }
  return { ...preview, geometry };
}

export function stripPendingSlideVideoPlaceholders(
  content: string,
  objectIds: readonly string[],
): string {
  if (objectIds.length === 0) return content;
  const doc = parseSlideContent(content);
  let changed = false;
  for (const objectId of objectIds) {
    for (const placeholder of Array.from(
      doc.querySelectorAll<HTMLElement>(
        "[data-slide-video-upload-placeholder]",
      ),
    )) {
      if (
        placeholder.getAttribute("data-slide-video-upload-placeholder") !==
        objectId
      ) {
        continue;
      }
      placeholder.remove();
      changed = true;
    }
  }
  return changed ? doc.body.innerHTML : content;
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
  const geometry =
    options.geometry ?? initialSlideVideoGeometry(options.position);

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
    videoGeometryStyle(geometry) + " object-fit: contain;",
  );

  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  if (slideRoot) {
    ensureSlideRootIsPositioned(slideRoot);
    slideRoot.appendChild(video);
  } else {
    doc.body.append(doc.createTextNode("\n\n"), video);
  }

  return doc.body.innerHTML;
}

function parseSlideContent(content: string): Document {
  return new DOMParser().parseFromString(
    `<body>${content}</body>`,
    "text/html",
  );
}

function findPendingVideoPlaceholder(
  doc: Document,
  objectId: string,
): HTMLElement | null {
  return (
    Array.from(
      doc.querySelectorAll<HTMLElement>(
        "[data-slide-video-upload-placeholder]",
      ),
    ).find(
      (element) =>
        element.getAttribute("data-slide-video-upload-placeholder") ===
        objectId,
    ) ?? null
  );
}

function videoGeometryStyle(geometry: SlideVideoGeometry): string {
  return `position: absolute; left: ${geometry.left}px; top: ${geometry.top}px; width: ${geometry.width}px; height: ${geometry.height}px; max-width: none; max-height: none; margin: 0; box-sizing: border-box; z-index: 1;`;
}

function ensureSlideRootIsPositioned(slideRoot: HTMLElement): void {
  if (hasStyleProperty(slideRoot.getAttribute("style") ?? "", "position")) {
    return;
  }
  slideRoot.setAttribute(
    "style",
    `${(slideRoot.getAttribute("style") ?? "").trim().replace(/;+\s*$/, "")}; position: relative;`.replace(
      /^;\s*/,
      "",
    ),
  );
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
