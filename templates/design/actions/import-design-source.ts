import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { parseFigmaClipboardHtml } from "../server/lib/figma-import/clipboard.js";
import { importFigmaBuffer } from "../server/lib/figma-import/processor.js";
import {
  normalizeImportedHtmlDocument,
  resolveImportDesignId,
  saveImportedDesignFiles,
  type ImportedDesignFile,
} from "../server/lib/import-design-files.js";

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
    "Import Figma clipboard HTML or standalone HTML into the current Design project as one or more editable screens.",
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

    const parsed = parseFigmaClipboardHtml(content);
    const warnings: string[] = [];
    if (parsed.buffer && parsed.hasFigmaBuffer) {
      try {
        const imported = await importFigmaBuffer({
          buffer: parsed.buffer,
          filename: originalName ?? "figma-paste.fig",
          sourceKind: "figma-paste",
          selection: { nodeId: parsed.meta?.selectedNodeId },
          meta: parsed.meta,
        });
        const files: ImportedDesignFile[] = imported.files.map((file) => ({
          filename: file.filename,
          fileType: "html",
          content: file.content,
          source: file.source,
          preferredFrame: {
            title:
              typeof file.source?.frameName === "string"
                ? file.source.frameName
                : undefined,
            width: file.width,
            height: file.height,
          },
        }));
        const saved = await saveImportedDesignFiles({
          designId: resolvedDesignId,
          sourceType: "figma-paste",
          files,
          warnings: [...warnings, ...imported.warnings],
        });
        return { ...saved, stats: imported.stats };
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Figma binary payload could not be decoded: ${error.message}`
            : "Figma binary payload could not be decoded.",
        );
      }
    } else if (parsed.buffer) {
      warnings.push(
        "The clipboard included a Figma buffer, but it was not a supported fig-kiwi payload.",
      );
    }

    if (!parsed.fallbackHtml) {
      throw new Error(
        "No importable Figma frame data or visible HTML was found in the clipboard.",
      );
    }
    const saved = await saveImportedDesignFiles({
      designId: resolvedDesignId,
      sourceType: "figma-paste-fallback",
      files: [
        {
          filename: baseFilename(originalName, "figma-paste"),
          fileType: "html",
          content: normalizeImportedHtmlDocument(
            parsed.fallbackHtml,
            "Figma clipboard fallback HTML",
          ),
          source: {
            sourceType: "figma-paste-fallback",
            selectedNodeId: parsed.meta?.selectedNodeId,
            fileKey: parsed.meta?.fileKey,
          },
        },
      ],
      warnings,
    });
    return {
      ...saved,
      stats: {
        sourceKind: "figma-paste",
        format: "html-fallback",
        frameCount: saved.files.length,
        imageCount: 0,
        selectedNodeId: parsed.meta?.selectedNodeId,
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
