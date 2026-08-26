import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { importFigmaClipboardFromBuffer } from "../server/lib/figma-clipboard-local-decode.js";
import {
  buildFigmaNodeCandidates,
  extractVisibleTexts,
  matchFigmaClipboardNodes,
  type FigmaClipboardMatchReason,
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

// Also matches a Figma 403 that occurs when the token is saved but lacks
// file_content:read scope — the validator only checks current_user:read.
const CREDENTIAL_MISSING_RE =
  /credential not configured|figma.*request failed:.*403|figma.*request failed:.*forbidden/i;
// Transient errors should not block local-kiwi fallback when the buffer is present.
const TRANSIENT_ERROR_RE =
  /quota cooldown|provider.*quota|rate.?limit|fetch failed|network.*error|timeout|ECONNRESET|ENOTFOUND|ERR_NETWORK/i;
const DURABLE_STORAGE_REQUIRED_RE =
  /authenticated user so assets can be stored durably|could not store a Figma image durably|needs durable file storage/i;

const AMBIGUOUS_GUIDANCE =
  'Couldn\'t confidently match this paste to specific Figma nodes, so nothing was imported from the API. Paste a frame LINK instead (copy the frame in Figma, then "Copy link to selection") for an exact node import — or continue with the clipboard preview below.';

/**
 * A paste that imports nothing must say which of the four strategies refused
 * and why. Returning a bare empty result is what "I pasted and nothing
 * happened" looks like from the user's side.
 */
function matchReasonGuidance(
  reason: FigmaClipboardMatchReason | undefined,
  candidateNames: string[] | undefined,
): string | null {
  const named = candidateNames?.length
    ? ` Candidates: ${candidateNames.slice(0, 5).join(", ")}.`
    : "";
  switch (reason) {
    case "no-candidates":
      return "This Figma file has no top-level frames to match the paste against.";
    case "too-many-name-matches":
      return `Too many frames in the file share the pasted layer names to pick one safely, so nothing was imported from the API.${named}`;
    case "tied-text-matches":
      return `Several frames contain the same pasted text, so no single frame could be picked.${named}`;
    case "no-text-overlap":
      return "None of the file's top-level frames contain the text in this paste, so no frame could be identified.";
    default:
      return null;
  }
}

function describeOmittedBuffer(bytes: number | undefined): string | null {
  if (!bytes) return null;
  return `This Figma selection carries ${Math.round(bytes / 1024 / 1024)} MB of clipboard data, more than a paste request can transport. Import the .fig file instead, or copy fewer layers at a time.`;
}

const KEY_MISSING_GUIDANCE =
  "Connect your Figma access token (Settings > Integrations > API keys) to import this paste as exact, editable Figma nodes.";
const SELECTION_TRUNCATED_GUIDANCE =
  "Figma copied more than 100 selected nodes. Imported the first 100; split larger selections into smaller pastes so every layer is included.";

export default defineAction({
  description:
    "Import a clipboard paste copied from Figma (Cmd+C in Figma, Cmd+V here). Current Figma clients include exact selected node ids in the figmeta marker, so those nodes are fetched directly through the Figma REST API. Older or changed clipboard formats fall back to a conservative name/text match, then to any visible HTML preview. A saved FIGMA_ACCESS_TOKEN is required for REST import; a copied frame link remains the stable public-contract path.",
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
    selectedNodeIds: z
      .array(
        z
          .string()
          .max(64)
          .regex(/^\d+:\d+$/),
      )
      .max(100)
      .optional()
      .describe(
        "Exact selected node ids decoded from Figma's current selectedNodeData clipboard field. Omit for older clipboard formats.",
      ),
    selectedNodeIdsTruncated: z
      .boolean()
      .optional()
      .describe(
        "True when the client capped a Figma clipboard selection to the first 100 exact node ids.",
      ),
    clipboardHtml: z
      .string()
      .describe(
        "Figma clipboard HTML used for fallback matching. When exact node ids are present, the client removes the large private data-buffer while retaining figmeta and visible HTML.",
      ),
    clipboardBuffer: z
      .string()
      .max(15_000_000)
      .optional()
      .describe(
        "Base64-encoded fig-kiwi binary from the clipboard's data-buffer. Present when the client used the local-kiwi strategy (no Figma access token). The server decodes this to build editable HTML from geometry, text, and fills without a REST call.",
      ),
    clipboardBufferOmittedBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Decoded size of a clipboard buffer the client could not transport (see app/lib/figma-clipboard.ts). Present instead of clipboardBuffer for oversized selections so this action can name the reason rather than importing nothing.",
      ),
    originalName: z.string().optional(),
  }),
  run: async ({
    designId,
    figmetaFileKey,
    selectedNodeIds,
    selectedNodeIdsTruncated,
    clipboardHtml,
    clipboardBuffer,
    clipboardBufferOmittedBytes,
    originalName,
  }) => {
    const fileKey = parseFigmaFileKey(figmetaFileKey);
    if (!fileKey) {
      throw new Error("The clipboard's Figma file key could not be parsed.");
    }

    // Current Figma clipboard HTML commonly contains only figmeta + the
    // private binary figma buffer, with no visible HTML at all. Exact REST ids
    // must therefore run before requiring the legacy preview/matching signal.
    const parsedClipboard = parseVisibleClipboardHtml(clipboardHtml);
    const clipboardTexts = parsedClipboard.fallbackHtml
      ? extractVisibleTexts(parsedClipboard.fallbackHtml)
      : [];

    let figmaApiKeyMissing = false;
    let matchStatus: "matched" | "ambiguous" | "none" | "error" = "error";
    let matchReason: FigmaClipboardMatchReason | undefined;
    let matchCandidateNames: string[] | undefined;
    let restError: string | null = null;
    let localDecodeError: string | null = null;
    const oversizeGuidance = describeOmittedBuffer(clipboardBufferOmittedBytes);

    try {
      if (selectedNodeIds?.length) {
        const nodesById = await fetchFigmaNodes(fileKey, selectedNodeIds);
        const { files, fidelityEntries, missingImageFillCount } =
          await buildScreenFilesFromFigmaNodes(fileKey, nodesById);
        const saved = await saveImportedDesignFiles({
          designId,
          sourceType: "figma-clipboard-rest",
          files,
        });
        const selectionWarnings = selectedNodeIdsTruncated
          ? [SELECTION_TRUNCATED_GUIDANCE]
          : [];
        const fillWarnings =
          missingImageFillCount > 0
            ? [
                `${missingImageFillCount} image fill${missingImageFillCount === 1 ? "" : "s"} could not be fetched from Figma and were omitted. This can happen for deleted images or very large assets.`,
              ]
            : [];
        return {
          ...saved,
          warnings: [...saved.warnings, ...selectionWarnings, ...fillWarnings],
          strategy: "restNodes" as const,
          figma: {
            fileKey,
            nodeIds: selectedNodeIds,
            matchSource: "clipboardNodeIds" as const,
            selectionTruncated: selectedNodeIdsTruncated === true,
          },
          fidelityReport: summarizeFidelity(fidelityEntries),
          guidance: selectedNodeIdsTruncated
            ? `${SELECTION_TRUNCATED_GUIDANCE} Review fidelityReport for conversion details.`
            : "Imported the exact nodes selected in Figma. Review fidelityReport.imageFallbacks for subtrees rendered as PNG and fidelityReport.approximated for properties CSS cannot express exactly.",
        };
      }

      if (clipboardTexts.length === 0) {
        matchStatus = "none";
        throw new Error(
          "The Figma clipboard did not include exact node ids or visible text for matching.",
        );
      }

      const document = await fetchFileStructure(fileKey, NODE_STRUCTURE_DEPTH);
      const candidates = buildFigmaNodeCandidates(document);
      const matchResult = matchFigmaClipboardNodes(candidates, clipboardTexts);
      matchStatus = matchResult.status;
      matchReason = matchResult.reason;
      matchCandidateNames = matchResult.candidateNames;

      if (matchResult.status === "matched") {
        const nodeIds = matchResult.matches.map((match) => match.id);
        const nodesById = await fetchFigmaNodes(fileKey, nodeIds);
        const { files, fidelityEntries, missingImageFillCount } =
          await buildScreenFilesFromFigmaNodes(fileKey, nodesById);
        const saved = await saveImportedDesignFiles({
          designId,
          sourceType: "figma-clipboard-rest",
          files,
        });
        const fillWarnings =
          missingImageFillCount > 0
            ? [
                `${missingImageFillCount} image fill${missingImageFillCount === 1 ? "" : "s"} could not be fetched from Figma and were omitted.`,
              ]
            : [];
        return {
          ...saved,
          warnings: [...(saved.warnings ?? []), ...fillWarnings],
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // The importer intentionally refuses to persist Figma's expiring render
      // URLs. Keep its actionable storage setup error instead of disguising it
      // as an ordinary clipboard-format fallback.
      if (DURABLE_STORAGE_REQUIRED_RE.test(errorMessage)) {
        throw error;
      }
      restError = errorMessage;
      figmaApiKeyMissing = CREDENTIAL_MISSING_RE.test(errorMessage);
      const isTransient = TRANSIENT_ERROR_RE.test(errorMessage);
      if (
        selectedNodeIds?.length &&
        !parsedClipboard.fallbackHtml &&
        !figmaApiKeyMissing &&
        (!isTransient || !clipboardBuffer)
      ) {
        // Exact ids prove this was a current Figma clipboard. With no visible
        // fallback, a permanent REST failure must surface as a real error rather
        // than silently degrading. Transient errors fall through to local-kiwi
        // only when a buffer is present to decode; without a buffer there is
        // nothing to fall back to, so even transient errors must propagate.
        throw error;
      }
      if (!figmaApiKeyMissing) {
        matchStatus = "error";
      }
    }

    // Local-kiwi fallback: decode the binary buffer when REST failed for any
    // reason (missing token, 403, quota cooldown, network error) and the buffer
    // is present. Always produces editable geometry, text, and auto-layout.
    // IMAGE fills land as about:blank placeholders that hydrate-figma-paste-images
    // resolves retroactively once the quota clears or the token is configured.
    if ((figmaApiKeyMissing || matchStatus === "error") && clipboardBuffer) {
      try {
        const localResult = await importFigmaClipboardFromBuffer({
          bufferBase64: clipboardBuffer,
          fileKey,
          originalName,
        });
        if (localResult.files.length > 0) {
          const saved = await saveImportedDesignFiles({
            designId,
            sourceType: "figma-clipboard-local-kiwi",
            files: localResult.files,
          });
          return {
            ...saved,
            warnings: [...saved.warnings, ...localResult.warnings],
            strategy: "localKiwi" as const,
            figmaApiKeyMissing,
            figma: { fileKey, selectedNodeIds },
            unresolvedImages: localResult.unresolvedImageRefs.length,
            fidelityReport: {
              exactCount: 0,
              approximated: [],
              imageFallbacks: [],
              unresolvedImages: localResult.unresolvedImageRefs.length,
            },
            guidance:
              localResult.unresolvedImageRefs.length > 0
                ? `Imported from Figma using local decode — geometry, text, and styles are editable. ${localResult.unresolvedImageRefs.length} image${localResult.unresolvedImageRefs.length === 1 ? "" : "s"} need a Figma access token to load. Connect Figma in Settings to fill them in, or use "Copy as PNG" for individual images.`
                : "Imported from Figma using local decode — geometry, text, and styles are fully editable. Connect Figma in Settings for highest-fidelity REST imports.",
          };
        }
        localDecodeError =
          "the .fig clipboard buffer decoded to zero frames (an unsupported or truncated clipboard format)";
      } catch (error) {
        // Never swallow this: without the reason, a failed local decode and a
        // successful empty import are indistinguishable downstream.
        localDecodeError =
          error instanceof Error ? error.message : String(error);
      }
    }

    // Every reason this paste could not produce screens, in the order the
    // strategies were attempted. This is the message a user gets instead of a
    // paste that appears to do nothing.
    const reasons = [
      oversizeGuidance,
      figmaApiKeyMissing ? KEY_MISSING_GUIDANCE : null,
      matchReasonGuidance(matchReason, matchCandidateNames),
      // Already a self-describing sentence ("Figma request failed: ...", or the
      // clipboard-shape error raised above); a prefix would mislabel half of them.
      !figmaApiKeyMissing && restError ? restError : null,
      localDecodeError
        ? `Local clipboard decode failed: ${localDecodeError}`
        : null,
    ].filter((entry): entry is string => Boolean(entry));

    if (!parsedClipboard.fallbackHtml) {
      const noFallbackNote = oversizeGuidance
        ? "Nothing was imported."
        : "This Figma clipboard carried no exact node ids and no browser-readable HTML, so nothing was imported. Paste a frame link, or import the .fig file, for an exact import.";
      return {
        designId,
        files: [],
        warnings: [],
        strategy: "htmlFallback" as const,
        figmaApiKeyMissing,
        matchStatus,
        matchReason,
        clipboardBufferOmittedBytes,
        figma: { fileKey },
        guidance: [noFallbackNote, ...reasons].join(" "),
      };
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
      matchReason,
      clipboardBufferOmittedBytes,
      figma: { fileKey },
      guidance: [
        matchStatus === "ambiguous" || matchStatus === "none"
          ? AMBIGUOUS_GUIDANCE
          : "Imported the clipboard's visible-HTML preview instead of exact Figma nodes.",
        ...reasons,
      ].join(" "),
    };
  },
});
