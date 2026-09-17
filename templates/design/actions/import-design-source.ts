import { defineAction } from "@agent-native/core/action";
import { commitUploadReceiptsForImport } from "@agent-native/core/file-upload/actions/upload-image";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import { saveFigmaPasteHtmlFallback } from "../server/lib/figma-paste-fallback.js";
import {
  normalizeImportedHtmlDocument,
  findImportedDesignFileByOperationSource,
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "../server/lib/import-design-files.js";
import { MAX_FIG_FRAME_HTML_BYTES } from "../shared/fig-to-frames.js";

const MAX_HTML_IMPORT_BYTES = MAX_FIG_FRAME_HTML_BYTES;

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
    sourceType: z.enum(["figma-paste-html", "html-string", "fig-frame"]),
    content: z
      .string()
      .max(
        MAX_HTML_IMPORT_BYTES,
        "HTML import content is too large (max 2 MB).",
      ),
    originalName: z.string().optional(),
    /** `fig-frame` only: the frame box the browser decoder resolved. */
    frameTitle: z.string().optional(),
    frameWidth: z.number().optional(),
    frameHeight: z.number().optional(),
    clientImportId: z.string().max(200).optional(),
    clientImportBatchId: z.string().max(200).optional(),
    clientImportFinalFrame: z.boolean().optional(),
  }),
  run: async (
    {
      designId,
      sourceType,
      content,
      originalName,
      frameTitle,
      frameWidth,
      frameHeight,
      clientImportId,
      clientImportBatchId,
      clientImportFinalFrame,
    },
    context,
  ) => {
    ensureHtmlSize(content);
    const resolvedDesignId = await resolveImportDesignId(designId);
    await assertAccess("design", resolvedDesignId, "editor");

    // One frame per request, which is the point: a `.fig` decoded in the
    // browser never uploads the file, and sending its frames one at a time
    // keeps every request far below the ~6MB a Netlify function will accept —
    // the cap the server route has to chunk around.
    if (sourceType === "fig-frame") {
      const operationSource = clientImportId
        ? `fig-import:${clientImportId}`
        : undefined;
      if (operationSource) {
        const existing = await findImportedDesignFileByOperationSource(
          resolvedDesignId,
          operationSource,
        );
        if (existing?.placed) {
          if (clientImportBatchId && clientImportFinalFrame) {
            await commitUploadReceiptsForImport(clientImportBatchId);
          }
          return {
            designId: resolvedDesignId,
            files: [existing.file],
            warnings: [],
            placedFrames: [],
            overview: true,
            urlPath: `/design/${resolvedDesignId}`,
            stats: { sourceKind: "fig-frame", frameCount: 1 },
          };
        }
      }
      await snapshotDesignBeforeAgentEdit(resolvedDesignId, context);
      const saved = await saveImportedDesignFiles({
        designId: resolvedDesignId,
        sourceType: "fig-upload",
        files: [
          {
            filename: baseFilename(originalName, "figma-frame"),
            fileType: "html",
            content: normalizeImportedHtmlDocument(
              content,
              `experimental .fig upload ${originalName ?? "design"}`,
            ),
            source: {
              sourceType: "fig-frame",
              originalName,
              ...(operationSource ? { operationSource } : {}),
            },
            operationSource,
            preferredFrame: {
              title: frameTitle,
              width: frameWidth,
              height: frameHeight,
            },
          },
        ],
      });
      if (clientImportBatchId && clientImportFinalFrame) {
        await commitUploadReceiptsForImport(clientImportBatchId);
      }
      return {
        ...saved,
        stats: { sourceKind: "fig-frame", frameCount: saved.files.length },
      };
    }

    if (sourceType === "html-string") {
      await snapshotDesignBeforeAgentEdit(resolvedDesignId, context);
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

    await snapshotDesignBeforeAgentEdit(resolvedDesignId, context);
    return saveFigmaPasteHtmlFallback({
      designId: resolvedDesignId,
      clipboardHtml: content,
      originalName,
    });
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
