import { defineAction } from "@agent-native/core/action";
import { seedFromText } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  mergeCanvasFramePlacements,
  nextFreeCanvasRowY,
  parseCanvasFrameGeometryById,
} from "../shared/canvas-frames.js";
import {
  assertDesignHtmlCreateIntegrity,
  describeDesignHtmlIntegrityIssue,
} from "../shared/html-integrity.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

// Matches the desktop default the in-app generation directives use
// (generation-prompt-directives.ts) so a screen created directly via this
// action looks the same as one the in-app agent generated.
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
    // Path traversal guard
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();

    // Guard against duplicate (designId, filename) — edit-design uses .limit(1)
    // which is non-deterministic when multiple rows match the same key.
    const [existing] = await db
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

    const id = nanoid();
    const now = new Date().toISOString();

    // Stamp missing data-agent-native-node-id attributes before persisting so
    // the new screen is fully addressable by id-keyed editor operations from
    // the moment it's created, instead of depending on a client-side backfill
    // the first time someone opens it.
    const annotatedContent = annotateScreenHtmlForPersist(content, fileType);

    // Reject malformed HTML before the row exists — creation went through raw
    // inserts, so it was the one write path with no integrity gate.
    const advisory = assertDesignHtmlCreateIntegrity({
      content: annotatedContent,
      fileType: fileType ?? "html",
      filename,
    });

    await db.insert(schema.designFiles).values({
      id,
      designId,
      filename,
      fileType: fileType ?? "html",
      content: annotatedContent,
      createdAt: now,
      updatedAt: now,
    });

    // Seed collab state for the new file
    await seedFromText(id, annotatedContent);

    // Update the design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, designId));

    const resolvedFileType = fileType ?? "html";
    const renderable =
      (resolvedFileType === "html" || resolvedFileType === "jsx") &&
      content.trim().length > 0;

    // A renderable screen with no canvas placement fell back to the overview
    // board's blank-frame default (a small 320x640 card meant for a screen
    // the user will sketch and resize by hand), which reads as broken for a
    // complete screen an agent just authored. Give it a real desktop
    // placement immediately, the same way generate-design and
    // present-design-variants place screens they create.
    if (renderable) {
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
                y: nextFreeCanvasRowY(current.canvasFrames, CREATED_SCREEN_GAP),
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
        ? `/design/${encodeURIComponent(designId)}?view=overview&screen=${encodeURIComponent(id)}`
        : null,
      ...(advisory.length > 0
        ? { warnings: advisory.map(describeDesignHtmlIntegrityIssue) }
        : {}),
    };
  },
});
