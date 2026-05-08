import { SimpleTextAttachmentAdapter } from "@assistant-ui/react";

export const PROMPT_DOCUMENT_ATTACHMENT_ACCEPT = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf",
  ".pptx",
  ".docx",
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
