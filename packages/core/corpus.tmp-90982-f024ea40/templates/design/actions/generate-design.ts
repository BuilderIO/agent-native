import { defineAction, embedApp } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import {
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
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import {
  designGenerationSessionKey,
  type DesignGenerationSession,
  updateGenerationSessionWithSavedFiles,
} from "../shared/generation-session.js";
import { assertLockedLayersPreserved } from "../shared/locked-layers.js";
import { widthToPrefix } from "../shared/responsive-classes.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

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

type GenerationViewport = "mobile" | "tablet" | "desktop";

const DEFAULT_GENERATION_VIEWPORT: GenerationViewport = "desktop";
const GENERATION_VIEWPORT_SIZES: Record<
  GenerationViewport,
  { width: number; height: number }
> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 1024 },
};
const GENERATED_FRAME_GAP = 96;
const DEFAULT_RESPONSIVE_BREAKPOINTS = [390, 768, 1440].map((widthPx) => ({
  id: `generated-${widthPx}`,
  label: widthPx === 390 ? "Mobile" : widthPx === 768 ? "Tablet" : "Desktop",
  widthPx,
  prefix: widthToPrefix(widthPx),
}));

function hasBreakpointSet(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const breakpoints = (value as { breakpoints?: unknown }).breakpoints;
  return Array.isArray(breakpoints) && breakpoints.length > 0;
}

function nextGeneratedFrameX(
  frames: ReturnType<typeof parseCanvasFrameGeometryById>,
): number {
  return Object.values(frames).reduce((furthestRight, frame) => {
    const x = frame.x ?? 0;
    const width = frame.width ?? 0;
    return Math.max(furthestRight, x + width + GENERATED_FRAME_GAP);
  }, 0);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Same-process mutex guarding the generation-session read-modify-write below.
// generate-screens' own tool description explicitly recommends fanning out
// parallel generate-design calls per returned frame ("fan out calls to
// generate-design for each returned frame"). Without this lock, two
// concurrent calls for the same designId both read the same pre-update
// session, each only marks its own frame done, and whichever writeAppState
// lands second silently discards the first call's frame-done update —
// application state has no CAS/versioning primitive (unlike designs.data's
// mutateDesignData), so a plain read-then-write here is a classic lost-update
// race. This mirrors the same-process serialization
// server/lib/design-data-mutation.ts uses (withDesignDataLock) for the
// designs.data column. Cross-process races remain (no CAS primitive exists
// for application state), but same-process fan-out from one agent turn is
// the realistic, explicitly-encouraged case this closes.
const generationSessionLocks = new Map<string, Promise<unknown>>();

function withGenerationSessionLock<T>(
  designId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = generationSessionLocks.get(designId) ?? Promise.resolve();
  const next = previous.then(callback, callback);
  generationSessionLocks.set(designId, next);
  const cleanup = () => {
    if (generationSessionLocks.get(designId) === next) {
      generationSessionLocks.delete(designId);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

async function updateGenerationSessionForSavedFiles(
  designId: string,
  savedFilenames: string[],
) {
  await withGenerationSessionLock(designId, async () => {
    const key = designGenerationSessionKey(designId);
    const rawSession = await readAppState(key).catch(() => null);
    if (!rawSession || typeof rawSession !== "object") return;
    const session = rawSession as unknown as DesignGenerationSession;
    if (session.designId !== designId || !Array.isArray(session.frames)) {
      return;
    }

    const nextSession = updateGenerationSessionWithSavedFiles(
      session,
      savedFilenames,
    );
    if (nextSession === session) return;

    await writeAppState(key, nextSession as unknown as Record<string, unknown>);
  });
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
        "Optional JSON array of overview-canvas placements keyed by filename or fileId. " +
        "Pass explicit x/y/width/height for every generated screen; desktop is 1440x1024.",
    },
    primaryViewport: {
      type: "string",
      enum: ["mobile", "tablet", "desktop"],
      description:
        "The requested primary form factor. Defaults to desktop (1440x1024). " +
        "Set this from the intake answer when no explicit canvasFrames placement is supplied.",
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
    "When `designSystemId` is provided, first use `get-design-system` and apply " +
    "its `agentContext` tokens/docs before writing the file content; do not " +
    "treat the id alone as enough design-system context. " +
    "Every web design must be responsive. Use a desktop 1440x1024 primary " +
    "canvas by default, or set `primaryViewport` for an explicitly mobile- or " +
    "tablet-primary design; this action adds responsive editor breakpoints. " +
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
          // Reject two placements for the same target in one call. Without
          // this, mergeCanvasFramePlacements folds both entries into a single
          // canvasFrames[fileId] value (last one wins), but the mutateDesignData
          // isApplied check below verifies EVERY placedFrames entry against
          // that single folded value — so the earlier, now-overwritten entry
          // always fails the equality check. Since the mutate callback is
          // deterministic, every retry recomputes the identical mismatch, so
          // the whole action always fails with a "concurrent write conflicts"
          // error after burning through all retries, even though nothing else
          // was actually writing to the design.
          .superRefine((frames, ctx) => {
            const seen = new Map<string, number>();
            frames.forEach((frame, index) => {
              const key = frame.fileId
                ? `id:${frame.fileId}`
                : `name:${frame.filename}`;
              const firstIndex = seen.get(key);
              if (firstIndex !== undefined) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [index],
                  message:
                    `canvasFrames entry ${index} duplicates the target already placed ` +
                    `at index ${firstIndex} (${frame.fileId ? `fileId ${frame.fileId}` : `filename ${frame.filename}`}). ` +
                    "Pass exactly one placement per screen.",
                });
                return;
              }
              seen.set(key, index);
            });
          })
          .optional(),
      )
      .optional()
      .describe(
        "Optional overview-canvas placements for generated screens. " +
          "Reference each screen by filename or fileId and include x/y/width/height " +
          "from generate-screens regions or your planned canvas layout.",
      ),
    primaryViewport: z
      .enum(["mobile", "tablet", "desktop"])
      .optional()
      .default(DEFAULT_GENERATION_VIEWPORT)
      .describe(
        "Primary generated viewport. Defaults to desktop (1440x1024); set " +
          "mobile or tablet only when that is the requested form factor.",
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
    primaryViewport,
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

    // Validate row existence and designs.data before writing files. The final
    // mutation still re-reads the latest revision after file work; this
    // preflight prevents malformed JSON from orphaning new files.
    await mutateDesignData({
      designId,
      mutate: (current) => current,
      isApplied: () => true,
    });

    const existingByName = new Map(existingFiles.map((f) => [f.filename, f]));

    // Stamp missing data-agent-native-node-id attributes before persisting so
    // every generated screen is born fully addressable by id-keyed editor
    // operations (move/select/style), instead of depending on a client-side
    // backfill the first time a human opens the screen.
    const annotatedFiles = files.map((file) => ({
      ...file,
      content: annotateScreenHtmlForPersist(file.content, file.fileType),
    }));

    for (const file of annotatedFiles) {
      const existing = existingByName.get(file.filename);
      if (existing) {
        // Publish agent presence so live editors see "AI is generating" in place.
        agentEnterDocument(existing.id);
        agentUpdateSelection(existing.id, {
          generatingFile: file.filename,
          designId,
        });

        try {
          // `file.content` here is LLM-generated content produced upstream of
          // this action call, so there can be a large async window (the full
          // generation time) between whenever this file's content was last
          // known and this write. Read the LIVE base (collab text when
          // present, else the SQL row) right before persisting and carry its
          // versionHash through to writeInlineSourceFile, which re-reads the
          // live text immediately before its own applyText/DB write and
          // rejects if it no longer matches — closing the race window where a
          // concurrent editor/agent write lands mid-generation. See
          // insert-design-native-asset.ts and insert-asset.ts for the
          // identical pattern.
          const workspaceFile: SourceWorkspaceFile = {
            id: existing.id,
            designId: existing.designId,
            filename: existing.filename ?? "",
            fileType: existing.fileType ?? "html",
            content: existing.content,
            createdAt: null,
            updatedAt: null,
          };
          const live = await readLiveSourceFile(workspaceFile);

          assertLockedLayersPreserved(live.content, file.content);

          await writeInlineSourceFile({
            designId: existing.designId,
            file: workspaceFile,
            content: file.content,
            expectedVersionHash: live.versionHash,
          });

          // writeInlineSourceFile only persists content/updatedAt; keep
          // fileType in sync separately when the caller changed it (e.g.
          // html -> jsx), matching the original update behavior.
          const nextFileType = file.fileType ?? "html";
          if (nextFileType !== (existing.fileType ?? "html")) {
            await db
              .update(schema.designFiles)
              .set({ fileType: nextFileType, updatedAt: now })
              .where(eq(schema.designFiles.id, existing.id));
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
          contentOperationSource: null,
          contentOperationRevision: null,
          contentOperationResultHash: null,
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
          contentOperationSource: null,
          contentOperationRevision: null,
          contentOperationResultHash: null,
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

    // Merge with existing data so tweak definitions survive content updates.
    // The data column is a free-form JSON blob; we own these keys here and
    // leave anything else intact.
    let placedFrames:
      | Array<{
          fileId: string;
          filename?: string;
          frame: CanvasFramePlacement;
        }>
      | undefined;
    const normalizedTweaks = tweaks?.map((tweak) => ({
      ...tweak,
      type: tweak.type === "color-swatches" ? "color-swatch" : tweak.type,
    }));
    await mutateDesignData({
      designId,
      mutate: (prevData, { updatedAt }) => {
        const mergedData: Record<string, unknown> = {
          ...prevData,
          lastPrompt: prompt,
          generatedAt: now,
          fileCount: files.length,
        };
        if (normalizedTweaks !== undefined) {
          mergedData.tweaks = normalizedTweaks;
        }
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
          placements: canvasFrames ?? [],
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
        const viewport = GENERATION_VIEWPORT_SIZES[primaryViewport];
        let nextX = nextGeneratedFrameX(merged.canvasFrames);
        const generationFrames = [...merged.placedFrames];
        for (const file of savedFiles) {
          const source = files.find(
            (candidate) => candidate.filename === file.filename,
          );
          if (!source || !isRenderableDesignFile(source)) continue;
          const current = merged.canvasFrames[file.id] ?? {};
          if (
            current.x !== undefined &&
            current.y !== undefined &&
            current.width !== undefined &&
            current.height !== undefined
          ) {
            continue;
          }
          const frame = {
            x: current.x ?? nextX,
            y: current.y ?? 0,
            width: current.width ?? viewport.width,
            height: current.height ?? viewport.height,
            z: current.z ?? generationFrames.length,
            ...(current.rotation === undefined
              ? {}
              : { rotation: current.rotation }),
          };
          merged.canvasFrames[file.id] = frame;
          generationFrames.push({
            fileId: file.id,
            filename: file.filename,
            frame,
          });
          nextX = frame.x + frame.width + GENERATED_FRAME_GAP;
        }
        mergedData.canvasFrames = merged.canvasFrames;
        placedFrames = generationFrames;
        if (!hasBreakpointSet(mergedData.breakpointSet)) {
          mergedData.breakpointSet = {
            id: "generated-responsive",
            breakpoints: DEFAULT_RESPONSIVE_BREAKPOINTS,
          };
          mergedData.breakpointSetUpdatedAt = updatedAt;
        }
        return mergedData;
      },
      isApplied: (current) => {
        if (
          current.lastPrompt !== prompt ||
          current.generatedAt !== now ||
          current.fileCount !== files.length ||
          (normalizedTweaks !== undefined &&
            !jsonValuesEqual(current.tweaks, normalizedTweaks))
        ) {
          return false;
        }
        const currentFrames = parseCanvasFrameGeometryById(
          current.canvasFrames,
        );
        const framesApplied = Boolean(
          placedFrames?.every(({ fileId, frame }) => {
            const currentFrame = currentFrames[fileId];
            return (
              currentFrame !== undefined &&
              Object.entries(frame).every(
                ([key, value]) =>
                  currentFrame[key as keyof typeof currentFrame] === value,
              )
            );
          }),
        );
        return framesApplied && hasBreakpointSet(current.breakpointSet);
      },
    });

    // designs.data/updatedAt are helper-owned. Keep the optional static column
    // behavior without writing another whole data snapshot or regressing the
    // helper's monotonic updatedAt revision.
    const designUpdates: Record<string, unknown> = {};
    if (designSystemId !== undefined) {
      designUpdates.designSystemId = designSystemId;
    }
    if (projectType !== undefined) {
      designUpdates.projectType = projectType;
    }
    if (Object.keys(designUpdates).length > 0) {
      await db
        .update(schema.designs)
        .set(designUpdates)
        .where(eq(schema.designs.id, designId));
    }

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
