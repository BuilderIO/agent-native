import { defineAction } from "@agent-native/core/action";
import { seedFromText } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  checkpointSkippedResultField,
  snapshotDesignBeforeAgentEdit,
} from "../server/lib/design-versions.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  mergeCanvasFramePlacements,
  nextFreeCanvasRowY,
  parseCanvasFrameGeometryById,
} from "../shared/canvas-frames.js";
import { getOverviewScreenFileIds } from "../shared/design-files.js";
import {
  assertDesignHtmlCreateIntegrity,
  describeDesignHtmlIntegrityIssue,
} from "../shared/html-integrity.js";
import { getResponsiveBreakpointWidths } from "../shared/responsive-frame-layout.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

const CREATED_SCREEN_WIDTH = 1440;
const CREATED_SCREEN_HEIGHT = 1024;
const CREATED_SCREEN_GAP = 96;

export default defineAction({
  description:
    "Add a new file to a design project. Validates that the design exists and " +
    "the user has editor access. Returns the new file's ID, filename, and design URL path when the file is renderable.",
  schema: z.object({
    designId: z.string().describe("Design project ID to add the file to"),
    filename: z.string().describe("Filename (e.g. 'index.html', 'styles.css')"),
    content: z.string().describe("File content"),
    fileType: z
      .enum(["html", "css", "jsx", "asset"])
      .optional()
      .default("html")
      .describe("Type of file"),
  }),
  run: async ({ designId, filename, content, fileType }, context) => {
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    await assertAccess("design", designId, "editor");
    const checkpoint = await snapshotDesignBeforeAgentEdit(designId, context, {
      allowCheckpointFailureSkip: true,
    });
    const checkpointField = checkpointSkippedResultField(checkpoint);

    const id = nanoid();
    const now = new Date().toISOString();

    const annotatedContent = annotateScreenHtmlForPersist(content, fileType);

    const advisory = assertDesignHtmlCreateIntegrity({
      content: annotatedContent,
      fileType: fileType ?? "html",
      filename,
    });

    await withDesignSourceMutationTransaction(designId, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.designFiles.id })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.designId, designId),
            eq(schema.designFiles.filename, filename),
          ),
        )
        .limit(1);
      if (existing) {
        throw new Error(
          `File "${filename}" already exists in design ${designId} — use edit-design to modify it`,
        );
      }

      await tx.insert(schema.designFiles).values({
        id,
        designId,
        filename,
        fileType: fileType ?? "html",
        content: annotatedContent,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(schema.designs)
        .set({ updatedAt: now })
        .where(eq(schema.designs.id, designId));
    });

    await seedFromText(id, annotatedContent);

    const db = getDb();

    const resolvedFileType = fileType ?? "html";
    const renderable =
      (resolvedFileType === "html" || resolvedFileType === "jsx") &&
      content.trim().length > 0;

    if (renderable) {
      const screenFiles = await db
        .select({
          id: schema.designFiles.id,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));
      const screenFileIds = getOverviewScreenFileIds(screenFiles);

      await mutateDesignData({
        designId,
        mutate: (current) => {
          const existingFrames = parseCanvasFrameGeometryById(
            current.canvasFrames,
          );
          if (existingFrames[id]) return current;
          const merged = mergeCanvasFramePlacements({
            existing: current.canvasFrames,
            placements: [
              {
                fileId: id,
                filename,
                x: 0,
                y: nextFreeCanvasRowY(
                  current.canvasFrames,
                  CREATED_SCREEN_GAP,
                  {
                    responsiveLayout: {
                      screenFileIds,
                      screenMetadataByFileId: current.screenMetadata,
                      breakpointWidths: getResponsiveBreakpointWidths(
                        current.breakpointSet,
                      ),
                    },
                  },
                ),
                width: CREATED_SCREEN_WIDTH,
                height: CREATED_SCREEN_HEIGHT,
              },
            ],
            resolveFileId: (placement) => placement.fileId,
          });
          return { ...current, canvasFrames: merged.canvasFrames };
        },
        isApplied: (current) =>
          Boolean(parseCanvasFrameGeometryById(current.canvasFrames)[id]),
      });
    }

    return {
      id,
      designId,
      filename,
      fileType: resolvedFileType,
      renderable,
      urlPath: renderable
        ? `/design/${encodeURIComponent(designId)}?editorView=overview&screen=${encodeURIComponent(id)}`
        : null,
      ...(advisory.length > 0
        ? { warnings: advisory.map(describeDesignHtmlIntegrityIssue) }
        : {}),
      ...checkpointField,
    };
  },
});
