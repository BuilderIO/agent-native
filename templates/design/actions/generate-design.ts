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
import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  resolveGenerationCreativeContext,
  validateCreativeContextReuseLabels,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type {
  CreativeContextElementProvenance,
  CreativeContextReuseLabel,
} from "@agent-native/creative-context/types";
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
import {
  assertDesignHtmlCreateIntegrity,
  describeDesignHtmlIntegrityIssue,
  inspectDesignHtmlDocumentIntegrity,
} from "../shared/html-integrity.js";
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
  desktop: { width: 1440, height: 900 },
};
const GENERATION_VIEWPORT_LABELS: Record<GenerationViewport, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};
// Widest → narrowest. The widest requested device seeds the primary/base
// frame; only the narrower devices become breakpoint frames.
const DEVICE_WIDTH_ORDER: readonly GenerationViewport[] = [
  "desktop",
  "tablet",
  "mobile",
];
const GENERATED_FRAME_GAP = 96;

function widestGenerationDevice(
  devices: readonly GenerationViewport[],
): GenerationViewport {
  return (
    DEVICE_WIDTH_ORDER.find((device) => devices.includes(device)) ??
    DEFAULT_GENERATION_VIEWPORT
  );
}

// Devices used when the caller omits `devices`: the requested primary form
// factor as the base plus Mobile, unless the primary already is Mobile. The
// default (desktop primary) therefore yields a Desktop base + Mobile
// breakpoint, matching the two-screen default.
function devicesForPrimaryViewport(
  primaryViewport: GenerationViewport,
): GenerationViewport[] {
  return primaryViewport === "mobile"
    ? ["mobile"]
    : [primaryViewport, "mobile"];
}

// Breakpoint frames = every requested device NARROWER than the primary
// (widest) one, ascending by width. The primary/widest width is never emitted,
// so a single-device request produces an empty set (one frame, no sub-frames)
// and no redundant frame ever lands at the base canvas width.
function breakpointSetForDevices(devices: readonly GenerationViewport[]) {
  const primaryWidth =
    GENERATION_VIEWPORT_SIZES[widestGenerationDevice(devices)].width;
  return Array.from(new Set(devices))
    .filter((device) => GENERATION_VIEWPORT_SIZES[device].width < primaryWidth)
    .sort(
      (a, b) =>
        GENERATION_VIEWPORT_SIZES[a].width - GENERATION_VIEWPORT_SIZES[b].width,
    )
    .map((device) => {
      const widthPx = GENERATION_VIEWPORT_SIZES[device].width;
      return {
        id: `generated-${widthPx}`,
        label: GENERATION_VIEWPORT_LABELS[device],
        widthPx,
        prefix: widthToPrefix(widthPx),
      };
    });
}

const reuseLabelSchema = z
  .object({
    itemId: z.string().min(1).optional(),
    itemVersionId: z.string().min(1).optional(),
    kind: z.string().min(1),
    label: z.string().min(1),
    dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
    elementId: z.string().min(1).optional(),
    influence: z
      .enum(["reused", "adapted", "reference-conditioned", "generated"])
      .optional(),
  })
  .superRefine((label, context) => {
    const influence = label.influence ?? "reference-conditioned";
    if (Boolean(label.itemId) !== Boolean(label.itemVersionId)) {
      context.addIssue({
        code: "custom",
        message: "itemId and itemVersionId must be provided together",
      });
    }
    if (influence !== "generated" && !label.itemId) {
      context.addIssue({
        code: "custom",
        message: "Only generated labels may omit context item ids",
      });
    }
  });

function classifyBreakpointSet(
  value: unknown,
): "absent" | "malformed" | "present" {
  if (value === null || value === undefined) return "absent";
  if (typeof value !== "object" || Array.isArray(value)) return "malformed";
  const breakpoints = (value as { breakpoints?: unknown }).breakpoints;
  if (breakpoints === undefined) return "malformed";
  if (!Array.isArray(breakpoints)) return "malformed";
  return breakpoints.length > 0 ? "present" : "malformed";
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

interface DesignCreativeContextProvenance {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
}

async function resolveDesignCreativeContext(input: {
  prompt: string;
  generationSession: DesignGenerationSession | null;
  contextPackId?: string;
  contextModeOverride?: "off";
  reuseLabels: CreativeContextReuseLabel[];
}): Promise<DesignCreativeContextProvenance> {
  if (input.contextModeOverride === "off") {
    const validated = await validateGenerationCreativeContext({
      contextPackId: input.contextPackId,
      contextModeOverride: "off",
      reuseLabels: input.reuseLabels,
    });
    return {
      contextMode: validated.contextMode,
      contextPackId: validated.contextPackId,
      reuseLabels: validated.reuseLabels,
    };
  }

  const sessionContext = input.generationSession?.creativeContext;
  if (sessionContext) {
    if (
      input.contextPackId !== undefined &&
      input.contextPackId !== sessionContext.contextPackId
    ) {
      throw new Error(
        "generate-design must preserve the generation session's creative-context pack",
      );
    }
    const requestedLabels = input.reuseLabels.length
      ? input.reuseLabels
      : sessionContext.reuseLabels;
    if (!sessionContext.contextPackId) {
      return {
        contextMode: sessionContext.contextMode,
        contextPackId: null,
        reuseLabels: validateCreativeContextReuseLabels(requestedLabels, {
          generatedOnly: true,
        }),
      };
    }
    const validated = await validateGenerationCreativeContext({
      contextPackId: sessionContext.contextPackId,
      contextPackSource: "inherited",
      reuseLabels: requestedLabels,
      reuseLabelsSource: input.reuseLabels.length ? "explicit" : "inherited",
    });
    return {
      contextMode: sessionContext.contextMode,
      contextPackId: validated.contextPackId,
      reuseLabels: validated.reuseLabels,
    };
  }

  if (input.contextPackId) {
    const validated = await validateGenerationCreativeContext({
      contextPackId: input.contextPackId,
      reuseLabels: input.reuseLabels.length ? input.reuseLabels : undefined,
    });
    return {
      contextMode: validated.contextMode,
      contextPackId: validated.contextPackId,
      reuseLabels: validated.reuseLabels,
    };
  }

  const resolved = await resolveGenerationCreativeContext({
    query: input.prompt,
    role: "design",
  });
  if (!input.reuseLabels.length) {
    return {
      contextMode: resolved.contextMode,
      contextPackId: resolved.contextPackId,
      reuseLabels: resolved.reuseLabels,
    };
  }
  const validated = await validateGenerationCreativeContext({
    contextPackId: resolved.contextPackId,
    reuseLabels: input.reuseLabels,
  });
  return {
    contextMode: validated.contextMode,
    contextPackId: validated.contextPackId,
    reuseLabels: validated.reuseLabels,
  };
}

function provenanceForSavedFiles(
  savedFiles: readonly { id: string; filename: string }[],
  generationSession: DesignGenerationSession | null,
  reuseLabels: readonly CreativeContextReuseLabel[],
): CreativeContextElementProvenance[] {
  return savedFiles.flatMap((file) => {
    const frame = generationSession?.frames.find(
      (candidate) => candidate.filename === file.filename,
    );
    const elementId = frame?.frameId ?? file.id;
    const labels = reuseLabels.filter(
      (label) =>
        !label.elementId ||
        label.elementId === file.id ||
        label.elementId === file.filename ||
        label.elementId === frame?.frameId,
    );
    if (!labels.length) {
      return [
        {
          elementId,
          influence: "generated" as const,
          label: file.filename,
        },
      ];
    }
    return labels.map((label) => ({
      elementId,
      influence: label.influence ?? ("reference-conditioned" as const),
      ...(label.itemId ? { itemId: label.itemId } : {}),
      ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
      label: label.label,
    }));
  });
}

async function finalizeGenerationForSavedFiles(
  designId: string,
  savedFiles: readonly { id: string; filename: string }[],
  generationSession: DesignGenerationSession | null,
  creativeContext: DesignCreativeContextProvenance,
) {
  await withGenerationSessionLock(designId, async () => {
    const key = designGenerationSessionKey(designId);
    const rawSession = await readAppState(key).catch(() => null);
    if (rawSession && typeof rawSession === "object") {
      const session = rawSession as unknown as DesignGenerationSession;
      if (session.designId === designId && Array.isArray(session.frames)) {
        const nextSession = updateGenerationSessionWithSavedFiles(
          session,
          savedFiles.map((file) => file.filename),
        );
        if (nextSession !== session) {
          await writeAppState(
            key,
            nextSession as unknown as Record<string, unknown>,
          );
        }
      }
    }

    const nextElementProvenance = provenanceForSavedFiles(
      savedFiles,
      generationSession,
      creativeContext.reuseLabels,
    );
    const previous =
      creativeContext.contextMode === "off"
        ? null
        : await getGenerationCreativeContext({
            appId: "design",
            artifactType: "design",
            artifactId: designId,
          });
    const elementProvenance =
      previous?.contextMode === creativeContext.contextMode &&
      previous.contextPackId === creativeContext.contextPackId
        ? replaceCreativeContextElementProvenance(
            previous.elementProvenance,
            nextElementProvenance,
          )
        : nextElementProvenance;
    await recordGenerationCreativeContext({
      appId: "design",
      artifactType: "design",
      artifactId: designId,
      ...creativeContext,
      elementProvenance,
    });
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
        "Pass explicit x/y/width/height for every generated screen as numbers; desktop is 1440x900.",
    },
    contextPackId: {
      type: "string",
      description:
        "Immutable creative-context pack. Omit to preserve the active generation session pack.",
    },
    contextModeOverride: {
      type: "string",
      enum: ["off"],
      description:
        "Disable Creative Context for this generation only without changing the saved preference.",
    },
    reuseLabels: {
      type: "string",
      description:
        "Optional JSON array of exact item/version labels, with elementId set to a target filename or frame id when evidence applies to one screen.",
    },
    primaryViewport: {
      type: "string",
      enum: ["mobile", "tablet", "desktop"],
      description:
        "The requested primary form factor. Defaults to desktop (1440x900). " +
        "Set this from the intake answer when no explicit canvasFrames placement is supplied. " +
        "Ignored when `devices` is provided (the widest device becomes primary).",
    },
    devices: {
      type: "array",
      items: { type: "string", enum: ["mobile", "tablet", "desktop"] },
      description:
        "Device set for responsive frames. Honor the devices the prompt " +
        'explicitly names; omit to default to ["desktop","mobile"]. The widest ' +
        "device becomes the primary/base frame and the narrower devices become " +
        "breakpoint frames — never a duplicate of the base width and never an " +
        "auto-added tablet. A single device yields one frame with no breakpoints. " +
        "When provided, this overrides primaryViewport.",
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
    "Every web design must be responsive. This action adds responsive editor " +
    "breakpoints: by default a Desktop 1440x900 base frame plus a Mobile " +
    "breakpoint (no auto tablet, no duplicate desktop). Pass `devices` to honor " +
    "the form factors the prompt explicitly names — the widest becomes the base " +
    "frame and the narrower ones become breakpoint frames. Set `primaryViewport` " +
    "for a mobile- or tablet-primary design when not passing `devices`. " +
    "Do not report a design as ready until this action succeeds. " +
    "When adding multiple screens or states, pass canvasFrames with filenames " +
    "and numeric x/y/width/height so the new screens appear placed on the " +
    "overview canvas.",
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
    contextPackId: z
      .string()
      .optional()
      .describe(
        "Immutable creative-context pack. Omit to preserve the generation session pack.",
      ),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this generation only without changing the saved preference.",
      ),
    reuseLabels: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.array(reuseLabelSchema).optional().default([]),
      )
      .describe(
        "Exact item/version labels used by the generated files or frames.",
      ),
    primaryViewport: z
      .enum(["mobile", "tablet", "desktop"])
      .optional()
      .default(DEFAULT_GENERATION_VIEWPORT)
      .describe(
        "Primary generated viewport. Defaults to desktop (1440x900); set " +
          "mobile or tablet only when that is the requested form factor. " +
          "Ignored when `devices` is provided (the widest device wins).",
      ),
    devices: z
      .array(z.enum(["mobile", "tablet", "desktop"]))
      .optional()
      .describe(
        "Explicit device set for responsive frames. Honor the devices the " +
          'prompt names; omit to default to ["desktop","mobile"]. Widest ' +
          "device = primary/base frame; narrower devices = breakpoint frames " +
          "(never the base width, never an auto tablet). One device = a single " +
          "frame with no breakpoints. When provided, this overrides " +
          "primaryViewport.",
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
    devices,
    contextPackId,
    contextModeOverride,
    reuseLabels,
  }) => {
    await assertAccess("design", designId, "editor");
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }
    const rawGenerationSession = (await readAppState(
      designGenerationSessionKey(designId),
    ).catch(() => null)) as DesignGenerationSession | null;
    const generationSession =
      rawGenerationSession?.designId === designId ? rawGenerationSession : null;
    const creativeContextProvenance = await resolveDesignCreativeContext({
      prompt,
      generationSession,
      contextPackId,
      contextModeOverride,
      reuseLabels,
    });

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

    // Gate every NEW file up front so a rejected file cannot orphan the ones
    // written before it. Existing files take the edit transition inside
    // writeInlineSourceFile, which still allows repairing a malformed screen.
    const integrityWarnings: Array<{ filename: string; message: string }> = [];
    for (const file of annotatedFiles) {
      if ((file.fileType ?? "html") !== "html") continue;
      const existing = existingByName.get(file.filename);
      // A row changing type into HTML is new HTML, not an edit: the edit
      // transition validates against the row's CURRENT type, so a css→html
      // candidate would skip the HTML checks and still be stored as HTML below.
      const becomesHtml =
        existing !== undefined && (existing.fileType ?? "html") !== "html";
      // Blocking applies to new files and type transitions. An existing HTML row
      // takes the lenient edit transition instead, so a legacy-malformed screen
      // stays repairable — but its advisories are still reported, or the same
      // content would warn as a new file and save silently as a regeneration.
      const advisory =
        !existing || becomesHtml
          ? assertDesignHtmlCreateIntegrity({
              content: file.content,
              fileType: "html",
              filename: file.filename,
            })
          : (inspectDesignHtmlDocumentIntegrity(file.content).advisory ?? []);
      for (const entry of advisory) {
        integrityWarnings.push({
          filename: file.filename,
          message: describeDesignHtmlIntegrityIssue(entry),
        });
      }
    }

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
    // An explicit `devices` list wins over primaryViewport; otherwise derive
    // the device set from primaryViewport so the default stays Desktop base +
    // Mobile breakpoint. The widest resolved device seeds the primary frame.
    const resolvedDevices =
      devices && devices.length > 0
        ? devices
        : devicesForPrimaryViewport(primaryViewport);
    const resolvedPrimaryViewport = widestGenerationDevice(resolvedDevices);
    const generatedBreakpointSet = breakpointSetForDevices(resolvedDevices);
    await mutateDesignData({
      designId,
      mutate: (prevData, { updatedAt }) => {
        const mergedData: Record<string, unknown> = {
          ...prevData,
          lastPrompt: prompt,
          generatedAt: now,
          fileCount: files.length,
          creativeContext: creativeContextProvenance,
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
        const viewport = GENERATION_VIEWPORT_SIZES[resolvedPrimaryViewport];
        // Frames placed by an earlier call: never moved, and counted as
        // occupied so a new screen is never dropped on top of one.
        const preExistingFrameIds = new Set(
          prevData.canvasFrames && typeof prevData.canvasFrames === "object"
            ? Object.keys(prevData.canvasFrames as Record<string, unknown>)
            : [],
        );
        const rectOf = (frame: {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          rotation?: number;
        }) => {
          const x = frame.x ?? 0;
          const y = frame.y ?? 0;
          const width = frame.width ?? 0;
          const height = frame.height ?? 0;
          const rotation = frame.rotation ?? 0;
          if (!rotation || width <= 0 || height <= 0) {
            return { x, y, width, height };
          }
          // Existing frames render rotated about their center; use the rotated
          // rect's axis-aligned bounding box so a new screen isn't dropped over
          // a rotated frame's real footprint.
          const radians = (rotation * Math.PI) / 180;
          const cos = Math.abs(Math.cos(radians));
          const sin = Math.abs(Math.sin(radians));
          const aabbWidth = width * cos + height * sin;
          const aabbHeight = width * sin + height * cos;
          return {
            x: x + width / 2 - aabbWidth / 2,
            y: y + height / 2 - aabbHeight / 2,
            width: aabbWidth,
            height: aabbHeight,
          };
        };
        const framesOverlap = (
          a: ReturnType<typeof rectOf>,
          b: ReturnType<typeof rectOf>,
        ) =>
          a.width > 0 &&
          a.height > 0 &&
          b.width > 0 &&
          b.height > 0 &&
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        const occupiedRects: Array<ReturnType<typeof rectOf>> = [];
        for (const id of preExistingFrameIds) {
          const frame = merged.canvasFrames[id];
          if (frame) occupiedRects.push(rectOf(frame));
        }
        // Keep arg placements for files we're not regenerating; the regenerated
        // ones are (re)placed below, so rebuild their entries here rather than
        // carry a pre-relocation position that would fail the isApplied check.
        const regeneratedFileIds = new Set(savedFiles.map((file) => file.id));
        const generationFrames = merged.placedFrames.filter(
          (placed) => !regeneratedFileIds.has(placed.fileId),
        );
        for (const placed of generationFrames) {
          occupiedRects.push(rectOf(placed.frame));
        }
        // Relocate target: right of every occupied (rotation-aware) rect.
        let nextX = occupiedRects.reduce(
          (right, rect) =>
            Math.max(right, rect.x + rect.width + GENERATED_FRAME_GAP),
          0,
        );
        for (const file of savedFiles) {
          const source = files.find(
            (candidate) => candidate.filename === file.filename,
          );
          if (!source || !isRenderableDesignFile(source)) continue;
          const current = merged.canvasFrames[file.id] ?? {};
          if (
            preExistingFrameIds.has(file.id) &&
            current.x !== undefined &&
            current.y !== undefined &&
            current.width !== undefined &&
            current.height !== undefined
          ) {
            // An explicit device request resizes the primary frame to the
            // requested viewport (preserving position/rotation); otherwise a
            // regenerated screen keeps its exact stored geometry.
            if (devices && devices.length > 0) {
              merged.canvasFrames[file.id] = {
                ...current,
                width: viewport.width,
                height: viewport.height,
              };
            }
            continue;
          }
          const width = current.width ?? viewport.width;
          const height = current.height ?? viewport.height;
          let x = current.x ?? nextX;
          let y = current.y ?? 0;
          // Bump a new screen clear of everything if its requested/default spot
          // overlaps (e.g. a second screen defaulting to the same origin). The
          // candidate carries its own rotation so a rotated placement is tested
          // by its real footprint, not its unrotated rectangle.
          const candidateRect = rectOf({
            x,
            y,
            width,
            height,
            rotation: current.rotation,
          });
          if (
            occupiedRects.some((rect) => framesOverlap(candidateRect, rect))
          ) {
            x = nextX;
            y = 0;
          }
          const frame = {
            x,
            y,
            width,
            height,
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
          occupiedRects.push(rectOf(frame));
          nextX = Math.max(nextX, frame.x + frame.width + GENERATED_FRAME_GAP);
        }
        mergedData.canvasFrames = merged.canvasFrames;
        placedFrames = generationFrames;
        // An explicit `devices` request is authoritative: replace the design's
        // breakpoint set with the derived one (or drop it for a single device),
        // so regenerating e.g. as [mobile,tablet,desktop] can't silently retain
        // a stale narrower set. Without explicit devices, only seed a default
        // set when none exists — a plain content regen never clobbers the
        // user's own breakpoints.
        if (devices && devices.length > 0) {
          if (generatedBreakpointSet.length > 0) {
            mergedData.breakpointSet = {
              id: "generated-responsive",
              breakpoints: generatedBreakpointSet,
            };
          } else {
            delete mergedData.breakpointSet;
          }
          mergedData.breakpointSetUpdatedAt = updatedAt;
        } else if (
          generatedBreakpointSet.length > 0 &&
          classifyBreakpointSet(mergedData.breakpointSet) === "absent"
        ) {
          mergedData.breakpointSet = {
            id: "generated-responsive",
            breakpoints: generatedBreakpointSet,
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
          !jsonValuesEqual(
            current.creativeContext,
            creativeContextProvenance,
          ) ||
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
        // For an explicit `devices` request, verify the persisted breakpoint
        // widths actually match the requested set (not merely that some set
        // exists), so a partial/stale write is retried rather than accepted.
        const currentBreakpointWidths = (
          Array.isArray(
            (current.breakpointSet as { breakpoints?: unknown })?.breakpoints,
          )
            ? (
                current.breakpointSet as {
                  breakpoints: Array<{ widthPx?: number }>;
                }
              ).breakpoints
            : []
        )
          .map((bp) => bp.widthPx)
          .filter((w): w is number => typeof w === "number")
          .sort((a, b) => a - b);
        const expectedBreakpointWidths = generatedBreakpointSet
          .map((bp) => bp.widthPx)
          .sort((a, b) => a - b);
        const breakpointSetApplied =
          devices && devices.length > 0
            ? jsonValuesEqual(currentBreakpointWidths, expectedBreakpointWidths)
            : generatedBreakpointSet.length === 0 ||
              classifyBreakpointSet(current.breakpointSet) !== "absent";
        return framesApplied && breakpointSetApplied;
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

    await finalizeGenerationForSavedFiles(
      designId,
      savedFiles,
      generationSession,
      creativeContextProvenance,
    );

    return {
      designId,
      urlPath: `/design/${designId}`,
      renderable: true,
      savedFiles,
      placedFrames,
      fileCount: savedFiles.length,
      // Non-blocking: a well-formed screen with no Tailwind runtime renders
      // unstyled, which reads as a layout bug rather than a missing runtime.
      ...(integrityWarnings.length > 0 ? { warnings: integrityWarnings } : {}),
      ...creativeContextProvenance,
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
