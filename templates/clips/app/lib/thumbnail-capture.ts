import { appBasePath } from "@agent-native/core/client";

const PROBE_WIDTH = 40;
const MIN_VISIBLE_MEAN_LUMA = 8;
const MIN_VISIBLE_MAX_LUMA = 28;
const MIN_VISIBLE_PIXEL_RATIO = 0.005;

function resolveAppUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${appBasePath()}${url}`;
  }
  return url;
}

function canProbeImageUrl(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function hasCustomThumbnail(editsJson: string | null | undefined) {
  if (!editsJson) return false;
  try {
    const parsed = JSON.parse(editsJson);
    return Boolean(parsed?.thumbnail);
  } catch {
    return false;
  }
}

export function canvasHasVisibleContent(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return false;

  const width = PROBE_WIDTH;
  const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));
  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;

  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;

  try {
    ctx.drawImage(canvas, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let totalLuma = 0;
    let maxLuma = 0;
    let visiblePixels = 0;
    const pixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const luma =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) *
        alpha;
      totalLuma += luma;
      maxLuma = Math.max(maxLuma, luma);
      if (luma >= MIN_VISIBLE_MAX_LUMA) visiblePixels++;
    }

    const meanLuma = totalLuma / Math.max(1, pixels);
    const visibleRatio = visiblePixels / Math.max(1, pixels);
    return (
      meanLuma >= MIN_VISIBLE_MEAN_LUMA ||
      (maxLuma >= MIN_VISIBLE_MAX_LUMA &&
        visibleRatio >= MIN_VISIBLE_PIXEL_RATIO)
    );
  } catch {
    return true;
  }
}

export async function thumbnailUrlHasVisibleContent(
  rawUrl: string,
): Promise<boolean | null> {
  const src = resolveAppUrl(rawUrl);
  if (!src || !canProbeImageUrl(src)) return null;

  const image = new Image();
  image.decoding = "async";
  image.src = src;

  try {
    await image.decode();
  } catch {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
      return false;
    }
  }

  if (!image.naturalWidth || !image.naturalHeight) return false;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  try {
    ctx.drawImage(image, 0, 0);
    return canvasHasVisibleContent(canvas);
  } catch {
    return null;
  }
}

export async function captureVideoThumbnailBlob(
  video: HTMLVideoElement | null,
): Promise<Blob | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (!canvasHasVisibleContent(canvas)) return null;

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
  });
}

export async function uploadRecordingThumbnail(
  recordingId: string,
  blob: Blob,
  options: { replaceAuto?: boolean } = {},
) {
  const suffix = options.replaceAuto ? "?replace=auto" : "";
  const response = await fetch(
    `${appBasePath()}/api/recordings/${recordingId}/thumbnail${suffix}`,
    {
      method: "POST",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    },
  );

  if (!response.ok) {
    throw new Error(`Thumbnail upload failed (${response.status})`);
  }

  return response.json().catch(() => null);
}
