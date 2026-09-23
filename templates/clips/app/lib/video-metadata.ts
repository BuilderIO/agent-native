const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/** Derives the upload mime type from a picked/dropped file, falling back to
 * the file extension when the browser doesn't supply one (common for macOS
 * .mov files dragged from Finder). Returns null when the file isn't a
 * supported video type. */
export function resolveVideoMimeType(file: File): string | null {
  const baseType = (file.type || "").split(";")[0]?.trim().toLowerCase();
  if (baseType && ACCEPTED_UPLOAD_MIME_TYPES.has(baseType)) return baseType;

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return null;
}

/** Reads duration/width/height from a local video file via a hidden
 * `<video>` element. Resolves with zeros rather than rejecting so callers can
 * still create the recording row when metadata can't be read. */
export function probeVideoMetadata(
  file: File,
): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
    };
    video.onloadedmetadata = () => {
      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.round(video.duration * 1000)
          : 0;
      const width =
        Number.isFinite(video.videoWidth) && video.videoWidth > 0
          ? Math.round(video.videoWidth)
          : 0;
      const height =
        Number.isFinite(video.videoHeight) && video.videoHeight > 0
          ? Math.round(video.videoHeight)
          : 0;
      resolve({ durationMs, width, height });
      cleanup();
    };
    video.onerror = () => {
      resolve({ durationMs: 0, width: 0, height: 0 });
      cleanup();
    };
    video.src = url;
  });
}
