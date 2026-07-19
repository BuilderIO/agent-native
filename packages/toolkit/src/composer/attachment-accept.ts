import { SimpleTextAttachmentAdapter } from "@assistant-ui/react";

const BASE_DOCUMENT_ATTACHMENT_ACCEPT = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf",
  ".pptx",
  ".docx",
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
].join(",");

export class TextAttachmentAdapter extends SimpleTextAttachmentAdapter {
  public accept = TEXT_ATTACHMENT_ACCEPT;
}
