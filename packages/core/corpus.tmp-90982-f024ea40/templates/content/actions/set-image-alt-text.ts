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

interface ImageAltCandidate {
  index: number;
  text: string;
  replacement: string;
}

function replaceHtmlAltAttribute(tag: string, altText: string): string {
  const escapedAlt = escapeHtmlAttribute(altText);
  return /\balt=["'][^"']*["']/.test(tag)
    ? tag.replace(/\balt=["'][^"']*["']/, `alt="${escapedAlt}"`)
    : tag.replace(/\s*\/?>$/, ` alt="${escapedAlt}" />`);
}

function imageAltCandidates({
  content,
  imageUrl,
  altText,
}: {
  content: string;
  imageUrl: string;
  altText: string;
}): ImageAltCandidate[] {
  const escapedUrl = escapeRegExp(imageUrl);
  const escapedHtmlUrl = escapeRegExp(escapeHtmlAttribute(imageUrl));
  const candidates: ImageAltCandidate[] = [];

  const markdownImagePattern = new RegExp(
    `!\\[[^\\]]*\\]\\((${escapedUrl})(\\s+"[^"]*")?\\)`,
    "g",
  );
  for (const match of content.matchAll(markdownImagePattern)) {
    if (match.index === undefined) continue;
    candidates.push({
      index: match.index,
      text: match[0],
      replacement: `![${escapeMarkdownAlt(altText)}](${match[1]}${match[2] ?? ""})`,
    });
  }

  const htmlImagePattern = new RegExp(
    `<img\\b[^>]*\\bsrc=["'](?:${escapedUrl}|${escapedHtmlUrl})["'][^>]*\\/?>`,
    "g",
  );
  for (const match of content.matchAll(htmlImagePattern)) {
    if (match.index === undefined) continue;
    candidates.push({
      index: match.index,
      text: match[0],
      replacement: replaceHtmlAltAttribute(match[0], altText),
    });
  }

  return candidates.sort((a, b) => a.index - b.index);
}

function updateImageAltInContent({
  content,
  imageUrl,
  altText,
  imageOccurrence = 0,
}: {
  content: string;
  imageUrl: string;
  altText: string;
  imageOccurrence?: number;
}): string | null {
  const candidates = imageAltCandidates({ content, imageUrl, altText });
  const target = candidates[imageOccurrence];
  if (!target) return null;

  return `${content.slice(0, target.index)}${target.replacement}${content.slice(target.index + target.text.length)}`;
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
    imageOccurrence: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Zero-based occurrence of this image URL in document order. Use this when the same image URL appears more than once.",
      ),
  }),
  run: async ({ documentId, imageUrl, altText, imageOccurrence }) => {
    const trimmedAlt = altText.trim();
    if (!trimmedAlt) throw new Error("altText cannot be empty");

    const access = await assertAccess("document", documentId, "editor");
    const existingContent = (access.resource.content as string | null) ?? "";
    const nextContent = updateImageAltInContent({
      content: existingContent,
      imageUrl,
      altText: trimmedAlt,
      imageOccurrence,
    });

    if (!nextContent) {
      throw new Error("Could not find that image URL in the document content.");
    }

    await updateDocument.run({ id: documentId, content: nextContent });

    return {
      documentId,
      imageUrl,
      imageOccurrence: imageOccurrence ?? 0,
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
