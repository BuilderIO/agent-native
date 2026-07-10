/**
 * Shared "legacy" Figma paste fallback: saves the visible clipboard HTML
 * (markers stripped by `parseVisibleClipboardHtml`) as a new Design screen.
 *
 * Extracted from `import-design-source.ts`'s `figma-paste-html` branch so the
 * REST-first clipboard import path (`import-figma-clipboard.ts`) can fall back
 * to the exact same behavior when node resolution can't confidently match the
 * pasted content to specific Figma nodes, instead of re-implementing it.
 */

import {
  normalizeImportedHtmlDocument,
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "./import-design-files.js";
import { parseVisibleClipboardHtml } from "./visible-clipboard-html.js";

export interface SaveFigmaPasteHtmlFallbackInput {
  designId?: string;
  clipboardHtml: string;
  originalName?: string;
}

function baseFilename(originalName: string | undefined, fallback: string) {
  return (originalName?.trim() || fallback).replace(/\.[^.]+$/, "") + ".html";
}

export async function saveFigmaPasteHtmlFallback(
  input: SaveFigmaPasteHtmlFallbackInput,
) {
  const parsed = parseVisibleClipboardHtml(input.clipboardHtml);
  if (!parsed.fallbackHtml) {
    throw new Error(
      "No visible HTML was found in the clipboard. Copy a frame, then paste into the canvas.",
    );
  }
  const designId = await resolveImportDesignId(input.designId);
  const saved = await saveImportedDesignFiles({
    designId,
    sourceType: "figma-paste-html",
    files: [
      {
        filename: baseFilename(input.originalName, "figma-paste"),
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
}
