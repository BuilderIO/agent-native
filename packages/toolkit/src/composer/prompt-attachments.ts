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

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
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
