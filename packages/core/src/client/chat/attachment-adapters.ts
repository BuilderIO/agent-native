// Owns: image/document/text attachment adapters and attachment serialization helpers.

import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  Attachment,
} from "@assistant-ui/react";

import {
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  IMAGE_ATTACHMENT_ACCEPT,
} from "../composer/attachment-accept.js";

// Maximum PDF/document size (4 MB). Larger PDFs would bloat the JSON POST
// body past Vercel's ~4.5 MB limit after base64 encoding (+33% overhead).
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

// Anthropic / OpenAI vision inputs choke on multi-megabyte images, and
// base64-encoding a raw screenshot eats enough heap to crash the composer
// (PayloadTooLarge / "Maximum call stack" in serializers). Downscale large
// images on the client before we ever serialize them.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2048;
// Estimated total serialized body budget (JSON POST). Vercel/Netlify cap ~4.5 MB.
// We stop well below to leave room for the text payload and JSON framing.
export const MAX_ESTIMATED_BODY_BYTES = 3.5 * 1024 * 1024;
// At 3.5 MB of serializable attachments, aggressively re-downscale images.
export const AGGRESSIVE_MAX_IMAGE_DIMENSION = 1024;
export const AGGRESSIVE_JPEG_QUALITY = 0.7;

/** MIME types that vision models accept natively (no canvas transcoding needed). */
const WEB_SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function inferDocumentContentType(file: File): string {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (file.name.toLowerCase().endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function getFileDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function formatOversizedDocumentError(name: string, size: number): string {
  const mb = (size / 1024 / 1024).toFixed(1);
  const maxMb = (MAX_PDF_BYTES / 1024 / 1024).toFixed(0);
  return `"${name}" is ${mb} MB — PDFs are capped at ${maxMb} MB to stay within message limits. Please reduce the file size or split it into smaller parts.`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode pasted image"));
    img.src = url;
  });
}

/**
 * Returns true when the MIME type is natively accepted by vision APIs
 * (jpeg / png / gif / webp). HEIC, TIFF, AVIF, BMP, etc. return false.
 */
function isWebSafeImageType(mimeType: string): boolean {
  return WEB_SAFE_IMAGE_TYPES.has(mimeType.toLowerCase());
}

/**
 * Transcode an image to a web-safe JPEG or PNG via canvas and return its
 * data-URL. Throws if canvas is unavailable.
 */
export async function transcodeImageToDataURL(
  file: File,
  opts: {
    maxDimension?: number;
    jpegQuality?: number;
  } = {},
): Promise<string> {
  const maxDimension = opts.maxDimension ?? MAX_IMAGE_DIMENSION;
  const jpegQuality = opts.jpegQuality ?? 0.85;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const ratio = Math.min(
      maxDimension / img.naturalWidth,
      maxDimension / img.naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(img.naturalWidth * ratio));
    const height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    const keepPng =
      file.type === "image/png" && file.size <= MAX_IMAGE_BYTES * 2;
    return canvas.toDataURL(keepPng ? "image/png" : "image/jpeg", jpegQuality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Return a web-safe, size-bounded data-URL for an image file.
 *
 * - Always transcodes formats that vision APIs reject (HEIC, TIFF, AVIF, BMP, …)
 *   to JPEG/PNG via canvas, regardless of file size.
 * - Also downscales files over MAX_IMAGE_BYTES so large screenshots/photos
 *   don't blow up the request body.
 * - Throws (does NOT silently fall back) when the format is non-web-safe and
 *   canvas transcoding fails — the adapter should surface a visible error.
 */
export async function getImageFileDataURL(file: File): Promise<string> {
  const needsTranscode = !isWebSafeImageType(file.type);
  const tooBig = file.size > MAX_IMAGE_BYTES;

  if (!needsTranscode && !tooBig) {
    // Already a supported type and within size budget — serve raw.
    return getFileDataURL(file);
  }

  if (typeof document === "undefined" || typeof Image === "undefined") {
    if (needsTranscode) {
      // Can't transcode server-side — surface an error rather than silently
      // attaching garbage bytes that the model cannot decode.
      throw new Error(
        `"${file.name}" is a ${file.type || "unknown"} image. Only JPEG, PNG, GIF, and WebP are supported in this environment.`,
      );
    }
    // Can't downscale but the type is fine — send raw and hope for the best.
    return getFileDataURL(file);
  }

  // Transcode via canvas. Throws on decode failure for non-web-safe types
  // so the adapter can surface a visible error; falls back to raw for
  // oversized-but-supported types (the older behaviour).
  try {
    return await transcodeImageToDataURL(file);
  } catch (err) {
    if (needsTranscode) {
      // Re-throw so the DownscalingImageAttachmentAdapter.send() can surface it.
      throw err;
    }
    // Safe type, just couldn't downscale — fall back to the raw file.
    return getFileDataURL(file);
  }
}

/**
 * Estimate the serialized byte cost of a collection of attachment data-URLs
 * (base64 strings, accounting for JSON string escaping overhead).
 */
export function estimateAttachmentBodyBytes(dataUrls: string[]): number {
  // JSON.stringify adds ~2 bytes of quotes per string; base64 is already
  // accounted for in the string length. Add 15% for JSON framing.
  return dataUrls.reduce((sum, url) => sum + url.length, 0) * 1.15;
}

export type QueuedAttachment = CompleteAttachment;

export class DownscalingImageAttachmentAdapter implements AttachmentAdapter {
  public accept = IMAGE_ATTACHMENT_ACCEPT;

  public async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "image",
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(
    attachment: PendingAttachment,
  ): Promise<CompleteAttachment> {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "image",
          image: await getImageFileDataURL(attachment.file),
        },
      ],
    };
  }

  public async remove() {
    // noop
  }
}

export class BinaryDocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = CHAT_DOCUMENT_ATTACHMENT_ACCEPT;

  public async add(state: { file: File }): Promise<PendingAttachment> {
    if (state.file.size > MAX_PDF_BYTES) {
      throw new Error(
        formatOversizedDocumentError(state.file.name, state.file.size),
      );
    }
    return {
      id: state.file.name,
      type: "document",
      name: state.file.name,
      contentType: inferDocumentContentType(state.file),
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(
    attachment: PendingAttachment,
  ): Promise<CompleteAttachment> {
    if (attachment.file && attachment.file.size > MAX_PDF_BYTES) {
      throw new Error(
        formatOversizedDocumentError(attachment.name, attachment.file.size),
      );
    }
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data: await getFileDataURL(attachment.file),
          mimeType: inferDocumentContentType(attachment.file),
        },
      ],
    };
  }

  public async remove() {
    // noop
  }
}

export function imageContentTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match?.[1] || "image/jpeg";
}

export function imageExtensionFromContentType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

export function createAgentImageAttachments(
  images?: readonly string[],
): QueuedAttachment[] | undefined {
  const validImages = (images ?? []).filter((image) => image.trim().length > 0);
  if (validImages.length === 0) return undefined;

  return validImages.map((image, index) => {
    const contentType = imageContentTypeFromDataUrl(image);
    const extension = imageExtensionFromContentType(contentType);
    const name = `image-${index + 1}.${extension}`;
    return {
      id: `agent-chat-image-${index + 1}`,
      type: "image",
      name,
      contentType,
      status: { type: "complete" },
      content: [{ type: "image", image }],
    };
  });
}

function escapeQueuedAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return /\.(txt|md|markdown|csv|json|yaml|yml|html?|css|xml)$/i.test(
    file.name,
  );
}

function isSvgFile(file: File): boolean {
  const contentType = file.type.split(";")[0]?.trim().toLowerCase();
  return contentType === "image/svg+xml" || /\.svg$/i.test(file.name);
}

export function textFileAttachmentEnvelope(file: File, text: string): string {
  const contentType = file.type || "text/plain";
  return `<attachment name="${escapeQueuedAttachmentAttribute(file.name)}" contentType="${escapeQueuedAttachmentAttribute(contentType)}">\n${text}\n</attachment>`;
}

export function serializeAttachmentContentPart(
  part: Record<string, unknown>,
): QueuedAttachment["content"][number] | null {
  if (part.type === "image" && typeof part.image === "string") {
    return { type: "image", image: part.image };
  }
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.type === "file" && typeof part.data === "string") {
    return {
      type: "file",
      data: part.data,
      mimeType:
        typeof part.mimeType === "string"
          ? part.mimeType
          : "application/octet-stream",
      ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
    };
  }
  return null;
}

export async function serializeQueuedAttachments(
  attachments?: ReadonlyArray<unknown>,
): Promise<QueuedAttachment[] | undefined> {
  const queued: QueuedAttachment[] = [];
  for (const raw of attachments ?? []) {
    const attachment = raw as Partial<Attachment> & { file?: File };
    const name = attachment.name || attachment.file?.name || "attachment";
    const id = attachment.id || name;
    const type = attachment.type || "file";
    const contentType = attachment.contentType || attachment.file?.type;

    if (Array.isArray(attachment.content) && attachment.content.length > 0) {
      const content = attachment.content
        .map((part) =>
          serializeAttachmentContentPart(part as Record<string, unknown>),
        )
        .filter((part): part is QueuedAttachment["content"][number] => !!part);
      if (content.length > 0) {
        queued.push({
          id,
          type,
          name,
          contentType,
          status: { type: "complete" },
          content,
        });
      }
      continue;
    }

    if (typeof File !== "undefined" && attachment.file instanceof File) {
      const file = attachment.file;
      if (isSvgFile(file)) {
        const contentType = inferDocumentContentType(file);
        queued.push({
          id,
          type: "document",
          name,
          contentType,
          status: { type: "complete" },
          content: [
            {
              type: "file",
              filename: file.name,
              data: await getFileDataURL(file),
              mimeType: contentType,
            },
          ],
        });
      } else if (file.type.startsWith("image/")) {
        queued.push({
          id,
          type: "image",
          name,
          contentType: file.type,
          status: { type: "complete" },
          content: [{ type: "image", image: await getImageFileDataURL(file) }],
        });
      } else if (isTextLikeFile(file)) {
        queued.push({
          id,
          type: "file",
          name,
          contentType: file.type || "text/plain",
          status: { type: "complete" },
          content: [
            {
              type: "text",
              text: textFileAttachmentEnvelope(file, await file.text()),
            },
          ],
        });
      } else {
        queued.push({
          id,
          type: "document",
          name,
          contentType: inferDocumentContentType(file),
          status: { type: "complete" },
          content: [
            {
              type: "file",
              filename: file.name,
              data: await getFileDataURL(file),
              mimeType: inferDocumentContentType(file),
            },
          ],
        });
      }
    }
  }

  return queued.length > 0 ? queued : undefined;
}
