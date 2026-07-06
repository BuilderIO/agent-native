import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  normalizeImportedHtmlDocument,
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "../server/lib/import-design-files.js";
import { parseVisibleClipboardHtml } from "../server/lib/visible-clipboard-html.js";

const MAX_HTML_IMPORT_BYTES = 2 * 1024 * 1024;

function ensureHtmlSize(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_HTML_IMPORT_BYTES) {
    throw new Error("HTML import content is too large (max 2 MB).");
  }
}

function baseFilename(originalName: string | undefined, fallback: string) {
  return (originalName?.trim() || fallback).replace(/\.[^.]+$/, "") + ".html";
}

export default defineAction({
  description:
    "Import visible clipboard HTML or standalone HTML into the current Design project as an editable screen.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe("Design id. Defaults to the active editor navigation state."),
    sourceType: z.enum(["figma-paste-html", "html-string"]),
    content: z
      .string()
      .max(
        MAX_HTML_IMPORT_BYTES,
        "HTML import content is too large (max 2 MB).",
      ),
    originalName: z.string().optional(),
  }),
  run: async ({ designId, sourceType, content, originalName }) => {
    ensureHtmlSize(content);
    const resolvedDesignId = await resolveImportDesignId(designId);
    await assertAccess("design", resolvedDesignId, "editor");

    if (sourceType === "html-string") {
      const saved = await saveImportedDesignFiles({
        designId: resolvedDesignId,
        sourceType: "html-import",
        files: [
          {
            filename: baseFilename(originalName, "imported-html"),
            fileType: "html",
            content: normalizeImportedHtmlDocument(content, "HTML source"),
            source: { sourceType: "html-string", originalName },
          },
        ],
      });
      return {
        ...saved,
        stats: { sourceKind: "html-string", frameCount: saved.files.length },
      };
    }

    const parsed = parseVisibleClipboardHtml(content);
    if (!parsed.fallbackHtml) {
      throw new Error(
        "No visible HTML was found in the clipboard. Copy a frame, then paste into the canvas.",
      );
    }
    const saved = await saveImportedDesignFiles({
      designId: resolvedDesignId,
      sourceType: "figma-paste-html",
      files: [
        {
          filename: baseFilename(originalName, "figma-paste"),
          fileType: "html",
          content: normalizeImportedHtmlDocument(
            parsed.fallbackHtml,
            "visible clipboard HTML",
          ),
          source: {
            sourceType: "figma-paste-html",
          },
        },
      ],
    });
    return {
      ...saved,
      stats: {
        sourceKind: "figma-paste",
        format: "html",
        frameCount: saved.files.length,
        imageCount: 0,
      },
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: `/design/${designId}`,
      label: "Open overview",
      view: "editor",
    };
  },
});
