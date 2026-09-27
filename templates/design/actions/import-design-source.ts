import type { ActionRunContext } from "@agent-native/core/action";
import { defineAction } from "@agent-native/core/action";
import { listAppState } from "@agent-native/core/application-state";
import uploadImage, {
  commitUploadReceiptsForImport,
  UPLOAD_RECEIPT_PREFIX,
} from "@agent-native/core/file-upload/actions/upload-image";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  checkpointSkippedResultField,
  snapshotDesignBeforeAgentEdit,
} from "../server/lib/design-versions.js";
import { saveFigmaPasteHtmlFallback } from "../server/lib/figma-paste-fallback.js";
import {
  findImportedDesignFilesByOperationSourcePrefix,
  normalizeImportedHtmlDocument,
  resolveImportDesignId,
  saveImportedDesignFiles,
  type SavedImportedDesignFile,
} from "../server/lib/import-design-files.js";
import { MAX_UPLOAD_BYTES } from "../server/lib/request-body-limits.js";
import { MAX_FIG_FRAME_HTML_BYTES } from "../shared/fig-to-frames.js";
import { deleteDesignFilesByOperationSourcePrefix } from "./delete-file.js";

const MAX_HTML_IMPORT_BYTES = MAX_FIG_FRAME_HTML_BYTES;
const MAX_FIG_FRAMES_PER_REQUEST = 32;

const htmlContent = z
  .string()
  .max(MAX_HTML_IMPORT_BYTES, "HTML import content is too large (max 2 MB).");

interface FigFrameInput {
  content: string;
  originalName?: string;
  frameTitle?: string;
  frameWidth?: number;
  frameHeight?: number;
  frameX?: number;
  frameY?: number;
  clientImportId?: string;
}

function ensureHtmlSize(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_HTML_IMPORT_BYTES) {
    throw new Error("HTML import content is too large (max 2 MB).");
  }
}

function requireContent(content: string | undefined): string {
  if (content === undefined) {
    throw new Error("`content` is required for this import.");
  }
  ensureHtmlSize(content);
  return content;
}

function baseFilename(originalName: string | undefined, fallback: string) {
  return (originalName?.trim() || fallback).replace(/\.[^.]+$/, "") + ".html";
}

async function deleteImportImages(batchId: string) {
  const receipts = await listAppState(`${UPLOAD_RECEIPT_PREFIX}${batchId}:`);
  for (const { key } of receipts) {
    await uploadImage.run({
      idempotencyKey: key.slice(UPLOAD_RECEIPT_PREFIX.length),
      cleanup: "delete",
    });
  }
}

async function importFigFrames(args: {
  designId: string;
  designData: string | null;
  frames: FigFrameInput[];
  batchId?: string;
  finalBatch: boolean;
  context: ActionRunContext | undefined;
}) {
  const { designId, frames, batchId } = args;
  for (const frame of frames) ensureHtmlSize(frame.content);
  const batchPrefix = batchId ? `fig-import:${batchId}:` : undefined;
  const operationSources = frames.map((frame) =>
    frame.clientImportId ? `fig-import:${frame.clientImportId}` : undefined,
  );
  for (const operationSource of operationSources) {
    if (batchPrefix && !operationSource?.startsWith(batchPrefix)) {
      throw new Error(
        `Every clientImportId must start with "${batchId}:" (the clientImportBatchId).`,
      );
    }
  }
  if (
    new Set(operationSources.filter(Boolean)).size !==
    operationSources.filter(Boolean).length
  ) {
    throw new Error("Each frame in an import needs its own clientImportId.");
  }

  const lookupPrefix = batchPrefix ?? operationSources[0];
  const landed = lookupPrefix
    ? (
        await findImportedDesignFilesByOperationSourcePrefix(
          designId,
          lookupPrefix,
          args.designData,
        )
      ).filter((entry) => batchPrefix || entry.operationSource === lookupPrefix)
    : [];
  const placed = new Map(
    landed
      .filter((entry) => entry.placed)
      .map((entry) => [entry.operationSource, entry.file]),
  );
  const pending = frames.flatMap((frame, index) => {
    const operationSource = operationSources[index];
    return operationSource && placed.has(operationSource)
      ? []
      : [{ frame, operationSource }];
  });

  let saved: Awaited<ReturnType<typeof saveImportedDesignFiles>> | undefined;
  let checkpoint: Awaited<ReturnType<typeof snapshotDesignBeforeAgentEdit>> =
    null;
  if (pending.length > 0) {
    if (landed.length === 0) {
      checkpoint = await snapshotDesignBeforeAgentEdit(designId, args.context, {
        allowCheckpointFailureSkip: true,
      });
    }
    saved = await saveImportedDesignFiles({
      designId,
      sourceType: "fig-upload",
      placementGroup: batchPrefix,
      files: pending.map(({ frame, operationSource }) => ({
        filename: baseFilename(frame.originalName, "figma-frame"),
        fileType: "html",
        content: normalizeImportedHtmlDocument(
          frame.content,
          `experimental .fig upload ${frame.originalName ?? "design"}`,
        ),
        source: {
          sourceType: "fig-frame",
          originalName: frame.originalName,
          ...(operationSource ? { operationSource } : {}),
        },
        operationSource,
        preferredFrame: {
          title: frame.frameTitle,
          width: frame.frameWidth,
          height: frame.frameHeight,
          x: frame.frameX,
          y: frame.frameY,
        },
      })),
    });
  }
  if (batchId && args.finalBatch) {
    await commitUploadReceiptsForImport(batchId);
  }

  const savedFiles = saved?.files ?? [];
  let savedIndex = 0;
  const files: SavedImportedDesignFile[] = frames.map((_, index) => {
    const operationSource = operationSources[index];
    const existing = operationSource ? placed.get(operationSource) : undefined;
    return existing ?? savedFiles[savedIndex++]!;
  });
  return {
    designId,
    files,
    warnings: saved?.warnings ?? [],
    placedFrames: saved?.placedFrames ?? [],
    overview: true,
    urlPath: `/design/${designId}`,
    stats: { sourceKind: "fig-frame", frameCount: files.length },
    ...checkpointSkippedResultField(checkpoint),
  };
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
    content: htmlContent
      .optional()
      .describe("HTML to import. Required unless `frames` or `abort` is set."),
    originalName: z.string().optional(),
    frameTitle: z.string().optional(),
    frameWidth: z.number().optional(),
    frameHeight: z.number().optional(),
    clientImportId: z.string().max(200).optional(),
    clientImportBatchId: z
      .string()
      .max(200)
      .regex(/^[^:]+$/, "clientImportBatchId cannot contain a colon.")
      .optional(),
    clientImportFinalFrame: z.boolean().optional(),
    frames: z
      .array(
        z.object({
          content: htmlContent,
          originalName: z.string().optional(),
          frameTitle: z.string().optional(),
          frameWidth: z.number().optional(),
          frameHeight: z.number().optional(),
          frameX: z.number().optional(),
          frameY: z.number().optional(),
          clientImportId: z.string().max(200),
        }),
      )
      .min(1)
      .max(MAX_FIG_FRAMES_PER_REQUEST)
      .optional(),
    clientImportFinalBatch: z.boolean().optional(),
    abort: z.boolean().optional(),
  }),
  maxBodyBytes: MAX_UPLOAD_BYTES,
  run: async (input, context) => {
    const { designId, sourceType, content, originalName } = input;
    const resolvedDesignId = await resolveImportDesignId(designId);
    const access = await assertAccess("design", resolvedDesignId, "editor");

    if (input.abort || input.frames) {
      if (sourceType !== "fig-frame" || !input.clientImportBatchId) {
        throw new Error(
          "`frames` and `abort` need sourceType fig-frame and a clientImportBatchId.",
        );
      }
    }
    if (input.abort) {
      const deletedFileIds = await deleteDesignFilesByOperationSourcePrefix(
        resolvedDesignId,
        `fig-import:${input.clientImportBatchId}:`,
      );
      await deleteImportImages(input.clientImportBatchId!);
      return { deletedFileIds };
    }

    if (sourceType === "fig-frame") {
      const frames: FigFrameInput[] = input.frames ?? [
        {
          content: requireContent(content),
          originalName,
          frameTitle: input.frameTitle,
          frameWidth: input.frameWidth,
          frameHeight: input.frameHeight,
          clientImportId: input.clientImportId,
        },
      ];
      return importFigFrames({
        designId: resolvedDesignId,
        designData: access.resource.data ?? null,
        frames,
        batchId: input.clientImportBatchId,
        finalBatch: input.frames
          ? input.clientImportFinalBatch === true
          : input.clientImportFinalFrame === true,
        context,
      });
    }

    const html = requireContent(content);
    if (sourceType === "html-string") {
      const htmlCheckpoint = await snapshotDesignBeforeAgentEdit(
        resolvedDesignId,
        context,
        { allowCheckpointFailureSkip: true },
      );
      const saved = await saveImportedDesignFiles({
        designId: resolvedDesignId,
        sourceType: "html-import",
        files: [
          {
            filename: baseFilename(originalName, "imported-html"),
            fileType: "html",
            content: normalizeImportedHtmlDocument(html, "HTML source"),
            source: { sourceType: "html-string", originalName },
          },
        ],
      });
      return {
        ...saved,
        stats: { sourceKind: "html-string", frameCount: saved.files.length },
        ...checkpointSkippedResultField(htmlCheckpoint),
      };
    }

    const figmaPasteCheckpoint = await snapshotDesignBeforeAgentEdit(
      resolvedDesignId,
      context,
      { allowCheckpointFailureSkip: true },
    );
    const figmaPasteResult = await saveFigmaPasteHtmlFallback({
      designId: resolvedDesignId,
      clipboardHtml: html,
      originalName,
    });
    return {
      ...figmaPasteResult,
      ...checkpointSkippedResultField(figmaPasteCheckpoint),
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
