import path from "path";

import type { AgentChatAttachment } from "@agent-native/core/server";

import {
  isSlidesReferenceFileExtension,
  MAX_REFERENCE_FILE_BYTES,
} from "../../shared/upload-types.js";
import { saveUploadedReferenceFile } from "../handlers/uploads.js";

const MAX_CHAT_UPLOAD_BYTES = MAX_REFERENCE_FILE_BYTES;
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

function decodeDataUrl(data: string | undefined): {
  bytes: Buffer;
  contentType: string;
} | null {
  const match = data?.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  return {
    contentType: match[1] || "application/octet-stream",
    bytes: Buffer.from(match[2], "base64"),
  };
}

function attachmentDataUrl(attachment: AgentChatAttachment): string | null {
  if (typeof attachment.data !== "string") return null;
  if (
    attachment.type === "image" ||
    attachment.type === "file" ||
    attachment.type === "document"
  ) {
    return attachment.data;
  }
  return null;
}

export async function prepareSlidesChatAttachments(args: {
  ownerEmail: string | null;
  message: string;
  attachments: AgentChatAttachment[];
}): Promise<{ message?: string; attachments?: AgentChatAttachment[] } | void> {
  if (!args.ownerEmail || args.attachments.length === 0) return;

  const uploaded: Array<{
    originalName: string;
    path: string;
    url?: string;
    type: string;
    size: number;
  }> = [];
  const failed: Array<{ name: string; reason: string }> = [];
  const nextAttachments = [...args.attachments];

  for (let index = 0; index < args.attachments.length; index++) {
    const attachment = args.attachments[index];
    if (!attachment) continue;
    const dataUrl = attachmentDataUrl(attachment);
    if (!dataUrl) continue;

    const ext = path.extname(attachment.name).toLowerCase();
    if (!isSlidesReferenceFileExtension(ext)) continue;

    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) continue;
    if (decoded.bytes.length > MAX_CHAT_UPLOAD_BYTES) {
      failed.push({
        name: attachment.name,
        reason: "file is larger than the 50 MB upload limit",
      });
      continue;
    }

    try {
      const saved = await saveUploadedReferenceFile({
        email: args.ownerEmail,
        originalName: attachment.name,
        data: decoded.bytes,
        type: attachment.contentType || decoded.contentType,
      });
      uploaded.push(saved);
      nextAttachments[index] = stripForwardedAttachmentData(attachment, saved);
    } catch (error) {
      failed.push({
        name: attachment.name,
        reason: error instanceof Error ? error.message : "upload failed",
      });
    }
  }

  if (uploaded.length === 0 && failed.length === 0) return;

  const fileList = uploaded
    .map(
      (file) =>
        `- ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}${file.url ? `; embeddable URL: ${file.url}` : ""}`,
    )
    .join("\n");
  const failureList = failed
    .map((file) => `- ${file.name}: ${file.reason}`)
    .join("\n");
  // saveUploadedReferenceFile() saves the file either way but swallows the
  // public-URL upload failure (missing/misbehaving file-upload provider) so
  // the private path is never blocked. Without this callout the agent has no
  // signal that embedding is impossible and silently drops the image from
  // the deck instead of telling the user why.
  const unembeddableImages = uploaded.filter(
    (file) => !file.url && file.type.startsWith("image/"),
  );
  const unembeddableImageList = unembeddableImages
    .map((file) => `- ${file.originalName}`)
    .join("\n");
  const attachmentContext = [
    "<slides-chat-attachments>",
    uploaded.length > 0
      ? [
          "The user attached file(s) in chat. They have been saved as real server upload paths that Slides import actions can read:",
          fileList,
          "",
          "File handling rules:",
          "- If the request refers to the current or visible deck, call `view-screen` first to confirm the active deckId, then pass that deckId to import or slide-edit actions.",
          '- PPTX files: when the user wants the visible deck improved, call `import-pptx --filePath "<path>" --deckId <deckId>` first, then edit those imported slide IDs in place with update-slide. Do not rebuild the source deck with add-slide.',
          '- PDF and DOCX files: call `import-file --filePath "<path>" --format auto --deckId <deckId>` and use the returned extracted text as source material before creating editable slides. For a visual PDF that the user wants preserved, beautified, or restyled from its original layout, pass `--importIntoDeck true` so each page is imported source-faithfully first; keep the full-page image and style around it, with source text persisted in slide notes for inspection.',
          '- Figma `.fig` files: call `import-file --filePath "<path>" --format fig` to start Builder design-system indexing. Do not create a local design system directly from the upload.',
          "- For deck-generation requests, start mutating promptly: create or update the first slide as soon as source material is extracted, then continue slide-by-slide with add-slide/update-slide.",
          '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
          "- Do not say no PDF/PPTX/DOCX/FIG/image was attached when a matching saved path is listed here.",
        ].join("\n")
      : "",
    unembeddableImages.length > 0
      ? [
          "The following attached image(s) have NO embeddable URL — the file-upload provider that hosts public image URLs failed or is not configured, so they were only saved to private import storage and CANNOT be embedded as `<img>` in slide HTML:",
          unembeddableImageList,
          "Do not silently skip these images. Tell the user the image(s) could not be added to the deck because no public file-upload provider is available, and that connecting Builder.io (or another file provider) in Settings will enable embedding.",
        ].join("\n")
      : "",
    failed.length > 0
      ? [
          "Some attached file(s) could not be saved to Slides upload storage:",
          failureList,
          "The binary attachment is still present in the chat request; use it directly if the model supports it, otherwise report the save error exactly.",
        ].join("\n")
      : "",
    "</slides-chat-attachments>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: `${args.message}\n\n${attachmentContext}`,
    attachments: nextAttachments,
  };
}

function stripForwardedAttachmentData(
  attachment: AgentChatAttachment,
  saved: { path: string; url?: string },
): AgentChatAttachment {
  const next = { ...attachment };
  // Keep visual data for the current model turn so uploaded screenshots remain
  // available for vision analysis; non-visual files only need their path/URL.
  const inlineImage = isVisualAttachment(attachment)
    ? decodeDataUrl(attachment.data)
    : null;
  if (!inlineImage || inlineImage.bytes.length > MAX_INLINE_IMAGE_BYTES) {
    delete next.data;
  }
  (next as any).slidesUploadPath = saved.path;
  if (saved.url) {
    (next as any).url = saved.url;
  }
  return next;
}

function isVisualAttachment(attachment: AgentChatAttachment): boolean {
  return (
    attachment.type === "image" ||
    (typeof attachment.contentType === "string" &&
      attachment.contentType.toLowerCase().startsWith("image/"))
  );
}
