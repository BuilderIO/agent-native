import type { PromptComposerProps } from "@agent-native/toolkit/app/chat/composer/index";

import { isVisualImageAttachment } from "@/lib/chat-image-attachments";
import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_UPLOAD_BYTES,
} from "@/lib/upload-limits";

const DESIGN_PROMPT_ATTACHMENT_ACCEPT = [
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".docx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
].join(",");

export function createDesignPromptAttachmentAdapter(
  attachmentLimitMessage: string,
  imageAttachmentLimitMessage = attachmentLimitMessage,
) {
  return {
    accept: DESIGN_PROMPT_ATTACHMENT_ACCEPT,
    async add({ file }) {
      const isImage = isVisualImageAttachment(file);
      const maxBytes = isImage ? MAX_PROMPT_ATTACHMENT_BYTES : MAX_UPLOAD_BYTES;
      if (file.size > maxBytes) {
        throw new Error(
          isImage ? imageAttachmentLimitMessage : attachmentLimitMessage,
        );
      }
      return {
        id: crypto.randomUUID(),
        type: isImage ? "image" : "document",
        name: file.name,
        contentType: file.type || "application/octet-stream",
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    },
    async send(attachment) {
      return { ...attachment, status: { type: "complete" }, content: [] };
    },
    async remove() {
      // The host eager-upload lifecycle owns server cleanup.
    },
  } satisfies NonNullable<PromptComposerProps["attachmentAdapter"]>;
}
