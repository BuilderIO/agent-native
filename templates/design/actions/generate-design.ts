import { defineAction, embedApp } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import {
  hasCollabState,
  applyText,
  seedFromText,
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  mergeCanvasFramePlacements,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import {
  designGenerationSessionKey,
  type DesignGenerationSession,
  updateGenerationSessionWithSavedFiles,
} from "../shared/generation-session.js";

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

function isRenderableDesignFile(file: {
  fileType?: string | null;
  content?: string | null;
}): boolean {
  const fileType = file.fileType ?? "html";
  return (
    (fileType === "html" || fileType === "jsx") && Boolean(file.content?.trim())
  );
}

async function updateGenerationSessionForSavedFiles(
  designId: string,
  savedFilenames: string[],
) {
  const key = designGenerationSessionKey(designId);
  const rawSession = await readAppState(key).catch(() => null);
  if (!rawSession || typeof rawSession !== "object") return;
  const session = rawSession as unknown as DesignGenerationSession;
  if (session.designId !== designId || !Array.isArray(session.frames)) return;

  const nextSession = updateGenerationSessionWithSavedFiles(
    session,
    savedFilenames,
  );
  if (nextSession === session) return;

  await writeAppState(key, nextSession as unknown as Record<string, unknown>);
}

const generateDesignAgentParameters = {
  type: "object",
  properties: {
    designId: {
      type: "string",
      description: "Existing design project ID to save generated content to.",
    },
    prompt: {
      type: "string",
      description: "The user's generation prompt.",
    },
    files: {
      type: "string",
      description:
        "JSON array of files to save. Pass one compact, complete, renderable index.html first, e.g. " +
        '[{"filename":"index.html","fileType":"html","content":"<!doctype html>..."}]. ' +
        "Do not use generate-design to replace a selected variant screen after a variant pick; snapshot that fileId and use edit-design instead.",
    },
    designSystemId: {
      type: ["string", "null"],
      description:
        "Optional design system ID used for generation. Pass null to unlink.",
    },
    projectType: {
      type: "string",
      enum: ["prototype", "other"],
      description: "Optional project type hint.",
    },
    tweaks: {
      type: "string",
      description:
        "Optional JSON array of tweak definitions. Omit unless the HTML uses matching CSS variables.",
    },
    canvasFrames: {
      type: "string",
      description:
        "Optional JSON array of overview-canvas placements keyed by filename or fileId.",
    },
  },
  required: ["designId", "prompt", "files"],
} as const;

const generateDesignAction = defineAction({
  description:
    "Save generated design content to a design project. " +
    "The agent calls this after generating HTML/CSS/JSX content to persist it " +
    "as files in the design project. Creates or updates files as needed. " +
    "Returns the saved files and design URL path for iframe rendering. " +
    "Keep the first save compact and working; for large designs, persist a minimal " +
    "version then refine individual files with `edit-design` (search/replace) rather " +
    "than resending a big multi-file payload — a single oversized payload can get cut " +
    "off mid-stream and stall the turn. " +
    "Do not use this action to replace a selected variant screen after a " +
    "variant pick; call `get-design-snapshot` for the selected `fileId` and " +
    "`edit-design` that same `fileId` instead. " +
    "Do not report a design as ready until this action succeeds. " +
    "When adding multiple screens or states, pass canvasFrames with filenames " +
    "and x/y/width/height so the new screens appear placed on the overview canvas.",
  schema: z.object({
    designId: z.string().describe("Design project ID to save content to"),
    prompt: z.string().describe("The generation prompt (stored for reference)"),
    files: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z
          .array(
            z.object({
              filename: z.string().describe("Filename (e.g. 'index.html')"),
              content: z.string().min(1).describe("File content"),
              fileType: z
                .enum(["html", "css", "jsx", "asset"])
                .optional()
                .default("html")
                .describe("Type of file"),
            }),
          )
          .min(1),
      )
      .describe("Array of files to create/update in the design project"),
    designSystemId: z
      .string()
      .nullable()
      .optional()
      .describe("Design system ID used for generation, or null to unlink"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .describe("Project type hint for generation"),
    tweaks: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              type: z.enum([
                "color-swatch",
                "color-swatches",
                "segment",
                "slider",
                "toggle",
              ]),
              options: z
                .array(
                  z.object({
                    label: z.string(),
                    value: z.string(),
                    color: z.string().optional(),
                  }),
                )
                .optional(),
              min: z.number().optional(),
              max: z.number().optional(),
              step: z.number().optional(),
              defaultValue: z.union([z.string(), z.number(), z.boolean()]),
              cssVar: z.string().optional(),
            }),
          )
          .optional(),
      )
      .optional()
      .describe(
        "Optional array of tweak definitions (color swatches, segments, " +
          "sliders, toggles) bound to CSS custom properties in the design. " +
          "Surface 3-6 of the most impactful knobs (accent color, density, " +
          "radius, dark mode, font choice). Each must reference a CSS var " +
          "the design's `:root` block actually uses.",
      ),
    canvasFrames: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z
          .array(
            z
              .object({
                fileId: z.string().optional(),
                filename: z.string().optional(),
                x: z.number().optional(),
                y: z.number().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                rotation: z.number().optional(),
                z: z.number().optional(),
              })
              .refine((frame) => frame.fileId || frame.filename, {
                message: "canvasFrames entries require fileId or filename",
              }),
          )
          .optional(),
      )
      .optional()
      .describe(
        "Optional overview-canvas placements for generated screens. " +
          "Reference each screen by filename or fileId and include x/y/width/height " +
          "from generate-screens regions or your planned canvas layout.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design preview",
      description: "Open the generated design in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({
    designId,
    prompt,
    files,
    designSystemId,
    projectType,
    tweaks,
    canvasFrames,
  }) => {
    await assertAccess("design", designId, "editor");
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Path traversal guard on all filenames
    for (const file of files) {
      if (
        file.filename.includes("..") ||
        file.filename.includes("/") ||
        file.filename.includes("\\")
      ) {
        throw new Error(
          `Invalid filename "${file.filename}": path traversal not allowed`,
        );
      }
    }

    const savedFiles: Array<{
      id: string;
      filename: string;
      fileType: string;
    }> = [];

    // Get existing files for this design
    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    const hasRenderableFile =
      files.some(isRenderableDesignFile) ||
      existingFiles.some(isRenderableDesignFile);
    if (!hasRenderableFile) {
      throw new Error(
        "generate-design requires at least one non-empty HTML or JSX file before the design can be reported as ready",
      );
    }

    const existingByName = new Map(existingFiles.map((f) => [f.filename, f]));

    for (const file of files) {
      const existing = existingByName.get(file.filename);
      if (existing) {
        // Publish agent presence so live editors see "AI is generating" in place.
        agentEnterDocument(existing.id);
        agentUpdateSelection(existing.id, {
          generatingFile: file.filename,
          designId,
        });

        try {
          // Update existing file
          await db
            .update(schema.designFiles)
            .set({
              content: file.content,
              fileType: file.fileType ?? "html",
              updatedAt: now,
            })
            .where(eq(schema.designFiles.id, existing.id));

          // Push content through collab layer for live editors
          const collabExists = await hasCollabState(existing.id);
          if (collabExists) {
            await applyText(existing.id, file.content, "content", "agent");
          } else {
            await seedFromText(existing.id, file.content);
          }
        } finally {
          agentLeaveDocument(existing.id);
        }

        savedFiles.push({
          id: existing.id,
          filename: file.filename,
          fileType: file.fileType ?? "html",
        });
      } else {
        // Create new file
        const fileId = nanoid();
        await db.insert(schema.designFiles).values({
          id: fileId,
          designId,
          filename: file.filename,
          fileType: file.fileType ?? "html",
          content: file.content,
          createdAt: now,
          updatedAt: now,
        });

        // Publish agent presence for the new file before seeding.
        agentEnterDocument(fileId);
        agentUpdateSelection(fileId, {
          generatingFile: file.filename,
          designId,
        });
        try {
          await seedFromText(fileId, file.content);
        } finally {
          agentLeaveDocument(fileId);
        }

        // Update the in-memory map so a second entry with the same filename
        // in the same `files` array hits the UPDATE branch instead of
        // inserting a duplicate row.
        existingByName.set(file.filename, {
          id: fileId,
          designId,
          filename: file.filename,
          fileType: file.fileType ?? "html",
          content: file.content,
          createdAt: now,
          updatedAt: now,
        });

        savedFiles.push({
          id: fileId,
          filename: file.filename,
          fileType: file.fileType ?? "html",
        });
      }
    }

    // Update design metadata
    const designUpdates: Record<string, unknown> = { updatedAt: now };
    if (designSystemId !== undefined) {
      designUpdates.designSystemId = designSystemId;
    }
    if (projectType !== undefined) {
      designUpdates.projectType = projectType;
    }

    // Merge with existing data so tweak definitions survive content updates.
    // The data column is a free-form JSON blob; we own these keys here and
    // leave anything else intact.
    //
    // Wrapped in a transaction so that concurrent generate-design calls for the
    // same design (e.g. the parallel fan-out from generate-screens) each read
    // the latest canvasFrames and merge their own placement on top, rather than
    // all reading the same stale snapshot and the last writer silently
    // discarding the others' frame coordinates.
    let placedFrames:
      | Array<{
          fileId: string;
          filename?: string;
          frame: CanvasFramePlacement;
        }>
      | undefined;
    await db.transaction(async (tx) => {
      const [existingDesign] = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId));
      let prevData: Record<string, unknown> = {};
      if (existingDesign?.data) {
        try {
          const parsed = JSON.parse(existingDesign.data);
          if (parsed && typeof parsed === "object") prevData = parsed;
        } catch {
          // Stale or invalid JSON — start fresh.
        }
      }
      const mergedData: Record<string, unknown> = {
        ...prevData,
        lastPrompt: prompt,
        generatedAt: now,
        fileCount: files.length,
      };
      if (tweaks !== undefined) {
        mergedData.tweaks = tweaks.map((tweak) => ({
          ...tweak,
          type: tweak.type === "color-swatches" ? "color-swatch" : tweak.type,
        }));
      }
      if (canvasFrames !== undefined) {
        const savedByFileId = new Map(
          savedFiles.map((file) => [file.id, file]),
        );
        const savedByFilename = new Map(
          savedFiles.map((file) => [file.filename, file]),
        );
        const existingByFileId = new Map(
          existingFiles.map((file) => [file.id, file]),
        );
        const merged = mergeCanvasFramePlacements({
          existing: prevData.canvasFrames,
          placements: canvasFrames,
          resolveFileId: (placement) => {
            if (placement.fileId) {
              return savedByFileId.has(placement.fileId) ||
                existingByFileId.has(placement.fileId)
                ? placement.fileId
                : undefined;
            }
            return placement.filename
              ? (savedByFilename.get(placement.filename)?.id ??
                  existingByName.get(placement.filename)?.id)
              : undefined;
          },
        });
        mergedData.canvasFrames = merged.canvasFrames;
        placedFrames = merged.placedFrames;
      }
      designUpdates.data = JSON.stringify(mergedData);

      await tx
        .update(schema.designs)
        .set(designUpdates)
        .where(eq(schema.designs.id, designId));
    });

    await updateGenerationSessionForSavedFiles(
      designId,
      savedFiles.map((file) => file.filename),
    );

    return {
      designId,
      urlPath: `/design/${designId}`,
      renderable: true,
      savedFiles,
      placedFrames,
      fileCount: savedFiles.length,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});

// Keep rich Zod validation for every runtime caller, but present a lean
// string-JSON schema to native LLM tools. Anthropic models are prone to empty
// object calls against this action's deeply nested array/object schema.
export default {
  ...generateDesignAction,
  tool: {
    ...generateDesignAction.tool,
    parameters: generateDesignAgentParameters,
  },
};
