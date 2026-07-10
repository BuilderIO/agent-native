import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  buildFigmaNodeCandidates,
  extractVisibleTexts,
  matchFigmaClipboardNodes,
} from "../server/lib/figma-clipboard-match.js";
import {
  buildScreenFilesFromFigmaNodes,
  fetchFileStructure,
  fetchFigmaNodes,
  summarizeFidelity,
} from "../server/lib/figma-node-import.js";
import { saveFigmaPasteHtmlFallback } from "../server/lib/figma-paste-fallback.js";
import { saveImportedDesignFiles } from "../server/lib/import-design-files.js";
import { parseVisibleClipboardHtml } from "../server/lib/visible-clipboard-html.js";
import { parseFigmaFileKey } from "../shared/figma-url.js";

const NODE_STRUCTURE_DEPTH = 3;

const CREDENTIAL_MISSING_RE = /credential not configured/i;

const AMBIGUOUS_GUIDANCE =
  'Couldn\'t confidently match this paste to specific Figma nodes, so nothing was imported from the API. Paste a frame LINK instead (copy the frame in Figma, then "Copy link to selection") for an exact node import — or continue with the clipboard preview below.';

const KEY_MISSING_GUIDANCE =
  "Connect your Figma access token (Settings > Secrets > Figma access token) to import this paste as exact, editable Figma nodes. Imported from the clipboard preview instead.";

export default defineAction({
  description:
    "Import a plain clipboard paste copied from Figma (Cmd+C in Figma, Cmd+V here). Figma's clipboard marker only carries a file key, not node ids, so this heuristically matches the pasted content against the file's top-level frames by name/text and imports exact REST nodes only on a confident match; otherwise it falls back to the lossy visible-HTML preview and reports why. For a guaranteed exact import, use import-figma-frame with a copied frame LINK (which does carry a node id) instead.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe("Design id. Defaults to the active editor navigation state."),
    figmetaFileKey: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The fileKey decoded from the clipboard's figmeta marker (see app/lib/figma-clipboard.ts's extractFigmeta).",
      ),
    clipboardHtml: z
      .string()
      .describe(
        "The raw clipboard HTML (still containing the hidden figmeta/figbuffer markers) — used both for the legacy visible-HTML fallback and for node-matching against visible text.",
      ),
    originalName: z.string().optional(),
  }),
  run: async ({ designId, figmetaFileKey, clipboardHtml, originalName }) => {
    const fileKey = parseFigmaFileKey(figmetaFileKey);
    if (!fileKey) {
      throw new Error("The clipboard's Figma file key could not be parsed.");
    }

    // Legacy fallback text is needed either way: as the actual save payload
    // when we fall back, and as the "visible text" signal the matcher scores
    // candidate frames against.
    const parsedClipboard = parseVisibleClipboardHtml(clipboardHtml);
    if (!parsedClipboard.fallbackHtml) {
      throw new Error(
        "No visible HTML was found in the clipboard. Copy a frame, then paste into the canvas.",
      );
    }
    const clipboardTexts = extractVisibleTexts(parsedClipboard.fallbackHtml);

    let figmaApiKeyMissing = false;
    let matchStatus: "matched" | "ambiguous" | "none" | "error" = "error";

    try {
      const document = await fetchFileStructure(fileKey, NODE_STRUCTURE_DEPTH);
      const candidates = buildFigmaNodeCandidates(document);
      const matchResult = matchFigmaClipboardNodes(candidates, clipboardTexts);
      matchStatus = matchResult.status;

      if (matchResult.status === "matched") {
        const nodeIds = matchResult.matches.map((match) => match.id);
        const nodesById = await fetchFigmaNodes(fileKey, nodeIds);
        const { files, fidelityEntries } = await buildScreenFilesFromFigmaNodes(
          fileKey,
          nodesById,
        );
        const saved = await saveImportedDesignFiles({
          designId,
          sourceType: "figma-clipboard-rest",
          files,
        });
        return {
          ...saved,
          strategy: "restNodes" as const,
          figma: {
            fileKey,
            nodeIds,
            matched: matchResult.matches,
          },
          fidelityReport: summarizeFidelity(fidelityEntries),
          guidance:
            "Review fidelityReport.imageFallbacks for subtrees rendered as PNG and fidelityReport.approximated for properties CSS cannot express exactly.",
        };
      }
    } catch (error) {
      figmaApiKeyMissing = CREDENTIAL_MISSING_RE.test(
        error instanceof Error ? error.message : String(error),
      );
      if (!figmaApiKeyMissing) {
        // A real (non-credential) REST failure — network error, revoked
        // token, file access issue, etc. Still fall back to the honest
        // clipboard preview rather than losing the paste entirely, but this
        // isn't a "no confident match" case, so don't claim ambiguity.
        matchStatus = "error";
      }
    }

    const saved = await saveFigmaPasteHtmlFallback({
      designId,
      clipboardHtml,
      originalName,
    });
    return {
      ...saved,
      strategy: "htmlFallback" as const,
      figmaApiKeyMissing,
      matchStatus,
      figma: { fileKey },
      guidance: figmaApiKeyMissing
        ? KEY_MISSING_GUIDANCE
        : matchStatus === "ambiguous" || matchStatus === "none"
          ? AMBIGUOUS_GUIDANCE
          : "Imported the clipboard's visible-HTML preview after a Figma API error. Paste a frame link for an exact import.",
    };
  },
});
