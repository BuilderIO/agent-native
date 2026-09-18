export interface DesktopBrowserScreenshot {
  data: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export type CaptureActiveDesktopBrowserScreenshot =
  () => Promise<DesktopBrowserScreenshot>;

interface CapturedImage {
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number }): CapturedImage;
  toJPEG(quality?: number): Buffer;
}

interface CapturableBrowserContents {
  capturePage(): Promise<CapturedImage>;
}

const MAX_SCREENSHOT_DIMENSION = 1_600;
// Keep the MCP image below the core tool-result limit after base64 encoding.
const MAX_SCREENSHOT_BASE64_CHARS = 1_900_000;
const INITIAL_JPEG_QUALITY = 80;
const MIN_JPEG_QUALITY = 45;
const MAX_CAPTURE_ATTEMPTS = 8;

function fitSize(size: { width: number; height: number }) {
  const scale = Math.min(
    1,
    MAX_SCREENSHOT_DIMENSION / Math.max(size.width, size.height),
  );
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function sameSize(
  left: { width: number; height: number },
  right: { width: number; height: number },
): boolean {
  return left.width === right.width && left.height === right.height;
}

export async function captureDesktopBrowserScreenshot(
  contents: CapturableBrowserContents,
  isStillActive: () => boolean = () => true,
): Promise<DesktopBrowserScreenshot> {
  const image = await contents.capturePage();
  if (!isStillActive()) {
    throw new Error(
      "The active inline browser changed while the screenshot was being captured. Please retry.",
    );
  }
  const sourceSize = image.getSize();
  if (
    !Number.isFinite(sourceSize.width) ||
    !Number.isFinite(sourceSize.height) ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0
  ) {
    throw new Error("The active inline browser returned an empty screenshot.");
  }

  let size = fitSize(sourceSize);
  let current = sameSize(size, sourceSize) ? image : image.resize(size);
  let quality = INITIAL_JPEG_QUALITY;

  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    const bytes = current.toJPEG(quality);
    if (bytes.byteLength === 0) {
      throw new Error(
        "The active inline browser returned an empty screenshot.",
      );
    }
    const data = bytes.toString("base64");
    bytes.fill(0);
    if (data.length <= MAX_SCREENSHOT_BASE64_CHARS) {
      return { data, mediaType: "image/jpeg", ...size };
    }

    if (quality > MIN_JPEG_QUALITY) {
      quality = Math.max(MIN_JPEG_QUALITY, quality - 15);
      continue;
    }

    const smaller = fitSize({
      width: size.width * 0.75,
      height: size.height * 0.75,
    });
    if (sameSize(smaller, size)) break;
    current = current.resize(smaller);
    size = smaller;
    quality = MIN_JPEG_QUALITY;
  }

  throw new Error(
    "The active inline browser screenshot is too large to return.",
  );
}

export function desktopBrowserScreenshotToolResult(
  screenshot: DesktopBrowserScreenshot,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          captured: true,
          source: "active-inline-browser",
          width: screenshot.width,
          height: screenshot.height,
        }),
      },
      {
        type: "image" as const,
        data: screenshot.data,
        mimeType: screenshot.mediaType,
      },
    ],
  };
}
