export interface AgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function formatPromptWithAttachments(
  prompt: string,
  attachments: readonly AgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type
        ? ` type="${escapePromptAttachmentAttribute(attachment.type)}"`
        : "";
      if (attachment.dataUrl) {
        return `<attached-image name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}>\n${attachment.dataUrl}\n</attached-image>`;
      }
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      return `<attached-file name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}>\n${body}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

export const AGENT_PROMPT_MAX_INLINE_TEXT_CHARS = 60_000;
export const AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ReadAgentPromptAttachmentOptions {
  maxInlineTextChars?: number;
  maxInlineImageBytes?: number;
  maxImageDimensionPx?: number;
}

const MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OPTIMIZABLE_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;

export async function readAgentPromptAttachment(
  file: File,
  options: ReadAgentPromptAttachmentOptions = {},
): Promise<AgentPromptAttachment> {
  const maxInlineTextChars =
    options.maxInlineTextChars ?? AGENT_PROMPT_MAX_INLINE_TEXT_CHARS;
  const maxInlineImageBytes =
    options.maxInlineImageBytes ?? AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES;
  const maxImageDimensionPx = options.maxImageDimensionPx ?? 2048;
  const attachment: AgentPromptAttachment = {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
  };

  if (isInlineableAgentPromptFile(file) && file.size <= maxInlineTextChars) {
    try {
      attachment.text = await file.text();
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  } else if (file.type.startsWith("image/")) {
    try {
      if (file.size <= maxInlineImageBytes) {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } else if (isRasterImageMediaType(file.type)) {
        const optimized = await optimizeAgentPromptImage(file, {
          maxBytes: maxInlineImageBytes,
          maxDimensionPx: maxImageDimensionPx,
        });
        if (optimized) {
          attachment.type = optimized.type;
          attachment.dataUrl = await readBlobAsDataUrl(optimized);
        }
      }
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  }

  return attachment;
}

export function isInlineableAgentPromptFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(cjs|css|csv|html|js|json|jsx|md|mdx|mjs|sql|tsx?|txt|xml|yaml|yml)$/i.test(
    file.name,
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

const RASTER_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isRasterImageMediaType(mediaType: string): boolean {
  return RASTER_IMAGE_TYPES.has(
    mediaType.split(";", 1)[0]!.trim().toLowerCase(),
  );
}

async function optimizeAgentPromptImage(
  file: File,
  options: { maxBytes: number; maxDimensionPx: number },
): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;

  if (file.size > MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES) return null;
  const dimensions = await readRasterImageDimensions(file);
  if (
    !dimensions ||
    dimensions.width * dimensions.height > MAX_OPTIMIZABLE_IMAGE_PIXELS
  ) {
    return null;
  }

  const scale = Math.min(
    1,
    options.maxDimensionPx / Math.max(dimensions.width, dimensions.height),
  );
  const resizeWidth = Math.max(1, Math.round(dimensions.width * scale));
  const resizeHeight = Math.max(1, Math.round(dimensions.height * scale));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth,
      resizeHeight,
      resizeQuality: "high",
    });
  } catch {
    // coercion-ok: failed resizing keeps the original upload for server hydration or a typed size-limit explanation.
    return null;
  }

  try {
    if (!bitmap.width || !bitmap.height) return null;
    let scale = Math.min(
      1,
      options.maxDimensionPx / Math.max(bitmap.width, bitmap.height),
    );
    const minScale = Math.min(
      scale,
      256 / Math.max(bitmap.width, bitmap.height),
    );

    while (scale >= minScale) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const png = await canvasToBlob(canvas, "image/png");
      if (png && png.size <= options.maxBytes) return png;

      context.save();
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
      const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.9);
      if (jpeg && jpeg.size <= options.maxBytes) return jpeg;

      if (scale === minScale) break;
      scale = Math.max(minScale, scale * 0.8);
    }
    return null;
  } finally {
    bitmap.close();
  }
}

async function readRasterImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(
    await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const dimensions = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(1, 3) === "PNG" &&
    ascii(12, 4) === "IHDR"
  ) {
    return dimensions(view.getUint32(16), view.getUint32(20));
  }

  if (
    bytes.length >= 10 &&
    (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")
  ) {
    return dimensions(view.getUint16(6, true), view.getUint16(8, true));
  }

  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
      return dimensions(width, height);
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      const bits =
        bytes[21]! +
        (bytes[22]! << 8) +
        (bytes[23]! << 16) +
        (bytes[24]! << 24);
      return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a &&
      bytes.length >= 30
    ) {
      const width = (view.getUint16(26, true) & 0x3fff) + 0;
      const height = (view.getUint16(28, true) & 0x3fff) + 0;
      return dimensions(width, height);
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset + 1] === 0xff) offset += 1;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
        return dimensions(
          view.getUint16(offset + 7),
          view.getUint16(offset + 5),
        );
      }
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch (error) {
      reject(error);
    }
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read optimized image"));
    reader.readAsDataURL(blob);
  });
}
