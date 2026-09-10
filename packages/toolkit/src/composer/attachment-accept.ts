import { SimpleTextAttachmentAdapter } from "@assistant-ui/react";

const BASE_DOCUMENT_ATTACHMENT_ACCEPT = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  ".pdf",
  ".pptx",
  ".docx",
  ".xlsx",
  ".xls",
];

export const PROMPT_DOCUMENT_ATTACHMENT_ACCEPT =
  BASE_DOCUMENT_ATTACHMENT_ACCEPT.join(",");

export const CHAT_DOCUMENT_ATTACHMENT_ACCEPT = [
  ...BASE_DOCUMENT_ATTACHMENT_ACCEPT,
  "image/svg+xml",
  ".svg",
].join(",");

export const IMAGE_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
].join(",");

export const TEXT_ATTACHMENT_ACCEPT = [
  "text/plain",
  "text/html",
  "text/markdown",
  "text/csv",
  "text/xml",
  "text/json",
  "text/css",
  "text/yaml",
  "application/json",
  "application/x-yaml",
  "message/rfc822",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
  ".eml",
].join(",");

export const MAX_TEXT_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;

export function formatOversizedTextAttachmentError(
  name: string,
  size: number,
): string {
  const mb = (size / 1024 / 1024).toFixed(1);
  const maxMb = (MAX_TEXT_ATTACHMENT_BYTES / 1024 / 1024).toFixed(1);
  return `"${name}" is ${mb} MB - text attachments are capped at ${maxMb} MB to stay within message limits. Please reduce the file size or split it into smaller parts.`;
}

export function formatAttachmentError(
  error: unknown,
  fallback: string,
): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message === "No matching adapter found for file" ||
    /^File type .* is not accepted\. Accepted types: /.test(message)
  ) {
    return fallback;
  }
  return message;
}

export class TextAttachmentAdapter extends SimpleTextAttachmentAdapter {
  public accept = TEXT_ATTACHMENT_ACCEPT;

  public async add(state: { file: File }) {
    if (state.file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      throw new Error(
        formatOversizedTextAttachmentError(state.file.name, state.file.size),
      );
    }
    return super.add(state);
  }

  public async send(
    attachment: Parameters<SimpleTextAttachmentAdapter["send"]>[0],
  ) {
    if (attachment.file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      throw new Error(
        formatOversizedTextAttachmentError(
          attachment.file.name,
          attachment.file.size,
        ),
      );
    }
    return super.send(attachment);
  }
}
