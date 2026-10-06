const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export function resolveVideoMimeType(file: File): string | null {
  const baseType = (file.type || "").split(";")[0]?.trim().toLowerCase();
  if (baseType && ACCEPTED_UPLOAD_MIME_TYPES.has(baseType)) return baseType;

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return null;
}

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
