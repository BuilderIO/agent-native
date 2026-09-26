import type { PromptComposerProps } from "@agent-native/core/client/composer";

import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

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
) {
  return {
    accept: DESIGN_PROMPT_ATTACHMENT_ACCEPT,
    async add({ file }) {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(attachmentLimitMessage);
      return {
        id: crypto.randomUUID(),
        type: /\.(png|jpe?g|webp|gif)$/i.test(file.name) ? "image" : "document",
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
