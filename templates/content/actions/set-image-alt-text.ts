import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import updateDocument from "./update-document.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function updateImageAltInContent({
  content,
  imageUrl,
  altText,
}: {
  content: string;
  imageUrl: string;
  altText: string;
}): string | null {
  const escapedUrl = escapeRegExp(imageUrl);
  const escapedHtmlUrl = escapeRegExp(escapeHtmlAttribute(imageUrl));

  const markdownImagePattern = new RegExp(
    `!\\[[^\\]]*\\]\\((${escapedUrl})(\\s+\"[^\"]*\")?\\)`,
  );
  if (markdownImagePattern.test(content)) {
    return content.replace(
      markdownImagePattern,
      `![${escapeMarkdownAlt(altText)}]($1$2)`,
    );
  }

  const htmlImagePattern = new RegExp(
    `<img\\b([^>]*\\bsrc=["'](?:${escapedUrl}|${escapedHtmlUrl})["'][^>]*)>`,
  );
  const htmlMatch = content.match(htmlImagePattern);
  if (!htmlMatch) return null;

  const fullTag = htmlMatch[0];
  const escapedAlt = escapeHtmlAttribute(altText);
  const nextTag = /\balt=["'][^"']*["']/.test(fullTag)
    ? fullTag.replace(/\balt=["'][^"']*["']/, `alt="${escapedAlt}"`)
    : fullTag.replace(/\s*\/?>$/, ` alt="${escapedAlt}" />`);

  return content.replace(fullTag, nextTag);
}

export default defineAction({
  description:
    "Set alt text for a specific image in a Content document by image URL.",
  schema: z.object({
    documentId: z.string().describe("Document ID containing the image"),
    imageUrl: z.string().describe("Image URL whose alt text should be updated"),
    altText: z
      .string()
      .describe("Concise alt text describing the image for accessibility"),
  }),
  run: async ({ documentId, imageUrl, altText }) => {
    const trimmedAlt = altText.trim();
    if (!trimmedAlt) throw new Error("altText cannot be empty");

    const access = await assertAccess("document", documentId, "editor");
    const existingContent = (access.resource.content as string | null) ?? "";
    const nextContent = updateImageAltInContent({
      content: existingContent,
      imageUrl,
      altText: trimmedAlt,
    });

    if (!nextContent) {
      throw new Error("Could not find that image URL in the document content.");
    }

    await updateDocument.run({ id: documentId, content: nextContent });

    return {
      documentId,
      imageUrl,
      altTextUpdated: true,
      altTextLength: trimmedAlt.length,
      altTextWordCount: countWords(trimmedAlt),
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
    };
  },
  link: ({ result }) => {
    const id = (result as { documentId?: string } | null)?.documentId;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
