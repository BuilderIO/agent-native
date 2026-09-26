import type { PromptComposerProps } from "@agent-native/core/client/composer";

import { SLIDES_REFERENCE_FILE_ACCEPT } from "../../shared/upload-types";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
]);

function getExtension(file: File): string {
  return `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
}

export function createSlidesPromptAttachmentAdapter() {
  return {
    accept: SLIDES_REFERENCE_FILE_ACCEPT,
    async add({ file }) {
      const extension = getExtension(file);
      return {
        id: crypto.randomUUID(),
        type: IMAGE_EXTENSIONS.has(extension) ? "image" : "document",
        name: file.name,
        contentType: file.type || "application/octet-stream",
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    },
    async send(attachment) {
      return { ...attachment, status: { type: "complete" }, content: [] };
    },
    async remove() {},
  } satisfies NonNullable<PromptComposerProps["attachmentAdapter"]>;
}
