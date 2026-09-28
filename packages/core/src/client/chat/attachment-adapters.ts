import {
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  formatOversizedTextAttachmentError,
  IMAGE_ATTACHMENT_ACCEPT,
  MAX_TEXT_ATTACHMENT_BYTES as MAX_TEXT_FILE_BYTES,
} from "@agent-native/toolkit/composer/attachment-accept";
import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  Attachment,
} from "@assistant-ui/react";

export const MAX_PDF_BYTES = 2.5 * 1024 * 1024;

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_NON_ATTACHMENT_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 4.5 * 1024 * 1024;
export const MAX_ESTIMATED_BODY_BYTES =
  MAX_REQUEST_BODY_BYTES - MAX_NON_ATTACHMENT_BODY_BYTES;
export const MAX_TEXT_ATTACHMENT_BYTES = MAX_TEXT_FILE_BYTES;
export const AGGRESSIVE_MAX_IMAGE_DIMENSION = 1024;
export const AGGRESSIVE_JPEG_QUALITY = 0.7;

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
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (file.name.toLowerCase().endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
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
  const maxMb = Number((MAX_PDF_BYTES / 1024 / 1024).toFixed(1)).toString();
  return `"${name}" is ${mb} MB - documents are capped at ${maxMb} MB to stay within message limits. Please reduce the file size or split it into smaller parts.`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode pasted image"));
    img.src = url;
  });
}

function isWebSafeImageType(mimeType: string): boolean {
  return WEB_SAFE_IMAGE_TYPES.has(mimeType.toLowerCase());
}

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

export async function getImageFileDataURL(file: File): Promise<string> {
  const needsTranscode = !isWebSafeImageType(file.type);
  const tooBig = file.size > MAX_IMAGE_BYTES;

  if (!needsTranscode && !tooBig) {
    return getFileDataURL(file);
  }

  if (typeof document === "undefined" || typeof Image === "undefined") {
    if (needsTranscode) {
      throw new Error(
        `"${file.name}" is a ${file.type || "unknown"} image. Only JPEG, PNG, GIF, and WebP are supported in this environment.`,
      );
    }
    return getFileDataURL(file);
  }

  try {
    return await transcodeImageToDataURL(file);
  } catch (err) {
    if (needsTranscode) {
      throw err;
    }
    return getFileDataURL(file);
  }
}

export function measureJsonStringBytes(values: string[]): number {
  const encodedBytes = new TextEncoder();
  return values.reduce(
    (sum, value) => sum + encodedBytes.encode(JSON.stringify(value)).byteLength,
    0,
  );
}

export function getSubmittedPromptBodyStrings(
  prompt: string,
  isContinuation: boolean,
): string[] {
  return isContinuation ? [prompt, prompt, prompt] : [prompt, prompt];
}

export function estimateAttachmentBodyBytes(values: string[]): number {
  return measureJsonStringBytes(values) * 1.15;
}

export type QueuedAttachment = CompleteAttachment & {
  metadata?: Record<string, unknown>;
};

export function getAttachmentBodyStrings(
  attachments: ReadonlyArray<QueuedAttachment>,
): string[] {
  return attachments.flatMap((attachment) =>
    attachment.content.flatMap((part) => {
      if (part.type === "image" && typeof part.image === "string") {
        return [part.image];
      }
      if (part.type === "text" && typeof part.text === "string") {
        return [part.text];
      }
      if (
        part.type === "file" &&
        typeof (part as { data?: unknown }).data === "string"
      ) {
        return [(part as { data: string }).data];
      }
      return [];
    }),
  );
}

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
  if (
    file.type === "application/json" ||
    file.type === "application/x-yaml" ||
    file.type === "message/rfc822"
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|json|yaml|yml|html?|css|xml|eml)$/i.test(
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
  if (part.type === "file" && typeof part.url === "string") {
    return {
      type: "file",
      url: part.url,
      mimeType:
        typeof part.mimeType === "string"
          ? part.mimeType
          : "application/octet-stream",
      ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
    } as unknown as QueuedAttachment["content"][number];
  }
  return null;
}

export async function serializeQueuedAttachments(
  attachments?: ReadonlyArray<unknown>,
): Promise<QueuedAttachment[] | undefined> {
  const queued: QueuedAttachment[] = [];
  for (const raw of attachments ?? []) {
    const attachment = raw as Partial<Attachment> & {
      displayOnly?: boolean;
      file?: File;
      text?: string;
    };
    const name = attachment.name || attachment.file?.name || "attachment";
    const id = attachment.id || name;
    const type = attachment.type || "file";
    const contentType = attachment.contentType || attachment.file?.type;

    if (attachment.displayOnly === true) {
      queued.push({
        id,
        type,
        name,
        contentType,
        status: { type: "complete" },
        content:
          typeof attachment.text === "string"
            ? [{ type: "text", text: attachment.text }]
            : [],
        metadata: { displayOnly: true },
      });
      continue;
    }

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
        if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
          throw new Error(
            formatOversizedTextAttachmentError(file.name, file.size),
          );
        }
        const text = await file.text();
        queued.push({
          id,
          type: "file",
          name,
          contentType: file.type || "text/plain",
          status: { type: "complete" },
          content: [
            {
              type: "text",
              text: textFileAttachmentEnvelope(file, text),
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
