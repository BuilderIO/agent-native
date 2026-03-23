import { toast } from "sonner";

interface DownloadMediaOptions {
  url: string;
  filename?: string;
}

function triggerBrowserDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getDownloadFilename(url: string, fallback = "download") {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const filename = pathname.split("/").filter(Boolean).pop();
    if (filename) {
      return decodeURIComponent(filename);
    }
  } catch {
    // Ignore URL parsing failures and fall back to manual parsing.
  }

  const fallbackFilename = url
    .split(/[?#]/)[0]
    ?.split("/")
    .filter(Boolean)
    .pop();
  return fallbackFilename ? decodeURIComponent(fallbackFilename) : fallback;
}

export async function downloadMediaAsset({
  url,
  filename,
}: DownloadMediaOptions) {
  const resolvedFilename = filename || getDownloadFilename(url);
  const toastId = toast.loading(`Preparing ${resolvedFilename}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const totalBytes = Number(
      response.headers.get("content-length") || Number.NaN,
    );
    const contentType = response.headers.get("content-type") || undefined;

    toast.loading(`Downloading ${resolvedFilename}...`, { id: toastId });

    let blob: Blob;
    if (!response.body) {
      blob = await response.blob();
    } else {
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = new Uint8Array(value.byteLength);
        chunk.set(value);
        chunks.push(chunk);
        receivedBytes += value.byteLength;

        if (Number.isFinite(totalBytes) && totalBytes > 0) {
          const progress = Math.min(
            99,
            Math.round((receivedBytes / totalBytes) * 100),
          );
          toast.loading(`Downloading ${resolvedFilename} (${progress}%)...`, {
            id: toastId,
          });
        }
      }

      blob = new Blob(chunks, { type: contentType });
    }

    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, resolvedFilename);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    toast.success(`Downloaded ${resolvedFilename}`, { id: toastId });
  } catch (error) {
    console.error("Download failed", error);
    toast.error(`Failed to download ${resolvedFilename}`, { id: toastId });
    throw error;
  }
}
