import { defineAction, embedApp } from "@agent-native/core";
import { NoWriteError } from "@agent-native/core/action";
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
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { trackDesign } from "../server/lib/design-tracking.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  SourceWorkspaceEditConflictError,
  withDesignSourceMutationTransaction,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  assertSingleCanvasOutput,
  requestedCanvasDeviceVariants,
  DEFAULT_GENERATION_VIEWPORT,
  devicesForPrimaryViewport,
  GENERATED_FRAME_GAP,
  GENERATION_VIEWPORT_SIZES,
  type GenerationViewport,
  resolveCanvasIntent,
  widestGenerationDevice,
} from "../shared/canvas-dimensions.js";
import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import {
  getOverviewScreenFileIds,
  isOverviewScreenFile,
} from "../shared/design-files.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";
import { DESIGN_GENERATION_ATTEMPT_QUERY_PARAM } from "../shared/generation-provenance.js";
import {
  designGenerationSessionKey,
  type DesignGenerationSession,
  updateGenerationSessionWithSavedFiles,
} from "../shared/generation-session.js";
import {
  assertDesignHtmlCreateIntegrity,
  DESIGN_HTML_INTEGRITY_ERROR_CODE,
  describeDesignHtmlIntegrityIssue,
  inspectDesignHtmlDocumentIntegrity,
  isDesignHtmlIntegrityError,
} from "../shared/html-integrity.js";
import { assertHubSpotEmailFrameContent } from "../shared/hubspot-email-authoring.js";
import { isHubSpotEmailHtml } from "../shared/hubspot-email.js";
import { assertLockedLayersPreserved } from "../shared/locked-layers.js";
import { derivePromptTitle } from "../shared/prompt-title.js";
import { widthToPrefix } from "../shared/responsive-classes.js";
import {
  getResponsiveBreakpointHeightPx,
  getResponsiveBreakpointWidths,
  getResponsiveGroupHeight,
  getResponsiveGroupRotatedBounds,
  getResponsiveGroupWidth,
  getScreenPreviewViewport,
  visibleBreakpointWidths,
} from "../shared/responsive-frame-layout.js";
import { annotateAgentScreenHtmlForPersist } from "../shared/screen-annotation.js";
import { tweakDefinitionsSchema } from "../shared/tweak-definition-schema.js";
import { withGenerationAttempt } from "./_generation-tracking.js";

function designDeepLink(
  designId: string,
  screenId?: string,
  generationAttemptId?: string,
): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: {
      designId,
      screen: screenId,
      [DESIGN_GENERATION_ATTEMPT_QUERY_PARAM]: generationAttemptId,
    },
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

function isRenderableDesignScreenFile(file: {
  filename: string;
  fileType?: string | null;
  content?: string | null;
}): boolean {
  return isOverviewScreenFile(file) && isRenderableDesignFile(file);
}

function noWriteValidationError(error: unknown): NoWriteError {
  if (error instanceof NoWriteError) return error;
  const contractError =
    typeof error === "object" && error !== null
      ? (error as { errorCode?: unknown; statusCode?: unknown })
      : undefined;
  return new NoWriteError(
    error instanceof Error
      ? error.message
      : "Design generation validation failed before saving.",
    {
      ...(typeof contractError?.errorCode === "string"
        ? { errorCode: contractError.errorCode }
        : isDesignHtmlIntegrityError(error)
          ? { errorCode: DESIGN_HTML_INTEGRITY_ERROR_CODE }
          : {}),
      ...(typeof contractError?.statusCode === "number"
        ? { statusCode: contractError.statusCode }
        : {}),
    },
  );
}

const GENERATION_VIEWPORT_LABELS: Record<GenerationViewport, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

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

function isFixedArtworkCopyFollowUp(prompt: string): boolean {
  return (
    /^\s*(?:please\s+)?(?:update|edit|revise|rewrite|adjust|refine|tweak)\b/i.test(
      prompt,
    ) && /\b(?:copy|text|caption|headline|tagline|wording)\b/i.test(prompt)
  );
}

function isFixedCanvasFormatConversion(prompt: string): boolean {
  return /\b(?:turn|convert|transform)\s+(?:(?:this|it|the\s+(?:artwork|design|screen|image))\s+)?(?:into|to)\b|\bresize\s+(?:(?:this|it|the\s+(?:artwork|design|screen|image))\s+)?to\b/i.test(
    prompt,
  );
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
      throw new NoWriteError(
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

// The model is shown these typed fields as they are, and the validating schema
// wraps the structured ones in `jsonField` so a JSON string still parses.
const designFileSchema = z.object({
  filename: z.string().describe("Filename (e.g. 'index.html')"),
  content: z.string().min(1).describe("File content"),
  fileType: z
    .enum(["html", "css", "jsx", "asset"])
    .optional()
    .default("html")
    .describe("Type of file"),
});

const canvasFrameSchema = z
  .object({
    fileId: z.string().optional().describe("Id of an existing design file"),
    filename: z
      .string()
      .optional()
      .describe("Filename of a file saved by this call"),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    rotation: z
      .number()
      .optional()
      .describe("Degrees. Omit unless the user asked for a rotated screen."),
    z: z.number().optional(),
  })
  .refine((frame) => frame.fileId || frame.filename, {
    message: "canvasFrames entries require fileId or filename",
  });

const designIdField = z
  .string()
  .describe("Existing design project ID to save generated content to.");

const promptField = z
  .string()
  .describe(
    "The user's request for this screen, keeping its output type and exact pixel size. " +
      "To resize or reformat an existing fixed canvas, name the output and target size, " +
      'e.g. "Instagram story, 1080x1920 canvas"; a bare "make it taller" reads as a responsive app.',
  );

const filesDescription =
  "Files to save. Pass one compact, complete, renderable index.html first, with a flat layer tree (no single-child wrapper divs) and whole-pixel lengths. " +
  'For HubSpot email HTML author email-safe tables with `<meta name="agent-native:frame-type" content="hubspot-email">` in the head; the marker is not required for export. ' +
  "Do not use generate-design to replace a selected variant screen after a variant pick; snapshot that fileId and use edit-design instead.";

const filesField = z.array(designFileSchema).min(1).describe(filesDescription);

const designSystemIdField = z
  .string()
  .nullable()
  .optional()
  .describe(
    "Optional design system ID used for generation. Pass null to unlink.",
  );

const projectTypeField = z
  .enum(["prototype", "other"])
  .optional()
  .describe("Optional project type hint.");

const tweaksField = tweakDefinitionsSchema
  .optional()
  .describe(
    "Optional tweak definitions (color swatches, segments, sliders, toggles) bound to CSS custom properties in the design. Omit unless the HTML uses matching CSS variables. Surface 3-6 of the most impactful knobs (accent color, density, radius, dark mode, font choice); each must reference a CSS var the design's `:root` block actually uses.",
  );

// Reject two placements for the same target in one call. Without this,
// mergeCanvasFramePlacements folds both entries into a single
// canvasFrames[fileId] value (last one wins), but the mutateDesignData
// isApplied check below verifies EVERY placedFrames entry against that single
// folded value — so the earlier, now-overwritten entry always fails the
// equality check. Since the mutate callback is deterministic, every retry
// recomputes the identical mismatch, so the whole action always fails with a
// "concurrent write conflicts" error after burning through all retries, even
// though nothing else was actually writing to the design.
const canvasFramesField = z
  .array(canvasFrameSchema)
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
  .optional()
  .describe(
    "Optional overview-canvas placements keyed by filename or fileId. " +
      "Pass explicit x/y/width/height for every generated screen as numbers. " +
      "When the prompt gives one exact pixel size, use those exact width/height values. " +
      "For screens with different exact sizes, make separate calls scoped to one screen each.",
  );

const contextPackIdField = z
  .string()
  .optional()
  .describe(
    "Immutable creative-context pack. Omit to preserve the active generation session pack.",
  );

const contextModeOverrideField = z
  .literal("off")
  .optional()
  .describe(
    "Disable Creative Context for this generation only without changing the saved preference.",
  );

const reuseLabelsField = z
  .array(reuseLabelSchema)
  .optional()
  .default([])
  .describe(
    "Optional exact item/version labels, with elementId set to a target filename or frame id when evidence applies to one screen. " +
      "itemId and itemVersionId go together; only `generated` labels may omit them.",
  );

const primaryViewportField = z
  .enum(["mobile", "tablet", "desktop"])
  .optional()
  .default(DEFAULT_GENERATION_VIEWPORT)
  .describe(
    "The requested primary form factor. Defaults to desktop (1440x900). " +
      "Set this from the intake answer when no explicit canvasFrames placement is supplied. " +
      "Ignored when `devices` is provided (the widest device becomes primary).",
  );

const devicesField = z
  .array(z.enum(["mobile", "tablet", "desktop"]))
  .optional()
  .describe(
    "Device set for responsive frames. Exact pixels or a platform preset " +
      "in the original prompt always use no device breakpoints and ignore " +
      "this field. For a fixed-artwork inference without exact pixels or a " +
      "preset, honor variants explicitly named in the original prompt; omit " +
      'to default to ["desktop","mobile"]. Pass [] for fixed artwork ' +
      "without those named variants and for follow-ups on an existing " +
      "fixed canvas. " +
      "The result lists ignored model devices as `ignoredDevices`; give " +
      "each other exact size its own call. " +
      "One exact canvas size per call; prompts with multiple distinct exact sizes are rejected. " +
      "The widest " +
      "device becomes the primary/base frame and the narrower devices become " +
      "breakpoint frames — never a duplicate of the base width and never an " +
      "auto-added tablet. A single device yields one frame with no breakpoints. " +
      "When provided, this overrides primaryViewport.",
  );

// Strings are still accepted for the CLI and older callers. A failure names the
// field: the SyntaxError alone reports only a position.
const jsonField = (name: string) => (value: unknown, ctx: z.RefinementCtx) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `${name} is not valid JSON (${error instanceof Error ? error.message : "parse failed"}). Send it as an array, or escape quotes and newlines inside every string.`,
    });
    return z.NEVER;
  }
};

const generateDesignAction = defineAction({
  description:
    "Save generated design content to a design project. " +
    "The agent calls this after generating HTML/CSS/JSX content to persist it " +
    "as files in the design project. Creates or updates files as needed. " +
    "Returns the saved files and design URL path for iframe rendering. " +
    "A file rejected by a concurrent edit or an HTML-integrity check does not " +
    "fail the whole call — it is listed in `fileErrors` instead, while every " +
    "other file in the same call still saves; resend just the named file(s). " +
    "Build a new screen with several sections skeleton-first: save the document shell " +
    "with one sized, unstyled placeholder per section (each marked `data-skeleton` with a " +
    "`data-layer-name`), then fill one section per `edit-design` call, top to bottom, so " +
    "the canvas drafts each section in as it lands (steps in the design-generation skill). " +
    "This also keeps every payload small: a single oversized payload can get cut off " +
    "mid-stream and stall the turn. " +
    "Do not use this action to replace a selected variant screen after a " +
    "variant pick; call `get-design-snapshot` for the selected `fileId` and " +
    "`edit-design` that same `fileId` instead. " +
    "Before writing, use `designSystem.agentContext` from create-design or " +
    "get-design-system, or call get-design-snapshot for an existing design; " +
    "apply its tokens/docs before writing file content. Do not treat an id " +
    "alone as enough design-system context. " +
    "Every app or website UI must be responsive unless the user requests a " +
    "fixed canvas. Static artwork such as ads, banners, social posts, flyers, " +
    "and posters is one fixed canvas by default. Exact pixel dimensions or a " +
    "platform preset in `prompt` always pin the canvas size and ignore devices " +
    "suggested by the model or named alongside those exact sizes. For a " +
    "noun-only fixed-artwork inference, honor device variants explicitly named " +
    "in the original prompt; model-suggested devices may override that weak " +
    "inference. " +
    "Use one exact canvas size per call; make separate calls for screens or " +
    "artwork with different exact sizes. Responsive app screens default to a " +
    "Desktop 1440x900 base frame plus a Mobile breakpoint (no auto tablet, no " +
    "duplicate desktop). Pass `devices` to honor the form factors the prompt " +
    "explicitly names — the widest becomes the base frame and the narrower " +
    "ones become breakpoint frames. Set `primaryViewport` for a mobile- or " +
    "tablet-primary design when not passing `devices`. " +
    "Do not report a design as ready until this action succeeds. " +
    "When adding multiple screens or states, pass canvasFrames with filenames " +
    "and numeric x/y/width/height so the new screens appear placed on the " +
    "overview canvas. For HubSpot email output, author email-safe table HTML without browser runtimes, with the `agent-native:frame-type` meta marker in the head. Any HTML frame can be validated with export-hubspot-html before reporting compatibility.",
  schema: z.object({
    designId: designIdField,
    prompt: promptField,
    files: z.preprocess(jsonField("files"), filesField),
    designSystemId: designSystemIdField,
    projectType: projectTypeField,
    tweaks: z.preprocess(jsonField("tweaks"), tweaksField).optional(),
    canvasFrames: z
      .preprocess(jsonField("canvasFrames"), canvasFramesField)
      .optional(),
    contextPackId: contextPackIdField,
    contextModeOverride: contextModeOverrideField,
    reuseLabels: z.preprocess(jsonField("reuseLabels"), reuseLabelsField),
    primaryViewport: primaryViewportField,
    devices: devicesField,
  }),
  agentInputSchema: z.object({
    designId: designIdField,
    prompt: promptField,
    files: filesField,
    designSystemId: designSystemIdField,
    projectType: projectTypeField,
    tweaks: tweaksField,
    canvasFrames: canvasFramesField,
    contextPackId: contextPackIdField,
    contextModeOverride: contextModeOverrideField,
    reuseLabels: reuseLabelsField,
    primaryViewport: primaryViewportField,
    devices: devicesField,
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  eagerInputStreaming: true,
  run: withGenerationAttempt(async (input, context, attempt) => {
    const {
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
    } = input;
    const canvasIntent = resolveCanvasIntent(prompt);
    assertSingleCanvasOutput(canvasIntent);
    const promptCanvasDimensions =
      canvasIntent.kind === "fixed" ? canvasIntent.dimensions : undefined;
    await assertAccess("design", designId, "editor");
    const rawGenerationSession = (await readAppState(
      designGenerationSessionKey(designId),
      // coercion-ok: an unreadable session means generating without plan context.
    ).catch(() => null)) as DesignGenerationSession | null;
    const generationSession =
      rawGenerationSession?.designId === designId ? rawGenerationSession : null;
    // A call filling a still-pending frame of a generate-screens plan is that
    // plan's attempt; the plan itself saves no files and records no attempt.
    const fillsPlannedScreen = Boolean(
      generationSession &&
      generationSession.status !== "done" &&
      generationSession.status !== "cancelled" &&
      generationSession.frames.some(
        (frame) =>
          frame.status !== "done" &&
          files.some((file) => file.filename === frame.filename),
      ),
    );
    const generationAttemptId = attempt.id;
    attempt.start({
      designId,
      generationPath: fillsPlannedScreen ? "screens" : "generate_design",
      prompt,
      hasReferenceDesignSystem: Boolean(designSystemId),
      properties: {
        prompt_type: "ui",
        source: "generate_design_action",
        ...(fillsPlannedScreen && generationSession
          ? { generation_session_id: generationSession.id }
          : {}),
      },
    });
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }
    const db = getDb();
    const now = new Date().toISOString();

    for (const file of files) {
      if (
        file.filename.includes("..") ||
        file.filename.includes("/") ||
        file.filename.includes("\\")
      ) {
        throw new NoWriteError(
          `Invalid filename "${file.filename}": path traversal not allowed`,
        );
      }
    }

    const savedFiles: Array<{
      id: string;
      filename: string;
      fileType: string;
    }> = [];
    attempt.savedFileCount = () => savedFiles.length;

    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    const hasRenderableFile =
      files.some(isRenderableDesignFile) ||
      existingFiles.some(isRenderableDesignFile);
    if (!hasRenderableFile) {
      throw new NoWriteError(
        "generate-design requires at least one non-empty HTML or JSX file before the design can be reported as ready",
      );
    }

    const creativeContextProvenance = await resolveDesignCreativeContext({
      prompt,
      generationSession,
      ...(contextPackId ? { contextPackId } : {}),
      ...(contextModeOverride ? { contextModeOverride } : {}),
      reuseLabels: reuseLabels.map(
        ({
          itemId,
          itemVersionId,
          kind,
          label,
          dataRole,
          elementId,
          influence,
        }) => ({
          ...(itemId ? { itemId } : {}),
          ...(itemVersionId ? { itemVersionId } : {}),
          kind,
          label,
          dataRole,
          ...(elementId ? { elementId } : {}),
          ...(influence ? { influence } : {}),
        }),
      ),
    });

    const existingByName = new Map(existingFiles.map((f) => [f.filename, f]));

    for (const file of files) {
      try {
        assertHubSpotEmailFrameContent({
          content: file.content,
          fileType: file.fileType,
        });
      } catch (error) {
        throw noWriteValidationError(error);
      }
    }

    const annotatedFiles = files.map((file) => ({
      ...file,
      content: annotateAgentScreenHtmlForPersist(file.content, file.fileType),
    }));

    const liveFilesById = new Map<
      string,
      Awaited<ReturnType<typeof readLiveSourceFile>>
    >();
    for (const file of annotatedFiles) {
      const existing = existingByName.get(file.filename);
      if (!existing) continue;
      const workspaceFile: SourceWorkspaceFile = {
        id: existing.id,
        designId: existing.designId,
        filename: existing.filename,
        fileType: existing.fileType,
        content: existing.content,
        createdAt: null,
        updatedAt: null,
      };
      const live = await readLiveSourceFile(workspaceFile);
      try {
        assertLockedLayersPreserved(live.content, file.content);
      } catch (error) {
        throw noWriteValidationError(error);
      }
      liveFilesById.set(existing.id, live);
    }

    const integrityWarnings: Array<{ filename: string; message: string }> = [];
    for (const file of annotatedFiles) {
      if ((file.fileType ?? "html") !== "html") continue;
      const existing = existingByName.get(file.filename);
      const becomesHtml =
        existing !== undefined && (existing.fileType ?? "html") !== "html";
      let advisory: ReturnType<typeof assertDesignHtmlCreateIntegrity>;
      if (!existing || becomesHtml) {
        try {
          advisory = assertDesignHtmlCreateIntegrity({
            content: file.content,
            fileType: "html",
            filename: file.filename,
          });
        } catch (error) {
          throw noWriteValidationError(error);
        }
      } else {
        const inspected = inspectDesignHtmlDocumentIntegrity(file.content);
        advisory = inspected.valid
          ? (inspected.advisory ?? [])
          : (inspected.detail ?? []);
      }
      for (const entry of advisory) {
        integrityWarnings.push({
          filename: file.filename,
          message: describeDesignHtmlIntegrityIssue(entry),
        });
      }
    }

    await snapshotDesignBeforeAgentEdit(designId, context);

    await mutateDesignData({
      designId,
      mutate: (current) => current,
      isApplied: () => true,
    });

    const fileErrors: Array<{ filename: string; message: string }> = [];
    for (const file of annotatedFiles) {
      const existing = existingByName.get(file.filename);
      if (existing) {
        agentEnterDocument(existing.id);
        agentUpdateSelection(existing.id, {
          generatingFile: file.filename,
          designId,
        });

        try {
          try {
            const workspaceFile: SourceWorkspaceFile = {
              id: existing.id,
              designId: existing.designId,
              filename: existing.filename ?? "",
              fileType: existing.fileType ?? "html",
              content: existing.content,
              createdAt: null,
              updatedAt: null,
            };
            const live = liveFilesById.get(existing.id);
            if (!live) {
              // guard:allow-bare-error — invariant: every existing file is inserted during the preflight loop before this write phase.
              throw new Error(
                `Missing preflight source version for ${existing.filename}`,
              );
            }

            await writeInlineSourceFile({
              designId: existing.designId,
              file: workspaceFile,
              content: file.content,
              expectedVersionHash: live.versionHash,
            });

            const nextFileType = file.fileType ?? "html";
            if (nextFileType !== (existing.fileType ?? "html")) {
              await withDesignSourceMutationTransaction(
                existing.designId,
                (tx) =>
                  tx
                    .update(schema.designFiles)
                    .set({ fileType: nextFileType, updatedAt: now })
                    .where(
                      and(
                        eq(schema.designFiles.id, existing.id),
                        eq(schema.designFiles.designId, existing.designId),
                      ),
                    ),
              );
            }
          } finally {
            agentLeaveDocument(existing.id);
          }
        } catch (error) {
          if (
            !(error instanceof SourceWorkspaceEditConflictError) &&
            !isDesignHtmlIntegrityError(error)
          ) {
            throw error;
          }
          fileErrors.push({
            filename: file.filename,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        savedFiles.push({
          id: existing.id,
          filename: file.filename,
          fileType: file.fileType ?? "html",
        });
      } else {
        const fileId = nanoid();
        await withDesignSourceMutationTransaction(designId, (tx) =>
          tx.insert(schema.designFiles).values({
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
          }),
        );

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

    let placedFrames:
      | Array<{
          fileId: string;
          filename?: string;
          frame: CanvasFramePlacement;
        }>
      | undefined;
    let screenMetadataUpdates: Array<{
      fileId: string;
      width: number;
      height: number;
      breakpointWidths: number[] | undefined;
      fixedSize: boolean;
      contentDriven: boolean;
    }> = [];
    const normalizedTweaks = tweaks?.map((tweak) => ({
      ...tweak,
      type: tweak.type === "color-swatches" ? "color-swatch" : tweak.type,
    }));
    const exactFixedCanvasOutput =
      canvasIntent.kind === "fixed" &&
      (canvasIntent.source === "explicit-dimensions" ||
        canvasIntent.source === "preset");
    const fixedCanvasIntent = canvasIntent.kind === "fixed";
    const userRequestedDeviceVariants =
      fixedCanvasIntent && !exactFixedCanvasOutput
        ? requestedCanvasDeviceVariants(prompt)
        : [];
    const fixedArtworkFollowUp =
      fixedCanvasIntent &&
      existingFiles.some((existingFile) =>
        files.some((file) => file.filename === existingFile.filename),
      ) &&
      isFixedArtworkCopyFollowUp(prompt);
    const renderableFiles = files.filter(isRenderableDesignScreenFile);
    const emailOnlyOutput =
      renderableFiles.length > 0 &&
      renderableFiles.every((file) => isHubSpotEmailHtml(file.content));
    const requestedDevices =
      emailOnlyOutput || exactFixedCanvasOutput
        ? []
        : userRequestedDeviceVariants.length > 0
          ? userRequestedDeviceVariants
          : devices !== undefined && fixedArtworkFollowUp
            ? []
            : devices;
    const ignoredModelDevices = exactFixedCanvasOutput ? (devices ?? []) : [];
    const explicitDeviceSelection =
      requestedDevices !== undefined && requestedDevices.length > 0;
    const explicitlyEmptyDeviceSelection =
      requestedDevices !== undefined && requestedDevices.length === 0;
    const fixedCanvasOutput =
      fixedCanvasIntent && (!explicitDeviceSelection || exactFixedCanvasOutput);
    const resolvedDevices =
      requestedDevices ??
      (fixedCanvasOutput ? [] : devicesForPrimaryViewport(primaryViewport));
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
        if (promptCanvasDimensions) {
          for (const file of savedFiles) {
            const source = files.find(
              (candidate) => candidate.filename === file.filename,
            );
            if (!source || !isRenderableDesignScreenFile(source)) continue;
            const frame = merged.canvasFrames[file.id];
            if (!frame) continue;
            merged.canvasFrames[file.id] = {
              ...frame,
              width: promptCanvasDimensions.width,
              height: promptCanvasDimensions.height,
            };
          }
        }
        const viewport = GENERATION_VIEWPORT_SIZES[resolvedPrimaryViewport];
        const effectiveBreakpointWidths = explicitDeviceSelection
          ? generatedBreakpointSet.map((breakpoint) => breakpoint.widthPx)
          : classifyBreakpointSet(prevData.breakpointSet) === "present"
            ? getResponsiveBreakpointWidths(prevData.breakpointSet)
            : classifyBreakpointSet(prevData.breakpointSet) === "absent"
              ? generatedBreakpointSet.map((breakpoint) => breakpoint.widthPx)
              : [];
        const responsiveScreenFileIds = new Set([
          ...getOverviewScreenFileIds(existingFiles),
          ...getOverviewScreenFileIds(savedFiles),
        ]);
        const preExistingFrameIds = new Set(
          prevData.canvasFrames && typeof prevData.canvasFrames === "object"
            ? Object.keys(prevData.canvasFrames as Record<string, unknown>)
            : [],
        );
        if (explicitDeviceSelection && !exactFixedCanvasOutput) {
          for (const file of savedFiles) {
            const source = files.find(
              (candidate) => candidate.filename === file.filename,
            );
            if (!source || !isRenderableDesignScreenFile(source)) continue;
            const current = merged.canvasFrames[file.id];
            if (
              preExistingFrameIds.has(file.id) &&
              current?.x !== undefined &&
              current.y !== undefined &&
              current.width !== undefined &&
              current.height !== undefined
            ) {
              merged.canvasFrames[file.id] = {
                ...current,
                width: viewport.width,
                height: viewport.height,
              };
            }
          }
        }
        const nextScreenMetadata =
          prevData.screenMetadata &&
          typeof prevData.screenMetadata === "object" &&
          !Array.isArray(prevData.screenMetadata)
            ? { ...(prevData.screenMetadata as Record<string, unknown>) }
            : {};
        screenMetadataUpdates = [];
        for (const file of savedFiles) {
          const source = files.find(
            (candidate) => candidate.filename === file.filename,
          );
          if (!source || !isRenderableDesignScreenFile(source)) continue;
          const rawMetadata = nextScreenMetadata[file.id];
          const metadata =
            rawMetadata &&
            typeof rawMetadata === "object" &&
            !Array.isArray(rawMetadata)
              ? (rawMetadata as Record<string, unknown>)
              : {};
          const frame = merged.canvasFrames[file.id];
          const emailFrame = isHubSpotEmailHtml(source.content);
          const width =
            (emailFrame ? 600 : undefined) ??
            promptCanvasDimensions?.width ??
            (explicitDeviceSelection
              ? typeof frame?.width === "number" && frame.width > 0
                ? frame.width
                : viewport.width
              : typeof metadata.width === "number" && metadata.width > 0
                ? metadata.width
                : typeof frame?.width === "number" && frame.width > 0
                  ? frame.width
                  : viewport.width);
          const height =
            (emailFrame
              ? typeof metadata.height === "number"
                ? metadata.height
                : (frame?.height ?? 800)
              : undefined) ??
            promptCanvasDimensions?.height ??
            (explicitDeviceSelection
              ? typeof frame?.height === "number" && frame.height > 0
                ? frame.height
                : viewport.height
              : typeof metadata.height === "number" && metadata.height > 0
                ? metadata.height
                : typeof frame?.height === "number" && frame.height > 0
                  ? frame.height
                  : viewport.height);
          const existingBreakpointWidths =
            Array.isArray(metadata.breakpointWidths) &&
            metadata.breakpointWidths.every(
              (value): value is number =>
                typeof value === "number" && Number.isFinite(value),
            )
              ? metadata.breakpointWidths
              : undefined;
          const previousFrame = (
            prevData.canvasFrames as
              | Record<string, { width?: number; height?: number }>
              | undefined
          )?.[file.id];
          const existingWidth =
            typeof metadata.width === "number" && metadata.width > 0
              ? metadata.width
              : previousFrame?.width;
          const existingHeight =
            typeof metadata.height === "number" && metadata.height > 0
              ? metadata.height
              : previousFrame?.height;
          const sameFixedCanvasSize =
            fixedCanvasOutput &&
            (metadata.heightMode === "fixed" ||
              metadata.heightPinned === true ||
              fixedArtworkFollowUp) &&
            existingWidth === width &&
            existingHeight === height &&
            !isFixedCanvasFormatConversion(prompt);
          const breakpointWidths = emailFrame
            ? []
            : explicitDeviceSelection
              ? fixedCanvasOutput
                ? generatedBreakpointSet.map((breakpoint) => breakpoint.widthPx)
                : undefined
              : sameFixedCanvasSize
                ? (existingBreakpointWidths ?? [])
                : fixedCanvasOutput || explicitlyEmptyDeviceSelection
                  ? []
                  : existingBreakpointWidths !== undefined
                    ? existingBreakpointWidths
                    : generatedBreakpointSet.length === 0
                      ? []
                      : undefined;
          const nextMetadata: Record<string, unknown> = {
            ...metadata,
            width,
            height,
          };
          if (breakpointWidths) {
            nextMetadata.breakpointWidths = breakpointWidths;
          } else {
            delete nextMetadata.breakpointWidths;
          }
          if (emailFrame) {
            nextMetadata.heightPinned = false;
            nextMetadata.heightMode = "hug";
            if (frame)
              merged.canvasFrames[file.id] = { ...frame, width, height };
          } else if (fixedCanvasOutput) {
            nextMetadata.heightPinned = true;
            nextMetadata.heightMode = "fixed";
          }
          if (!jsonValuesEqual(rawMetadata, nextMetadata)) {
            nextScreenMetadata[file.id] = nextMetadata;
            screenMetadataUpdates.push({
              fileId: file.id,
              width,
              height,
              breakpointWidths,
              fixedSize: fixedCanvasOutput && !emailFrame,
              contentDriven: emailFrame,
            });
          }
        }
        const metadataByFileId = nextScreenMetadata;
        const rectOf = (
          frame: {
            x?: number;
            y?: number;
            width?: number;
            height?: number;
            rotation?: number;
          },
          fileId?: string,
        ) => {
          const x = frame.x ?? 0;
          const y = frame.y ?? 0;
          const width = frame.width ?? 0;
          const height = frame.height ?? 0;
          const rawMetadata = fileId ? metadataByFileId[fileId] : undefined;
          const metadata =
            rawMetadata &&
            typeof rawMetadata === "object" &&
            !Array.isArray(rawMetadata)
              ? (rawMetadata as Record<string, unknown>)
              : {};
          const sourceWidth =
            typeof metadata.width === "number" && metadata.width > 0
              ? metadata.width
              : 1280;
          const sourceHeight =
            typeof metadata.height === "number" && metadata.height > 0
              ? metadata.height
              : 2560;
          const screenBreakpointWidths = Array.isArray(
            metadata.breakpointWidths,
          )
            ? metadata.breakpointWidths.filter(
                (value): value is number =>
                  typeof value === "number" && Number.isFinite(value),
              )
            : effectiveBreakpointWidths;
          const visibleWidths = visibleBreakpointWidths(
            responsiveScreenFileIds.has(fileId ?? "")
              ? screenBreakpointWidths
              : [],
            typeof metadata.width === "number" ? metadata.width : width,
          );
          const scale = getScreenPreviewViewport(
            { width: sourceWidth, height: sourceHeight },
            { width, height },
          ).scale;
          const groupWidth = getResponsiveGroupWidth({
            primaryWidth: Math.max(1, width),
            scale,
            visibleWidths,
          });
          const groupHeight = getResponsiveGroupHeight({
            primaryHeight: Math.max(1, height),
            scale,
            sourceWidth,
            sourceHeight,
            visibleWidths,
            resolveBreakpointHeightPx: (widthPx) =>
              getResponsiveBreakpointHeightPx(metadata, widthPx),
          });
          const rotation = frame.rotation ?? 0;
          if (!rotation || width <= 0 || height <= 0) {
            return { x, y, width: groupWidth, height: groupHeight };
          }
          return getResponsiveGroupRotatedBounds({
            x,
            y,
            primaryWidth: width,
            primaryHeight: height,
            groupWidth,
            groupHeight,
            rotation,
          });
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
        const exactSizeResizedFileIds = promptCanvasDimensions
          ? new Set(
              savedFiles
                .filter((file) => {
                  if (!preExistingFrameIds.has(file.id)) return false;
                  const source = files.find(
                    (candidate) => candidate.filename === file.filename,
                  );
                  return Boolean(
                    source && isRenderableDesignScreenFile(source),
                  );
                })
                .map((file) => file.id),
            )
          : new Set<string>();
        for (const id of preExistingFrameIds) {
          if (exactSizeResizedFileIds.has(id)) continue;
          const frame = merged.canvasFrames[id];
          if (frame) occupiedRects.push(rectOf(frame, id));
        }
        const regeneratedFileIds = new Set(savedFiles.map((file) => file.id));
        const generationFrames = merged.placedFrames.filter(
          (placed) => !regeneratedFileIds.has(placed.fileId),
        );
        for (const placed of generationFrames) {
          occupiedRects.push(rectOf(placed.frame, placed.fileId));
        }
        for (const file of savedFiles) {
          if (preExistingFrameIds.has(file.id)) continue;
          const source = files.find(
            (candidate) => candidate.filename === file.filename,
          );
          if (source && isRenderableDesignScreenFile(source)) continue;
          const frame = merged.canvasFrames[file.id];
          if (frame) occupiedRects.push(rectOf(frame, file.id));
        }
        let nextX = occupiedRects.reduce(
          (right, rect) =>
            Math.max(right, rect.x + rect.width + GENERATED_FRAME_GAP),
          0,
        );
        for (const file of savedFiles) {
          const source = files.find(
            (candidate) => candidate.filename === file.filename,
          );
          if (!source || !isRenderableDesignScreenFile(source)) continue;
          const current = merged.canvasFrames[file.id] ?? {};
          const emailFrame = isHubSpotEmailHtml(source.content);
          if (
            preExistingFrameIds.has(file.id) &&
            !exactSizeResizedFileIds.has(file.id) &&
            current.x !== undefined &&
            current.y !== undefined &&
            current.width !== undefined &&
            current.height !== undefined
          ) {
            continue;
          }
          const width = emailFrame
            ? 600
            : (current.width ??
              promptCanvasDimensions?.width ??
              viewport.width);
          const height =
            current.height ??
            (emailFrame ? 800 : undefined) ??
            promptCanvasDimensions?.height ??
            viewport.height;
          let x = current.x ?? nextX;
          let y = current.y ?? 0;
          let candidateRect = rectOf(
            {
              x,
              y,
              width,
              height,
              rotation: current.rotation,
            },
            file.id,
          );
          if (
            occupiedRects.some((rect) => framesOverlap(candidateRect, rect))
          ) {
            y = 0;
            x = Math.max(x, nextX);
            candidateRect = rectOf(
              {
                x,
                y,
                width,
                height,
                rotation: current.rotation,
              },
              file.id,
            );
            while (true) {
              const overlappingRects = occupiedRects.filter((rect) =>
                framesOverlap(candidateRect, rect),
              );
              if (overlappingRects.length === 0) break;
              const leftOffset = candidateRect.x - x;
              x = Math.max(
                x + GENERATED_FRAME_GAP,
                ...overlappingRects.map(
                  (rect) =>
                    rect.x + rect.width + GENERATED_FRAME_GAP - leftOffset,
                ),
              );
              candidateRect = rectOf(
                {
                  x,
                  y,
                  width,
                  height,
                  rotation: current.rotation,
                },
                file.id,
              );
            }
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
          const frameRect = rectOf(frame, file.id);
          occupiedRects.push(frameRect);
          nextX = Math.max(
            nextX,
            frameRect.x + frameRect.width + GENERATED_FRAME_GAP,
          );
        }
        for (const file of savedFiles) {
          if (generationFrames.some((placed) => placed.fileId === file.id)) {
            continue;
          }
          const frame = merged.canvasFrames[file.id];
          if (
            !frame ||
            frame.x === undefined ||
            frame.y === undefined ||
            frame.width === undefined ||
            frame.height === undefined
          ) {
            continue;
          }
          generationFrames.push({
            fileId: file.id,
            filename: file.filename,
            frame: {
              x: frame.x,
              y: frame.y,
              width: frame.width,
              height: frame.height,
              ...(frame.rotation === undefined
                ? {}
                : { rotation: frame.rotation }),
            },
          });
        }
        mergedData.canvasFrames = merged.canvasFrames;
        mergedData.screenMetadata = nextScreenMetadata;
        placedFrames = generationFrames;
        if (explicitDeviceSelection) {
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
        const currentMetadata =
          current.screenMetadata &&
          typeof current.screenMetadata === "object" &&
          !Array.isArray(current.screenMetadata)
            ? (current.screenMetadata as Record<string, unknown>)
            : {};
        const screenMetadataApplied = screenMetadataUpdates.every(
          ({
            fileId,
            width,
            height,
            breakpointWidths,
            fixedSize,
            contentDriven,
          }) => {
            const metadata = currentMetadata[fileId];
            return (
              metadata &&
              typeof metadata === "object" &&
              !Array.isArray(metadata) &&
              (metadata as Record<string, unknown>).width === width &&
              (metadata as Record<string, unknown>).height === height &&
              (breakpointWidths === undefined
                ? (metadata as Record<string, unknown>).breakpointWidths ===
                  undefined
                : jsonValuesEqual(
                    (metadata as Record<string, unknown>).breakpointWidths,
                    breakpointWidths,
                  )) &&
              (!fixedSize ||
                ((metadata as Record<string, unknown>).heightPinned === true &&
                  (metadata as Record<string, unknown>).heightMode ===
                    "fixed")) &&
              (!contentDriven ||
                ((metadata as Record<string, unknown>).heightPinned === false &&
                  (metadata as Record<string, unknown>).heightMode === "hug"))
            );
          },
        );
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
        const breakpointSetApplied = explicitDeviceSelection
          ? jsonValuesEqual(currentBreakpointWidths, expectedBreakpointWidths)
          : generatedBreakpointSet.length === 0 ||
            classifyBreakpointSet(current.breakpointSet) !== "absent";
        return framesApplied && screenMetadataApplied && breakpointSetApplied;
      },
    });

    const promptTitle = derivePromptTitle(prompt);
    if (promptTitle !== "Untitled" && promptTitle !== "Untitled Design") {
      await db
        .update(schema.designs)
        .set({ title: promptTitle })
        .where(
          and(
            eq(schema.designs.id, designId),
            inArray(schema.designs.title, ["Untitled", "Untitled Design"]),
          ),
        );
    }

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

    trackDesign(
      "design_edited",
      {
        output_id: designId,
        generation_attempt_id: generationAttemptId,
        output_type: "design",
        edit_type: "generation",
        file_count: savedFiles.length,
      },
      context,
    );

    const firstRenderableSavedFile = savedFiles.find((file) => {
      const source = files.find(
        (candidate) => candidate.filename === file.filename,
      );
      return source ? isRenderableDesignFile(source) : false;
    });
    return {
      designId,
      urlPath: firstRenderableSavedFile
        ? `/design/${encodeURIComponent(designId)}?editorView=overview&screen=${encodeURIComponent(firstRenderableSavedFile.id)}&${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=${encodeURIComponent(generationAttemptId)}`
        : `/design/${encodeURIComponent(designId)}?${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=${encodeURIComponent(generationAttemptId)}`,
      renderable: true,
      _receipt: designOutputWriteReceipt(designId, savedFiles.length),
      savedFiles,
      placedFrames,
      fileCount: savedFiles.length,
      ...(ignoredModelDevices.length > 0
        ? { ignoredDevices: ignoredModelDevices }
        : {}),
      ...(integrityWarnings.length > 0 ? { warnings: integrityWarnings } : {}),
      ...(fileErrors.length > 0 ? { fileErrors } : {}),
      ...creativeContextProvenance,
    };
  }),
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    const urlPath = (result as { urlPath?: string }).urlPath;
    const screenId = urlPath
      ? new URL(urlPath, "http://an.invalid").searchParams.get("screen")
      : null;
    const generationAttemptId = urlPath
      ? new URL(urlPath, "http://an.invalid").searchParams.get(
          DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
        )
      : null;
    return {
      url: designDeepLink(
        designId,
        screenId ?? undefined,
        generationAttemptId ?? undefined,
      ),
      label: "Open design",
      view: "editor",
    };
  },
});

export default generateDesignAction;
