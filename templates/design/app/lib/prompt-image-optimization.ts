import {
  isSupportedChatImageType,
  isVisualImageAttachment,
} from "@/lib/chat-image-attachments";

const RAW_CHAT_IMAGE_ATTACHMENT_BYTES = 512 * 1024;
const IMAGE_COMPRESSION_PASSES = [
  { maxDimension: 1400, quality: 0.76 },
  { maxDimension: 1024, quality: 0.7 },
  { maxDimension: 768, quality: 0.65 },
  { maxDimension: 640, quality: 0.6 },
  { maxDimension: 512, quality: 0.55 },
  { maxDimension: 384, quality: 0.5 },
];

export interface PreparedPromptImage {
  file: File;
  dataUrl: string;
}

function dataUrlBytes(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).byteLength;
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function fileExtensionForImageType(type: string): string {
  switch (type) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    default:
      return "jpg";
  }
}

function optimizedImageName(name: string, type: string): string {
  const stem = name.replace(/\.[^.]*$/, "") || "image";
  return `${stem}.${fileExtensionForImageType(type)}`;
}

export async function preparePromptImageAttachment(
  file: File,
  maxDataUrlBytes: number,
): Promise<PreparedPromptImage | null> {
  if (!isVisualImageAttachment(file)) return null;

  if (
    isSupportedChatImageType(file.type) &&
    file.size <= RAW_CHAT_IMAGE_ATTACHMENT_BYTES
  ) {
    const dataUrl = await readFileDataUrl(file);
    if (dataUrl && dataUrlBytes(dataUrl) <= maxDataUrlBytes) {
      return { file, dataUrl };
    }
  }

  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof HTMLCanvasElement.prototype.toBlob !== "function"
  ) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (!image.naturalWidth || !image.naturalHeight) return null;

    for (const pass of IMAGE_COMPRESSION_PASSES) {
      const ratio = Math.min(
        pass.maxDimension / image.naturalWidth,
        pass.maxDimension / image.naturalHeight,
        1,
      );
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, width, height);

      for (const type of ["image/webp", "image/jpeg"]) {
        const blob = await canvasToBlob(canvas, type, pass.quality);
        if (!blob) continue;
        const mediaType = blob.type || type;
        const optimizedFile = new File(
          [blob],
          optimizedImageName(file.name, mediaType),
          {
            type: mediaType,
            lastModified: file.lastModified,
          },
        );
        const dataUrl = await readFileDataUrl(optimizedFile);
        if (dataUrl && dataUrlBytes(dataUrl) <= maxDataUrlBytes) {
          return { file: optimizedFile, dataUrl };
        }
      }
    }
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return null;
}
