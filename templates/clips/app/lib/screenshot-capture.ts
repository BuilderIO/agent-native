/**
 * Capture one still frame of a screen, window or tab.
 *
 * This is the screenshot counterpart to the recorder's display capture, and it
 * is deliberately separate from it: a still is captured at the source's native
 * resolution (the recorder caps at 1080p because every extra pixel has to be
 * encoded 24 times a second, which does not apply to a single frame), needs no
 * audio, no MediaRecorder and no chunked upload.
 *
 * Splitting `requestScreenshotStream` from `grabScreenshotFrame` is not
 * cosmetic: browsers only honour `getDisplayMedia` when it is reached from a
 * user gesture without an intervening `await`, so the caller must start the
 * picker first and do everything else afterwards.
 */

import { isScreenPickerDismissal } from "@shared/display-capture-errors";

import { canvasHasVisibleContent } from "./thumbnail-capture";

export const SCREENSHOT_MIME_TYPE = "image/jpeg";

/**
 * High enough that UI text stays crisp, low enough that a 4K grab stays a
 * couple of megabytes rather than the ~15 MB a PNG of the same screen costs.
 */
export const SCREENSHOT_QUALITY = 0.92;

const FRAME_READY_TIMEOUT_MS = 3_000;
/**
 * How long to keep asking for a frame with something in it.
 *
 * Display capture is push-based: a source that does not change sends nothing.
 * A backgrounded tab or window that has not repainted since capture started is
 * therefore silent, and the first frame off it can be blank — which is exactly
 * the case a screenshot has to survive, because declining to steal focus is
 * what leaves the source in the background in the first place.
 */
const BLANK_FRAME_TIMEOUT_MS = 2_500;
const FRAME_POLL_MS = 200;
/** One attempt at reading a frame off the track, before trying another way. */
const FRAME_PULL_TIMEOUT_MS = 600;

export interface CapturedScreenshot {
  /**
   * The frame itself, unencoded. The region overlay both displays this and
   * crops from it, so the JPEG is produced once, from whatever survives the
   * crop, rather than encoding the whole screen and throwing most of it away.
   */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** What the user picked, when the browser reports it. */
  displaySurface: string | null;
}

export function screenshotDisplayOptions(): DisplayMediaStreamOptions {
  return {
    // No width/height envelope: a still should match the source pixel for
    // pixel, which is the whole point of screenshotting a UI.
    // No width/height envelope: a still should match the source pixel for
    // pixel. `displaySurface` is a preference, not a restriction — it opens
    // the picker on Entire Screen, which is the one surface that always has
    // a picture to give: the desktop compositor never stops drawing, while a
    // background tab or window may not have repainted since capture started.
    video: { frameRate: { ideal: 5, max: 10 }, displaySurface: "monitor" },
    audio: false,
    // Don't offer "this tab" first — screenshotting Clips itself is rarely
    // what is wanted, and the picker still lists it.
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
  } as DisplayMediaStreamOptions;
}

/** The catalog key under `screenshot.` that describes the failure. */
export type ScreenshotCaptureErrorKey =
  | "captureInsecure"
  | "captureUnavailable"
  | "captureUnsupported"
  | "captureNoScreen"
  | "captureNoCanvas"
  | "captureNoPicture";

/**
 * A capture failure the user can be told about in their own language. The
 * message stays English for logs; the UI shows `screenshot.<key>`.
 */
export class ScreenshotCaptureError extends Error {
  constructor(
    readonly key: ScreenshotCaptureErrorKey,
    message: string,
  ) {
    super(message);
    this.name = "ScreenshotCaptureError";
  }
}

export function screenshotCaptureUnsupportedReason(): ScreenshotCaptureError | null {
  // Secure context FIRST. On an insecure origin browsers do not merely refuse
  // capture, they omit `navigator.mediaDevices` altogether — so testing for
  // the API before the context blames the browser for what is really an
  // http:// URL, which is the one case a user can actually fix.
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return new ScreenshotCaptureError(
      "captureInsecure",
      "Screen capture requires HTTPS or localhost. Open Clips on a secure URL, then try again.",
    );
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return new ScreenshotCaptureError(
      "captureUnavailable",
      "Screen capture isn't available in this browser.",
    );
  }
  if (!navigator.mediaDevices.getDisplayMedia) {
    return new ScreenshotCaptureError(
      "captureUnsupported",
      "Your browser doesn't support screen capture. Try a recent Brave, Chrome, Edge, Safari, or Firefox.",
    );
  }
  return null;
}

type FocusController = {
  setFocusBehavior: (
    behavior: "focus-captured-surface" | "no-focus-change",
  ) => void;
};

/**
 * Chromium raises the window or tab you chose as soon as capture starts, which
 * for a screenshot means being thrown out of Clips at the exact moment the
 * crop step appears. Conditional Focus lets us decline that, but only if the
 * controller is handed to `getDisplayMedia` up front and told its preference
 * in the first microtask after the promise settles — later throws.
 *
 * Browsers without `CaptureController` (Firefox, Safari) simply focus the
 * captured surface as before; there is no other lever, and capture itself
 * must not depend on the API being there.
 */
function createFocusController(): FocusController | null {
  const ctor = (
    window as unknown as { CaptureController?: new () => FocusController }
  ).CaptureController;
  if (typeof ctor !== "function") return null;
  try {
    return new ctor();
  } catch (err) {
    console.debug("[screenshot] CaptureController unavailable", err);
    return null;
  }
}

/**
 * Open the browser's screen picker. Call this synchronously from the click
 * handler — anything awaited first costs the user gesture and the browser
 * refuses the prompt.
 */
export function requestScreenshotStream(): Promise<MediaStream> {
  const unsupported = screenshotCaptureUnsupportedReason();
  if (unsupported) return Promise.reject(unsupported);

  const controller = createFocusController();
  const options = screenshotDisplayOptions();
  if (controller) {
    (options as { controller?: FocusController }).controller = controller;
  }

  return navigator.mediaDevices.getDisplayMedia(options).then((stream) => {
    try {
      // Nothing is raised, whatever was picked. Frames are pulled from the
      // track rather than rendered through this page, so a tab that stays in
      // the background still gives up its picture — and the user is not
      // thrown out of Clips on the way to the crop step.
      controller?.setFocusBehavior("no-focus-change");
    } catch (err) {
      console.debug("[screenshot] could not keep focus on Clips", err);
      // Too late, or unsupported in this build — the captured surface takes
      // focus and the user comes back to Clips themselves. Not worth failing
      // a capture over.
    }
    return stream;
  });
}

export function isScreenshotCancelled(err: unknown): boolean {
  return isScreenPickerDismissal(err);
}

/**
 * Pixel size of the captured frame. The track's own settings are authoritative
 * — a `<video>` element can report the element's layout size before the first
 * frame lands — with the element as the fallback for browsers that leave the
 * settings empty.
 */
export function resolveCaptureSize(
  settings: Pick<MediaTrackSettings, "width" | "height">,
  video: { videoWidth?: number; videoHeight?: number },
): { width: number; height: number } {
  const width = Math.round(settings.width || video.videoWidth || 0);
  const height = Math.round(settings.height || video.videoHeight || 0);
  return { width, height };
}

/**
 * Resolve once the element has a decoded frame, or on timeout. A source that
 * has not repainted may never deliver one, which is a case to work around
 * rather than fail on, so this reports rather than throws.
 */
function waitForVideoFrame(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, FRAME_READY_TIMEOUT_MS);

    const done = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", onLoadedData);
    };
    const onLoadedData = () => {
      // `loadeddata` means a frame is decoded; one more callback lets the
      // compositor paint it before we read the pixels back.
      const withFrameCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (withFrameCallback.requestVideoFrameCallback) {
        withFrameCallback.requestVideoFrameCallback(done);
      } else {
        window.requestAnimationFrame(done);
      }
    };

    if (video.readyState >= 2) onLoadedData();
    else video.addEventListener("loadeddata", onLoadedData);
  });
}

/**
 * Ask the track for its current contents instead of waiting to be sent them.
 *
 * `grabFrame` pulls a frame on demand and resolves a promise, so it keeps
 * working when this page is in the background — which is exactly the state
 * Clips is in the moment the browser raises the tab or window being captured.
 * The `<video>` path cannot: a backgrounded page stops rendering, so the
 * element has nothing new to draw from.
 */
async function pullViaImageCapture(
  track: MediaStreamTrack,
): Promise<ImageBitmap | null> {
  const ctor = (
    window as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => {
        grabFrame: () => Promise<ImageBitmap>;
      };
    }
  ).ImageCapture;
  if (typeof ctor !== "function") return null;
  try {
    return await new ctor(track).grabFrame();
  } catch (err) {
    // Null means "try the next way of reading a frame", which the caller does.
    console.debug("[screenshot] ImageCapture could not grab a frame", err);
    return null;
  }
}

/**
 * Read one frame straight off the track. Also independent of this page
 * rendering, and available in Chromium where `grabFrame` sometimes refuses a
 * display-capture track outright.
 */
async function pullViaTrackProcessor(
  track: MediaStreamTrack,
  timeoutMs: number,
): Promise<VideoFrame | null> {
  const ctor = (
    window as unknown as {
      MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>;
      };
    }
  ).MediaStreamTrackProcessor;
  if (typeof ctor !== "function") return null;

  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  try {
    reader = new ctor({ track }).readable.getReader();
    const timer = new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), timeoutMs),
    );
    const result = await Promise.race([reader.read(), timer]);
    return result && "value" in result ? (result.value ?? null) : null;
  } catch (err) {
    // Null means "try the next way of reading a frame", which the caller does.
    console.debug("[screenshot] track processor could not read a frame", err);
    return null;
  } finally {
    reader?.cancel().catch(() => {});
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function drawableSize(source: CanvasImageSource): {
  width: number;
  height: number;
} {
  const any = source as unknown as Record<string, number | undefined>;
  return {
    width: Math.round(any.displayWidth ?? any.videoWidth ?? any.width ?? 0),
    height: Math.round(any.displayHeight ?? any.videoHeight ?? any.height ?? 0),
  };
}

/**
 * Draw the stream's current frame to a canvas. The caller owns the stream and
 * is responsible for stopping its tracks.
 *
 * Frames are pulled from the track first and only rendered through a `<video>`
 * element as a last resort, because pulling survives either page being in the
 * background — the single condition that breaks capturing a tab.
 */
export async function grabScreenshotFrame(
  stream: MediaStream,
): Promise<CapturedScreenshot> {
  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new ScreenshotCaptureError(
      "captureNoScreen",
      "No screen was shared.",
    );
  }

  const settings = track.getSettings();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ScreenshotCaptureError(
      "captureNoCanvas",
      "This browser could not prepare the image.",
    );
  }

  let haveFrame = false;

  /** Draw a candidate frame and report whether it has anything in it. */
  const draw = (source: CanvasImageSource): boolean => {
    const size = drawableSize(source);
    const width = Math.round(settings.width ?? 0) || size.width;
    const height = Math.round(settings.height ?? 0) || size.height;
    if (!width || !height) return false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(source, 0, 0, width, height);
    haveFrame = true;
    return canvasHasVisibleContent(canvas);
  };

  let captured = false;
  const deadline = Date.now() + BLANK_FRAME_TIMEOUT_MS;

  // 1. Pull. A source that has just started being captured can hand over a
  //    blank frame or two before it has drawn, so keep asking until the
  //    deadline rather than believing the first answer.
  do {
    const bitmap = await pullViaImageCapture(track);
    if (bitmap) {
      captured = draw(bitmap);
      bitmap.close?.();
      if (captured) break;
    }

    const frame = await pullViaTrackProcessor(track, FRAME_PULL_TIMEOUT_MS);
    if (frame) {
      captured = draw(frame);
      frame.close?.();
      if (captured) break;
    }

    if (!bitmap && !frame) break; // Neither API here — go to the element.
    await delay(FRAME_POLL_MS);
  } while (Date.now() < deadline);

  // 2. The <video> element. Needs this page to be rendering, so it is the
  //    fallback rather than the route.
  if (!captured) {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play().catch(() => {
        // Autoplay refusal still decodes frames for a muted, srcObject-backed
        // element, so keep going and let the frame wait decide.
      });
      if (await waitForVideoFrame(video)) {
        const elementDeadline = Date.now() + BLANK_FRAME_TIMEOUT_MS;
        do {
          captured = draw(video);
          if (captured) break;
          await delay(FRAME_POLL_MS);
        } while (Date.now() < elementDeadline);
      }
    } finally {
      video.srcObject = null;
    }
  }

  if (!haveFrame) {
    throw new ScreenshotCaptureError(
      "captureNoPicture",
      "The shared screen never sent a picture. Try again, or share the whole screen instead.",
    );
  }

  // A frame that still looks blank is handed over rather than refused. The
  // crop step shows it full-screen before anything is saved, so an empty
  // capture is something the user can see and back out of — and refusing here
  // threw away good captures whenever the blankness heuristic was wrong.
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    displaySurface:
      (settings as { displaySurface?: string }).displaySurface ?? null,
  };
}

/** Encode a captured (and possibly cropped) frame for upload. */
export function encodeScreenshotCanvas(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL(SCREENSHOT_MIME_TYPE, SCREENSHOT_QUALITY);
}

export function stopScreenshotStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
