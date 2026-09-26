import { toast } from "sonner";


export function imageDownloadName(src: string, alt: string): string {
  const cleanAlt = alt.trim().replace(/[^a-z0-9._-]+/gi, "-");
  if (cleanAlt) return cleanAlt.toLowerCase();

  try {
    const pathname = new URL(src, window.location.href).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {
    // Fall through to the generic name below.
  }

  return "image";
}

export async function downloadImage(
  src: string,
  alt: string,
  messages: ImageActionMessages = defaultImageActionMessages,
): Promise<void> {
  const filename = imageDownloadName(src, alt);

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(messages.downloadStarted);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast.info(messages.openedNewTab);
  }
}

async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas unavailable");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pngBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!pngBlob) throw new Error("Image conversion failed");
  return pngBlob;
}

export async function copyImage(
  src: string,
  messages: ImageActionMessages = defaultImageActionMessages,
): Promise<void> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard unavailable");
    }

    const response = await fetch(src);
    if (!response.ok) throw new Error("Copy failed");
    const blob = await response.blob();
    const clipboardItem = ClipboardItem as typeof ClipboardItem & {
      supports?: (type: string) => boolean;
    };
    const originalType = blob.type || "image/png";
    const canCopyOriginalType =
      originalType.startsWith("image/") &&
      (!clipboardItem.supports || clipboardItem.supports(originalType));
    const imageBlob = canCopyOriginalType ? blob : await blobToPng(blob);
    const imageType = canCopyOriginalType ? originalType : "image/png";

    await navigator.clipboard.write([
      new ClipboardItem({ [imageType]: imageBlob }),
    ]);
    toast.success(messages.imageCopied);
  } catch {
    try {
      await navigator.clipboard.writeText(src);
      toast.info(messages.copiedUrl);
    } catch {
      toast.error(messages.copyFailed);
    }
  }
}
export type ImageActionMessages = {
  downloadStarted: string;
  openedNewTab: string;
  imageCopied: string;
  copiedUrl: string;
  copyFailed: string;
};

const defaultImageActionMessages: ImageActionMessages = {
  downloadStarted: "Image download started.",
  openedNewTab: "Opened image in a new tab.",
  imageCopied: "Image copied.",
  copiedUrl: "Copied image URL.",
  copyFailed: "Could not copy image.",
};
