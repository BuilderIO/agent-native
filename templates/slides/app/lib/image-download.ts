import { appBasePath } from "@agent-native/core/client/api-path";

function imageProxyUrl(src: string): string {
  return `${appBasePath()}/api/image-proxy?url=${encodeURIComponent(src)}`;
}

function isRemoteHttpUrl(src: string): boolean {
  try {
    const url = new URL(src, window.location.href);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

export function imageDownloadFilename(src: string): string {
  if (/^(?:data|blob):/i.test(src)) return "image";

  try {
    const pathname = new URL(src, window.location.href).pathname;
    const filename = pathname.split("/").filter(Boolean).pop();
    const decoded = filename ? decodeURIComponent(filename) : "";
    const sanitized = decoded.replace(/[^a-z0-9._-]+/gi, "-");
    if (sanitized) return sanitized;
  } catch {
    // Use the generic name for malformed or non-URL image sources.
  }
  return "image";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function openImageInNewTab(src: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Download the selected image, proxying external sources when CORS blocks the browser. */
export async function downloadImage(src: string): Promise<void> {
  const normalizedSrc = src.trim();
  if (!normalizedSrc || typeof document === "undefined") return;

  const candidates = [normalizedSrc];
  if (isRemoteHttpUrl(normalizedSrc)) {
    candidates.push(imageProxyUrl(normalizedSrc));
  }

  const filename = imageDownloadFilename(normalizedSrc);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { credentials: "include" });
      if (!response.ok) continue;
      triggerBlobDownload(await response.blob(), filename);
      return;
    } catch {
      // Try the authenticated image proxy before falling back to the source URL.
    }
  }

  openImageInNewTab(normalizedSrc, filename);
}
