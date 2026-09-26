/**
 * patch-deck — granular, server-side read-modify-write for deck fields,
 * individual slides, slide ordering, slide deletion, and slide addition.
 *
 * All mutations run under the same per-deck lock used by `add-slide` so
 * concurrent writers touching DIFFERENT slides of the same deck never
 * silently overwrite each other's work (the last-full-PUT-wins race).
 *
 * This action is called by the client editor instead of the old full-deck PUT.
 * Agent actions (update-slide, add-slide, etc.) continue to use their own
 * dedicated actions which also use the same per-deck lock.
 */
import {
  AgentActionStopError,
  isActionContractError,
} from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getGenerationCreativeContext,
  mergeCreativeContextReuseLabels,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  normalizeSlidePadding,
  normalizeSlidePaddingForWrite,
} from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
  deckVersionContentSignature,
} from "../server/lib/deck-versions.js";
import { formatSlideHtml } from "../server/lib/slide-content-patch.js";
import {
  assertSourceSlidePreserved,
  sourceImportForDeck,
  type SourceImportMetadata,
} from "../server/lib/source-import.js";
import { assertSlideAnimationsResolve } from "../server/lib/validate-slide-animations.js";
import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";
import {
  assertHumanReadableDeckTitle,
  repairGeneratedDeckTitle,
} from "../shared/deck-title.js";
import {
  createLayoutFitRevision,
  deckFitRenderFieldsChanged,
  hashSlideContent,
  slideFitRenderFieldsChanged,
} from "../shared/slide-fit.js";
import { assertStyleOnlyEdit } from "../shared/slide-style-only.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import {
  assertNoRenderArtifacts,
  assertNoRenderArtifactsInNewSlide,
} from "./_render-artifacts.js";

const LOCK_KEY = "__slidesDeckPatchLocks" as const;
type GlobalWithLocks = typeof globalThis & {
  [LOCK_KEY]?: Map<string, Promise<unknown>>;
};
const globalRef = globalThis as GlobalWithLocks;
if (!globalRef[LOCK_KEY]) {
  globalRef[LOCK_KEY] = new Map<string, Promise<unknown>>();
}
const deckLocks: Map<string, Promise<unknown>> = globalRef[LOCK_KEY]!;

export function withDeckLock<T>(
  deckId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = deckLocks.get(deckId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  deckLocks.set(deckId, next);
  next
    .finally(() => {
      if (deckLocks.get(deckId) === next) deckLocks.delete(deckId);
    })
    .catch(() => {});
  return next;
}


const SlideAnimationSchema = z.object({
  id: z.string().min(1).describe("Stable ID for this ordered reveal step"),
  elementIndex: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based legacy child index. Keep it paired with elementPath for compatibility.",
    ),
  elementPath: z
    .array(z.number().int().min(0))
    .min(1)
    .optional()
    .describe(
      "Preferred 0-based child-index path from the outer .fmd-slide wrapper. Required for agent-created or content-revised animations; re-read final HTML after content edits.",
    ),
  byParagraph: z
    .boolean()
    .optional()
    .describe(
      "Reveal each paragraph in this text object as its own click step.",
    ),
  type: z
    .enum(["appear", "fade", "slide-up", "zoom"])
    .describe(
      "Animation used when this step is revealed. Supported semantics: appear (immediate reveal), fade (opacity), slide-up (subtle upward motion), zoom (subtle scale). Do not invent other types.",
    ),
});

const SlideFieldsSchema = z.object({
  content: z.string().optional(),
  notes: z.string().optional(),
  background: z.string().optional(),
  layout: z.string().optional(),
  layoutWarningDismissed: z.boolean().optional(),
  imageUrl: z.string().optional(),
  imageLoading: z.boolean().optional(),
  imagePrompt: z.string().optional(),
  excalidrawData: z.string().optional(),
  transition: z
    .enum(["instant", "none", "fade", "slide", "zoom"])
    .optional()
    .describe("Transition used when entering this slide"),
  animations: z
    .array(SlideAnimationSchema)
    .optional()
    .describe(
      "Complete ordered on-click reveal list. Include every intended target in order; unlisted elements remain visible. Use elementPath from the final HTML and 0-based indexes.",
    ),
  skipped: z
    .boolean()
    .optional()
    .describe(
      "Exclude this slide from Present/Presenter playback without deleting it.",
    ),
});

const PatchSlideOp = z
  .object({
    op: z.literal("patch-slide"),
    slideId: z.string(),
    fields: SlideFieldsSchema,
    baseContentHash: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Content hash from the exact get-deck source. Required for styleOnly and for each slide in an agent's multi-slide content batch.",
      ),
    styleOnly: z
      .boolean()
      .optional()
      .describe(
        "Enforce a CSS-only edit that preserves text, markup, element order, and protected layout CSS. Requires fields.content and baseContentHash.",
      ),
    preserveSource: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Keep source-imported images and factual copy (default true). Set false only for an explicit rewrite.",
      ),
  })
  .superRefine((operation, context) => {
    if (!operation.styleOnly) return;
    if (operation.fields.content === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields", "content"],
        message: "styleOnly requires a complete slide content value",
      });
    }
    if (operation.baseContentHash === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseContentHash"],
        message: "styleOnly requires the source slide contentHash",
      });
    }
    const unsupportedFields = Object.keys(operation.fields).filter(
      (field) => field !== "content",
    );
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "styleOnly accepts only fields.content",
      });
    }
  });

const DeleteSlideOp = z.object({
  op: z.literal("delete-slide"),
  slideId: z.string(),
  allowEmpty: z
    .boolean()
    .optional()
    .describe("Keep the deck empty when deleting its last slide."),
});

const ReorderSlidesOp = z
  .object({
    op: z.literal("reorder-slides"),
    orderedIds: z
      .array(z.string())
      .describe(
        "Desired slide ID order; concurrent additions remain appended.",
      ),
  })
  .superRefine(({ orderedIds }, context) => {
    const duplicateId = firstDuplicate(orderedIds);
    if (duplicateId === undefined) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orderedIds"],
      message: `Slide ID ${duplicateId} appears more than once`,
    });
  });

const AddSlideOp = z.object({
  op: z.literal("add-slide"),
  slideId: z.string(),
  afterSlideId: z.string().optional(), // insert after this slide; append if absent
  fields: z
    .object({
      content: z.string(),
      notes: z.string().optional(),
      layout: z.string().optional(),
      background: z.string().optional(),
      imageUrl: z.string().optional(),
      imagePrompt: z.string().optional(),
      excalidrawData: z.string().optional(),
      transition: z
        .enum(["instant", "none", "fade", "slide", "zoom"])
        .optional(),
      animations: z.array(z.unknown()).optional(),
      splitByParagraph: z.boolean().optional(),
      skipped: z.boolean().optional(),
    })
    .passthrough(),
});

const PatchDeckFieldsOp = z.object({
  op: z.literal("patch-deck-fields"),
  fields: z
    .object({
      title: z.string().optional(),
      designSystemId: z.string().nullable().optional(),
      tweaks: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
      aspectRatio: z.enum(ASPECT_RATIO_VALUES).optional(),
      shareToken: z.string().optional(),
      visibility: z.enum(["private", "org", "public"]).optional(),
      starred: z.boolean().optional(),
      generationContext: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
});

export const OperationSchema = z.discriminatedUnion("op", [
  PatchSlideOp,
  DeleteSlideOp,
  ReorderSlidesOp,
  AddSlideOp,
  PatchDeckFieldsOp,
]);

export type Operation = z.infer<typeof OperationSchema>;

function persistedTargetSlideCount(deck: unknown): number | null {
  if (!deck || typeof deck !== "object" || Array.isArray(deck)) return null;
  const generationContext = (deck as Record<string, unknown>).generationContext;
  if (
    !generationContext ||
    typeof generationContext !== "object" ||
    Array.isArray(generationContext)
  ) {
    return null;
  }
  const targetSlideCount = (generationContext as Record<string, unknown>)
    .targetSlideCount;
  return typeof targetSlideCount === "number" &&
    Number.isInteger(targetSlideCount) &&
    targetSlideCount > 0
    ? targetSlideCount
    : null;
}

function projectedSlideCount(
  slides: unknown[],
  operations: Operation[],
): { count: number; added: boolean } {
  const slideIds = slides.map((slide) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return undefined;
    }
    return (slide as { id?: unknown }).id;
  });
  let added = false;

  for (const operation of operations) {
    if (operation.op === "add-slide") {
      if (slideIds.some((id) => id === operation.slideId)) continue;
      slideIds.push(operation.slideId);
      added = true;
      continue;
    }
    if (operation.op !== "delete-slide") continue;

    const index = slideIds.findIndex((id) => id === operation.slideId);
    if (index !== -1) slideIds.splice(index, 1);
    if (slideIds.length === 0 && !operation.allowEmpty) {
      slideIds.push(undefined);
    }
  }

  return { count: slideIds.length, added };
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

export function assertSourceImportSlidesCovered(
  metadata: SourceImportMetadata | null,
  operations: Operation[],
  requireAllSourceSlides: boolean,
): void {
  if (!metadata || !requireAllSourceSlides) return;

  const sourceSlideIds =
    Array.isArray(metadata.slideIds) && metadata.slideIds.length > 0
      ? metadata.slideIds
      : metadata.slides.map((slide) => slide.id);
  const patchedContentSlideIds = new Set(
    operations.flatMap((operation) =>
      operation.op === "patch-slide" && operation.fields.content !== undefined
        ? [operation.slideId]
        : [],
    ),
  );
  const missingSlideIds = sourceSlideIds.filter(
    (slideId) => !patchedContentSlideIds.has(slideId),
  );
  if (missingSlideIds.length === 0) return;

  throw new Error(
    `Deck-wide source restyle requires one content patch per imported slide. Missing ${missingSlideIds.length} slide(s): ${missingSlideIds.slice(0, 12).join(", ")}${missingSlideIds.length > 12 ? ", …" : ""}. Continue with every source slide ID in one patch-deck call before verifying the changed slides with get-deck slideIds and compact=false.`,
  );
}

const AgentPatchDeckInputSchema = z.object({
  deckId: z.string().describe("Deck ID"),
  rewriteSource: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Legacy compatibility flag. When true on a source-imported deck, clear its source-import metadata; structural edits no longer require this flag.",
    ),
  requireAllSourceSlides: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "For a deck-wide source-import restyle, require one content patch for every imported slide before any write is committed.",
    ),
  operations: z
    .array(
      z.union([
        PatchSlideOp,
        DeleteSlideOp,
        ReorderSlidesOp,
        AddSlideOp,
        z.object({
          op: z.literal("patch-deck-fields"),
          fields: z.object({
            title: z
              .string()
              .optional()
              .describe("The concise, specific title to apply to the deck"),
            starred: z
              .boolean()
              .optional()
              .describe("Whether the deck should be starred"),
          }),
        }),
      ]),
    )
    .min(1)
    .describe(
      "Use patch-slide for content or slide fields, add-slide to append a slide, delete-slide to remove a slide, reorder-slides to set slide order, and patch-deck-fields for top-level deck fields such as title or starred. For multi-slide content changes, read each target's full source and contentHash, then include baseContentHash on every patch-slide. Set styleOnly=true only for CSS-only content changes that preserve text, markup, element order, and protected layout CSS. For a deck-wide source restyle, include one patch-slide operation with content for every existing source slide.",
    ),
});

const CreativeContextReuseLabelSchema = z.object({
  itemId: z.string().min(1).optional(),
  itemVersionId: z.string().min(1).optional(),
  kind: z.string().min(1),
  label: z.string().min(1),
  dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
  elementId: z.string().min(1).optional(),
  influence: z
    .enum(["reused", "adapted", "reference-conditioned", "generated"])
    .optional(),
});

function storedCreativeContext(value: unknown): {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.contextMode !== "off" &&
    record.contextMode !== "auto" &&
    record.contextMode !== "pinned"
  ) {
    return null;
  }
  return {
    contextMode: record.contextMode,
    contextPackId:
      typeof record.contextPackId === "string" ? record.contextPackId : null,
    reuseLabels: Array.isArray(record.reuseLabels)
      ? (record.reuseLabels as CreativeContextReuseLabel[])
      : [],
  };
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyOperation(
  deck: any,
  op: Operation,
  options?: {
    clearLayoutWarningDismissal?: boolean;
    sourceContentHashes?: ReadonlyMap<string, string>;
    styleOnlyBaseline?: string;
  },
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides: any[] = Array.isArray(deck.slides) ? deck.slides : [];

  switch (op.op) {
    case "patch-slide": {
      const idx = slides.findIndex((s: { id: string }) => s.id === op.slideId);
      if (idx === -1) return false;
      const slide = slides[idx];
      const fields = op.fields;
      if (op.baseContentHash !== undefined) {
        const sourceContentHash =
          options?.sourceContentHashes?.get(op.slideId) ??
          hashSlideContent(String(slide.content ?? ""));
        if (sourceContentHash !== op.baseContentHash) {
          fail(
            "Slide content changed since it was read. Call get-deck with this slideId again and rebase the patch.",
            { errorCode: "slide_content_stale", statusCode: 409 },
          );
        }
      }
      const previousFitFields = {
        content: slide.content,
        layout: slide.layout,
        excalidrawData: slide.excalidrawData,
      };
      if (fields.content !== undefined) {
        const previousContent =
          typeof slide.content === "string" ? slide.content : undefined;
        const nextContent = op.styleOnly
          ? fields.content
          : normalizeSlidePaddingForWrite(previousContent, fields.content);
        if (op.styleOnly) {
          assertStyleOnlyEdit(
            options?.styleOnlyBaseline ?? String(slide.content ?? ""),
            nextContent,
          );
        }
        assertNoRenderArtifacts(previousContent ?? "", nextContent, op.slideId);
        slide.content = nextContent;
      }
      if (fields.notes !== undefined) slide.notes = fields.notes;
      if (fields.background !== undefined) slide.background = fields.background;
      if (fields.layout !== undefined) slide.layout = fields.layout;
      if (fields.imageUrl !== undefined) slide.imageUrl = fields.imageUrl;
      if (fields.imageLoading !== undefined)
        slide.imageLoading = fields.imageLoading;
      if (fields.imagePrompt !== undefined)
        slide.imagePrompt = fields.imagePrompt;
      if (fields.excalidrawData !== undefined)
        slide.excalidrawData = fields.excalidrawData;
      if (fields.transition !== undefined) slide.transition = fields.transition;
      if (fields.animations !== undefined) slide.animations = fields.animations;
      if (fields.skipped !== undefined) slide.skipped = fields.skipped;
      const layoutChanged = slideFitRenderFieldsChanged(
        previousFitFields,
        slide,
      );
      if (fields.layoutWarningDismissed !== undefined) {
        slide.layoutWarningDismissed = fields.layoutWarningDismissed;
      }
      if (layoutChanged) {
        slide.layoutFitRevision = createLayoutFitRevision();
        if (
          options?.clearLayoutWarningDismissal &&
          fields.layoutWarningDismissed === undefined
        ) {
          delete slide.layoutWarningDismissed;
        }
      }
      return false;
    }

    case "delete-slide": {
      const idx = slides.findIndex((s: { id: string }) => s.id === op.slideId);
      const removed = idx !== -1;
      if (removed) slides.splice(idx, 1);
      const addedFallback = slides.length === 0 && !op.allowEmpty;
      if (addedFallback) {
        slides.push({
          id: `slide-${Date.now()}-fallback`,
          content: `<div class="fmd-slide" style="box-sizing: border-box; width: 100%; height: 100%; padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;"><div style="font-size: 28px; font-weight: 600; color: hsl(var(--muted-foreground) / 0.4);">Double-click to edit</div></div>`,
          notes: "",
          layout: "blank",
        });
      }
      if (!removed && !addedFallback) return false;
      deck.slides = slides;
      delete deck.sourceImport;
      return true;
    }

    case "reorder-slides": {
      const { orderedIds } = op;
      const duplicateId = firstDuplicate(orderedIds);
      if (duplicateId !== undefined) {
        throw new Error(
          `Cannot reorder slides with duplicate ID ${duplicateId}`,
        );
      }
      const byId = new Map(slides.map((s: { id: string }) => [s.id, s]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reordered: any[] = orderedIds
        .map((id) => byId.get(id))
        .filter(Boolean);
      const orderedSet = new Set(orderedIds);
      for (const s of slides) {
        if (!orderedSet.has(s.id)) reordered.push(s);
      }
      if (
        reordered.length === slides.length &&
        reordered.every((slide, index) => slide?.id === slides[index]?.id)
      ) {
        return false;
      }
      deck.slides = reordered;
      delete deck.sourceImport;
      return true;
    }

    case "add-slide": {
      const { slideId, afterSlideId, fields } = op;
      if (slides.some((s: { id: string }) => s.id === slideId)) return false;
      if (typeof fields.content === "string") {
        assertNoRenderArtifactsInNewSlide(
          fields.content,
          slideId,
          slides.map((s: { content?: unknown }) => String(s.content ?? "")),
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newSlide: any = {
        ...fields,
        id: slideId,
        content:
          typeof fields.content === "string"
            ? normalizeSlidePadding(fields.content)
            : "",
        layoutFitRevision: createLayoutFitRevision(),
        notes: fields.notes ?? "",
        layout: fields.layout ?? "content",
      };
      delete newSlide.imageLoading;
      const insertAfterIdx = afterSlideId
        ? slides.findIndex((s: { id: string }) => s.id === afterSlideId)
        : -1;
      if (insertAfterIdx !== -1) {
        slides.splice(insertAfterIdx + 1, 0, newSlide);
      } else {
        slides.push(newSlide);
      }
      deck.slides = slides;
      delete deck.sourceImport;
      return true;
    }

    case "patch-deck-fields": {
      const { fields } = op;
      if (fields.title !== undefined) {
        const repairedTitle = repairGeneratedDeckTitle(
          fields.title,
          slides[0]?.content,
          deck.title,
        );
        if (repairedTitle) {
          deck.title = repairedTitle;
        } else {
          assertHumanReadableDeckTitle(fields.title);
          deck.title = fields.title;
        }
      }
      if ("designSystemId" in fields)
        deck.designSystemId = fields.designSystemId;
      if (fields.tweaks !== undefined) deck.tweaks = fields.tweaks;
      if (fields.aspectRatio !== undefined)
        deck.aspectRatio = fields.aspectRatio;
      if (fields.shareToken !== undefined) deck.shareToken = fields.shareToken;
      if (fields.visibility !== undefined) deck.visibility = fields.visibility;
      if (fields.starred !== undefined) deck.starred = fields.starred;
      if (fields.generationContext !== undefined)
        deck.generationContext = fields.generationContext;
      return false;
    }
  }
}

export function slideSignatures(deck: any): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const slide of Array.isArray(deck?.slides) ? deck.slides : []) {
    if (typeof slide?.id === "string") {
      const {
        layoutFitRevision: _layoutFitRevision,
        layoutWarningDismissed: _layoutWarningDismissed,
        ...material
      } = slide;
      signatures.set(slide.id, deckVersionContentSignature(material));
    }
  }
  return signatures;
}

export function slideContents(deck: any): Map<string, string> {
  const contents = new Map<string, string>();
  for (const slide of Array.isArray(deck?.slides) ? deck.slides : []) {
    if (typeof slide?.id === "string") {
      contents.set(
        slide.id,
        typeof slide.content === "string" ? slide.content : "",
      );
    }
  }
  return contents;
}

export function clearOmittedAnimationsForAgentContentPatches(
  deck: any,
  operations: readonly Operation[],
  options?: {
    sourceImport?: SourceImportMetadata | null;
    contentChangedSlideIds?: ReadonlySet<string>;
  },
): void {
  const explicitAnimationSlideIds = new Set(
    operations.flatMap((operation) =>
      operation.op === "patch-slide" &&
      operation.fields.animations !== undefined
        ? [operation.slideId]
        : [],
    ),
  );
  const sourceSlideIds = new Set(
    options?.sourceImport?.slideIds ??
      options?.sourceImport?.slides.map((slide) => slide.id) ??
      [],
  );
  const slideIds = new Set(
    operations.flatMap((operation) =>
      operation.op === "patch-slide" &&
      operation.fields.content !== undefined &&
      !operation.styleOnly &&
      operation.fields.animations === undefined &&
      !explicitAnimationSlideIds.has(operation.slideId) &&
      (options?.contentChangedSlideIds?.has(operation.slideId) ?? true) &&
      (operation.preserveSource === false ||
        !sourceSlideIds.has(operation.slideId))
        ? [operation.slideId]
        : [],
    ),
  );
  if (!slideIds.size) return;

  for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
    if (slideIds.has(slide?.id) && Array.isArray(slide.animations)) {
      delete slide.animations;
    }
  }
}

export function assertPatchedSlideAnimationsResolve(
  deck: any,
  operations: readonly Operation[],
  options?: {
    requireElementPaths?: boolean;
    contentChangedSlideIds?: ReadonlySet<string>;
  },
): void {
  const slideIdsToValidate = new Set(
    operations.flatMap((operation) => {
      if (operation.op !== "patch-slide" && operation.op !== "add-slide") {
        return [];
      }
      const contentChanged =
        (operation.op !== "patch-slide" || !operation.styleOnly) &&
        operation.fields.content !== undefined &&
        (options?.contentChangedSlideIds?.has(operation.slideId) ?? true);
      return operation.fields.animations !== undefined || contentChanged
        ? [operation.slideId]
        : [];
    }),
  );
  if (slideIdsToValidate.size === 0) return;

  const slides: any[] = Array.isArray(deck.slides) ? deck.slides : [];
  for (const slideId of slideIdsToValidate) {
    const slide = slides.find((candidate) => candidate?.id === slideId);
    if (!slide || !Array.isArray(slide.animations) || !slide.animations.length)
      continue;

    assertSlideAnimationsResolve({
      slideId,
      content: typeof slide.content === "string" ? slide.content : "",
      animations: slide.animations,
      requireElementPaths: options?.requireElementPaths,
    });
  }
}

export function resolveDeckColumnUpdates(
  current: { title: string; designSystemId: string | null },
  operations: Operation[],
  resolvedTitle?: string,
): { title: string; designSystemId: string | null } {
  const fieldOps = operations
    .filter(
      (op): op is z.infer<typeof PatchDeckFieldsOp> =>
        op.op === "patch-deck-fields",
    )
    .reverse();
  const titleOp = fieldOps.find((op) => typeof op.fields.title === "string");
  const dsOp = fieldOps.find((op) => "designSystemId" in op.fields);
  return {
    title: resolvedTitle ?? titleOp?.fields.title ?? current.title,
    designSystemId: dsOp
      ? (dsOp.fields.designSystemId ?? null)
      : current.designSystemId,
  };
}

export function isAgentPatchCaller(caller: string | undefined): boolean {
  return (
    caller === "tool" ||
    caller === "mcp" ||
    caller === "a2a" ||
    caller === "webmcp"
  );
}


export default defineAction({
  title: "Patch Slides deck",
  description:
    "Granular deck patch used by the browser editor for concurrent-safe writes. Before a multi-slide content patch, read all target source with one get-deck compact=false call so every patch has its exact contentHash; use compact=true only for orientation when full source is not needed. Call get-design-system once for the full linked context. For new deck generation, use add-slide once per newly generated slide so its per-slide Creative Context provenance is preserved; reserve patch-deck for existing-slide edits, deck fields, ordering, or intentional source-preserving batches. Never issue parallel writes to the same deck. " +
    "Each operation touches only the target slide or field — concurrent writers " +
    "on different slides never overwrite each other's work. For a deck-wide " +
    "source restyle, set requireAllSourceSlides=true and send one patch-slide " +
    "operation with content for every imported slide in one call; the action " +
    "rejects partial coverage. For animations, inspect the final slide HTML, " +
    "then patch content and the complete ordered animations list together; " +
    "use delete-slide to remove a slide and reorder-slides to set the order; " +
    "validate every 0-based elementPath and do not invent one-based indexes. " +
    "Then call get-deck once with slideIds and compact=false to verify the " +
    "persisted full source, notes, IDs, and animation metadata before reporting " +
    "success. Only the slide " +
    "IDs in updatedSlideIds actually changed: a slide echoed back in " +
    "unchangedSlideIds came out identical to the stored slide, was not " +
    "written, and must never be described as edited. A batch in which every " +
    "patched slide is unchanged " +
    "is rejected, so re-read those slides and send content that differs " +
    "instead of retrying the same HTML. Content writes " +
    "return immediately with contentHash plus layoutFitRevision-keyed layoutFit.status=pending; call " +
    "get-layout-overflows later when you need the browser's fit result. " +
    "Agents can add, delete, and reorder slides through operations in this action. " +
    "Structural edits to an imported deck clear its source-import metadata automatically; the legacy rewriteSource flag is not required.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    rewriteSource: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Legacy compatibility flag. When true on a source-imported deck, clear its source-import metadata; structural edits no longer require this flag.",
      ),
    requireAllSourceSlides: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "For a deck-wide source-import restyle, require one content patch for every imported slide before any write is committed.",
      ),
    operations: z
      .array(OperationSchema)
      .min(1)
      .describe("Ordered list of granular operations to apply"),
    creativeContext: z
      .object({
        contextPackId: z.string().optional(),
        contextModeOverride: z.literal("off").optional(),
        reuseLabels: z
          .array(CreativeContextReuseLabelSchema)
          .optional()
          .default([]),
      })
      .optional()
      .describe(
        "Optional exact Creative Context provenance for context-backed slide patch operations.",
      ),
  }),
  agentInputSchema: AgentPatchDeckInputSchema,
  http: { method: "POST" },
  run: async (
    {
      deckId,
      operations,
      requireAllSourceSlides,
      rewriteSource,
      creativeContext,
    },
    ctx,
  ) => {
    await assertAccess("deck", deckId, "editor");
    const isAgentCaller = isAgentPatchCaller(ctx?.caller);

    return withDeckLock(deckId, async () => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);

      if (!row)
        fail(`Deck ${deckId} not found`, {
          errorCode: "deck_not_found",
          statusCode: 404,
        });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deck: any = JSON.parse(row.data);
      const existingContext = storedCreativeContext(deck.creativeContext);
      const previousDeckFitFields = {
        aspectRatio: deck.aspectRatio,
        designSystemId: deck.designSystemId,
      };

      const currentSlides = Array.isArray(deck.slides) ? deck.slides : [];
      const sourceContentHashes = new Map<string, string>(
        currentSlides.map(
          (slide: { id: string; content?: unknown }) =>
            [slide.id, hashSlideContent(String(slide.content ?? ""))] as const,
        ),
      );
      const existingSlideIds = new Set(
        currentSlides.map((slide: { id?: unknown }) => slide.id),
      );
      const missingSlideIds = operations
        .filter((operation) => operation.op === "patch-slide")
        .map((operation) => operation.slideId)
        .filter((slideId) => !existingSlideIds.has(slideId));
      if (missingSlideIds.length > 0) {
        throw new Error(
          `Cannot patch missing slide(s): ${[...new Set(missingSlideIds)].join(", ")}`,
        );
      }

      const contentPatchOperations = operations.filter(
        (operation): operation is Extract<Operation, { op: "patch-slide" }> =>
          operation.op === "patch-slide" &&
          operation.fields.content !== undefined,
      );
      const contentSlideIds = new Set(
        contentPatchOperations.map((operation) => operation.slideId),
      );
      if (
        isAgentCaller &&
        contentSlideIds.size > 1 &&
        contentPatchOperations.some(
          (operation) => operation.baseContentHash === undefined,
        )
      ) {
        fail(
          "A multi-slide content patch requires the contentHash read for every slide. Read the target slides with get-deck, then retry the batch.",
          {
            errorCode: "slide_content_hash_required",
            statusCode: 400,
          },
        );
      }

      const sourceImport = sourceImportForDeck(deck.sourceImport);
      const sourceRewriteRequested =
        isAgentCaller && rewriteSource && sourceImport !== null;
      if (isAgentCaller && rewriteSource && sourceImport === null) {
        throw new Error(
          "rewriteSource=true only applies to a source-preserving deck; omit it for a regular deck",
        );
      }

      const targetSlideCount = persistedTargetSlideCount(deck);
      const projected = projectedSlideCount(currentSlides, operations);
      if (
        isAgentCaller &&
        targetSlideCount !== null &&
        projected.added &&
        projected.count > targetSlideCount
      ) {
        throw new AgentActionStopError(
          `Cannot add slides: this deck would have ${projected.count} slides, exceeding its requested target of ${targetSlideCount}. Re-read the deck and stop adding slides unless the user explicitly changes the target.`,
          {
            errorCode: "target_slide_count_reached",
            details: {
              deckId,
              currentSlideCount: currentSlides.length,
              projectedSlideCount: projected.count,
              targetSlideCount,
            },
          },
        );
      }

      const layoutFitSlideIds = new Set<string>();
      const deletedSlideIds = new Set<string>();
      const signaturesBeforeOperations = slideSignatures(deck);
      const contentsBeforeOperations = slideContents(deck);
      const fitFieldsBeforeOperations = new Map<
        string,
        { content: unknown; layout: unknown; excalidrawData: unknown }
      >(
        (Array.isArray(deck.slides) ? deck.slides : [])
          .filter((slide: { id?: unknown }) => typeof slide.id === "string")
          .map(
            (slide: Record<string, unknown>) =>
              [
                slide.id as string,
                {
                  content: slide.content,
                  layout: slide.layout,
                  excalidrawData: slide.excalidrawData,
                },
              ] as const,
          ),
      );
      const derivedBeforeOperations = new Map<
        string,
        { layoutFitRevision: unknown; layoutWarningDismissed: unknown }
      >(
        (Array.isArray(deck.slides) ? deck.slides : [])
          .filter((slide: { id?: unknown }) => typeof slide.id === "string")
          .map(
            (slide: Record<string, unknown>) =>
              [
                slide.id as string,
                {
                  layoutFitRevision: slide.layoutFitRevision,
                  layoutWarningDismissed: slide.layoutWarningDismissed,
                },
              ] as const,
          ),
      );
      let structuralOperationApplied = false;
      for (const op of operations) {
        const existedBeforeDelete =
          op.op === "delete-slide" &&
          (deck.slides as Array<{ id?: string }>).some(
            (slide) => slide.id === op.slideId,
          );
        let operationChangedStructure: boolean;
        try {
          operationChangedStructure = applyOperation(deck, op, {
            clearLayoutWarningDismissal: isAgentCaller,
            sourceContentHashes,
          });
        } catch (error) {
          if (
            op.op !== "patch-slide" ||
            !op.styleOnly ||
            !isActionContractError(error) ||
            ![
              "style_only_slide_structure_changed",
              "style_only_slide_layout_changed",
            ].includes(error.errorCode)
          ) {
            throw error;
          }
          const slide = (
            deck.slides as Array<{ id: string; content?: unknown }>
          ).find((entry) => entry.id === op.slideId);
          const styleOnlyBaseline = await formatSlideHtml(
            String(slide?.content ?? ""),
          );
          operationChangedStructure = applyOperation(deck, op, {
            clearLayoutWarningDismissal: isAgentCaller,
            sourceContentHashes,
            styleOnlyBaseline,
          });
        }
        structuralOperationApplied ||= operationChangedStructure;
        if (
          existedBeforeDelete &&
          !(deck.slides as Array<{ id?: string }>).some(
            (slide) => slide.id === op.slideId,
          )
        ) {
          deletedSlideIds.add(op.slideId);
        }
      }
      const sourceImportCleared =
        sourceImport !== null &&
        (sourceRewriteRequested || structuralOperationApplied);
      if (isAgentCaller) {
        assertSourceImportSlidesCovered(
          sourceImport,
          operations,
          sourceImportCleared ? false : requireAllSourceSlides,
        );
        for (const op of operations) {
          if (
            sourceImportCleared ||
            op.op !== "patch-slide" ||
            (op.fields.content === undefined && op.fields.notes === undefined)
          ) {
            continue;
          }
          assertSourceSlidePreserved({
            metadata: sourceImport,
            slideId: op.slideId,
            nextContent:
              op.fields.content === undefined
                ? undefined
                : op.styleOnly
                  ? op.fields.content
                  : normalizeSlidePaddingForWrite(
                      contentsBeforeOperations.get(op.slideId),
                      op.fields.content,
                    ),
            nextNotes: op.fields.notes,
            preserveSource: op.preserveSource,
          });
        }
      }
      const signaturesAfterOperations = slideSignatures(deck);
      const contentsAfterOperations = slideContents(deck);
      const requestedSlideIds = [
        ...new Set(
          operations.flatMap((operation) =>
            operation.op === "patch-slide" || operation.op === "add-slide"
              ? [operation.slideId]
              : [],
          ),
        ),
      ].filter((slideId) => signaturesAfterOperations.has(slideId));
      const changedSlideIds = new Set(
        requestedSlideIds.filter(
          (slideId) =>
            signaturesBeforeOperations.get(slideId) !==
            signaturesAfterOperations.get(slideId),
        ),
      );
      const contentChangedSlideIds = new Set(
        requestedSlideIds.filter(
          (slideId) =>
            contentsBeforeOperations.get(slideId) !==
            contentsAfterOperations.get(slideId),
        ),
      );
      for (const slideId of requestedSlideIds) {
        if (deletedSlideIds.has(slideId)) changedSlideIds.add(slideId);
      }

      const explicitWarningSlideIds = new Set(
        operations.flatMap((operation) =>
          (operation.op === "patch-slide" || operation.op === "add-slide") &&
          (operation.fields as { layoutWarningDismissed?: unknown })
            .layoutWarningDismissed !== undefined
            ? [operation.slideId]
            : [],
        ),
      );
      for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
        if (typeof slide.id !== "string") continue;
        if (!explicitWarningSlideIds.has(slide.id)) continue;
        if (
          slide.layoutWarningDismissed !==
          derivedBeforeOperations.get(slide.id)?.layoutWarningDismissed
        ) {
          changedSlideIds.add(slide.id);
        }
      }

      for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
        if (typeof slide.id !== "string") continue;
        const previousFitFields = fitFieldsBeforeOperations.get(slide.id);
        if (!previousFitFields) {
          layoutFitSlideIds.add(slide.id);
          continue;
        }
        if (slideFitRenderFieldsChanged(previousFitFields, slide)) {
          layoutFitSlideIds.add(slide.id);
          continue;
        }
        layoutFitSlideIds.delete(slide.id);
        const derived = derivedBeforeOperations.get(slide.id);
        if (!derived) continue;
        if (derived.layoutFitRevision === undefined) {
          delete slide.layoutFitRevision;
        } else {
          slide.layoutFitRevision = derived.layoutFitRevision;
        }
        if (!explicitWarningSlideIds.has(slide.id)) {
          if (derived.layoutWarningDismissed === undefined) {
            delete slide.layoutWarningDismissed;
          } else {
            slide.layoutWarningDismissed = derived.layoutWarningDismissed;
          }
        }
      }

      const unchangedSlideIds = requestedSlideIds.filter(
        (slideId) => !changedSlideIds.has(slideId),
      );

      if (deckFitRenderFieldsChanged(previousDeckFitFields, deck)) {
        for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
          if (typeof slide.id !== "string") continue;
          if (!layoutFitSlideIds.has(slide.id)) {
            slide.layoutFitRevision = createLayoutFitRevision();
          }
          if (isAgentCaller) delete slide.layoutWarningDismissed;
          layoutFitSlideIds.add(slide.id);
        }
      }

      if (sourceImportCleared) delete deck.sourceImport;
      if (isAgentCaller) {
        clearOmittedAnimationsForAgentContentPatches(deck, operations, {
          sourceImport: sourceImportCleared ? null : sourceImport,
          contentChangedSlideIds,
        });
      }
      assertPatchedSlideAnimationsResolve(deck, operations, {
        requireElementPaths: isAgentCaller,
        contentChangedSlideIds,
      });

      const { title: sqlTitle, designSystemId: sqlDesignSystemId } =
        resolveDeckColumnUpdates(
          { title: row.title, designSystemId: row.designSystemId },
          operations,
          operations.some(
            (operation) =>
              operation.op === "patch-deck-fields" &&
              operation.fields.title !== undefined,
          ) && typeof deck.title === "string"
            ? deck.title
            : undefined,
        );

      let generationRecord:
        | {
            contextMode: "off" | "auto" | "pinned";
            contextPackId: string | null;
            reuseLabels: CreativeContextReuseLabel[];
            elementProvenance: Array<{
              elementId: string;
              influence:
                | "reused"
                | "adapted"
                | "reference-conditioned"
                | "generated";
              itemId?: string;
              itemVersionId?: string;
              label?: string;
            }>;
          }
        | undefined;
      if (creativeContext) {
        const affectedSlideIds = [
          ...new Set(
            operations.flatMap((operation) =>
              operation.op === "patch-slide" || operation.op === "add-slide"
                ? [operation.slideId]
                : [],
            ),
          ),
        ];
        if (!affectedSlideIds.length) {
          throw new Error(
            "Creative Context provenance requires a patch-slide or add-slide operation",
          );
        }
        if (
          existingContext &&
          creativeContext.contextPackId !== undefined &&
          creativeContext.contextPackId !== existingContext.contextPackId
        ) {
          throw new Error(
            "The deck patch must use the deck's existing creative-context pack",
          );
        }
        const effectivePackId =
          creativeContext.contextPackId ?? existingContext?.contextPackId;
        const requestedLabels = affectedSlideIds.flatMap((slideId) => {
          const labels = creativeContext.reuseLabels.filter(
            (label) => !label.elementId || label.elementId === slideId,
          );
          return labels.length
            ? labels.map((label) => ({ ...label, elementId: slideId }))
            : [
                {
                  kind: "slide",
                  label: "Net-new deck patch",
                  dataRole: "untrusted-reference" as const,
                  elementId: slideId,
                  influence: "generated" as const,
                },
              ];
        });
        const validated = await validateGenerationCreativeContext({
          contextPackId: effectivePackId,
          contextPackSource:
            creativeContext.contextPackId === undefined
              ? "inherited"
              : "explicit",
          contextModeOverride: creativeContext.contextModeOverride,
          reuseLabels: requestedLabels,
          reuseLabelsSource: creativeContext.reuseLabels.length
            ? "explicit"
            : "inherited",
        });
        const contextMode =
          validated.contextMode === "off"
            ? "off"
            : (existingContext?.contextMode ?? validated.contextMode);
        const previous =
          contextMode === "off"
            ? null
            : await getGenerationCreativeContext({
                appId: "slides",
                artifactType: "deck",
                artifactId: deckId,
              });
        const nextElementProvenance = validated.reuseLabels.map((label) => ({
          elementId: label.elementId!,
          influence: label.influence ?? ("reference-conditioned" as const),
          ...(label.itemId ? { itemId: label.itemId } : {}),
          ...(label.itemVersionId
            ? { itemVersionId: label.itemVersionId }
            : {}),
          label: label.label,
        }));
        const mergedReuseLabels = mergeCreativeContextReuseLabels(
          existingContext?.reuseLabels ?? [],
          validated.reuseLabels,
        );
        generationRecord = {
          contextMode,
          contextPackId: validated.contextPackId,
          reuseLabels:
            contextMode === "off" ? validated.reuseLabels : mergedReuseLabels,
          elementProvenance:
            contextMode === "off"
              ? nextElementProvenance
              : replaceCreativeContextElementProvenance(
                  previous?.elementProvenance ?? [],
                  nextElementProvenance,
                ),
        };
        if (!(contextMode === "off" && existingContext)) {
          deck.creativeContext = {
            contextMode,
            contextPackId: validated.contextPackId,
            reuseLabels: mergedReuseLabels,
          };
        }
      }

      const hasNonSlidePatchWork =
        operations.some((operation) => operation.op !== "patch-slide") ||
        sourceImportCleared ||
        generationRecord !== undefined;
      if (
        isAgentCaller &&
        !hasNonSlidePatchWork &&
        requestedSlideIds.length > 0 &&
        changedSlideIds.size === 0
      ) {
        throw new Error(
          `Nothing was written: every patched slide (${requestedSlideIds.join(", ")}) is identical to the deck's current content, so the deck is unchanged. Do not report these slides as edited. Re-read them with get-deck and send content that actually differs.`,
        );
      }

      const meaningfulChange =
        deckVersionContentSignature(row.data) !==
          deckVersionContentSignature(deck) ||
        row.title !== sqlTitle ||
        row.designSystemId !== sqlDesignSystemId ||
        generationRecord !== undefined;
      if (!meaningfulChange) {
        if (isAgentCaller) {
          throw new Error(
            "Nothing was written: the requested deck patch is identical to the current deck. Re-read with get-deck before retrying.",
          );
        }
        return {
          ok: true,
          deckId,
          updatedAt: row.updatedAt,
          applied: false,
          updatedSlideIds: [],
          deletedSlideIds: [],
        };
      }

      const now = nextDeckRevision(row.updatedAt);
      deck.updatedAt = now;

      await db.transaction(async (tx: any) => {
        if (isAgentCaller && row.ownerEmail) {
          await createDeckVersionSnapshot(
            {
              id: row.id,
              title: row.title ?? "Untitled",
              data: row.data ?? "",
              ownerEmail: row.ownerEmail,
            },
            {
              force: true,
              chatContext: deckVersionChatContextFromAction(ctx),
              label: "Before deck patch",
              db: tx,
            },
          );
        }
        const updateResult = await tx
          .update(schema.decks)
          .set({
            title: sqlTitle,
            data: JSON.stringify(deck),
            designSystemId: sqlDesignSystemId,
            updatedAt: now,
          })
          .where(deckRevisionWhere(schema.decks, deckId, row.updatedAt));
        assertDeckWriteApplied(updateResult, deckId, "deck patch");
        if (generationRecord) {
          await recordGenerationCreativeContext(
            {
              appId: "slides",
              artifactType: "deck",
              artifactId: deckId,
              ...generationRecord,
            },
            { db: tx },
          );
        }
      });

      const updatedSlideIds = requestedSlideIds.filter((slideId) =>
        changedSlideIds.has(slideId),
      );
      const hasMixedStructuralOperation = operations.some(
        (operation) =>
          operation.op === "delete-slide" ||
          operation.op === "reorder-slides" ||
          operation.op === "patch-deck-fields",
      );
      const agentChangeId = deckVersionChangeGroupFromAction(ctx);
      if (updatedSlideIds.length === 1 && !hasMixedStructuralOperation) {
        await notifyClients(deckId, {
          slideId: updatedSlideIds[0],
          actor: isAgentCaller ? "agent" : "human",
          ...(agentChangeId ? { agentChangeId } : {}),
        });
      } else if (agentChangeId) {
        await notifyClients(deckId, { agentChangeId });
      } else {
        await notifyClients(deckId);
      }

      const layoutFitSlideIdList = [...layoutFitSlideIds].filter((slideId) =>
        signaturesAfterOperations.has(slideId),
      );
      const finalSlides: Array<{
        id?: unknown;
        content?: unknown;
        layoutFitRevision?: unknown;
      }> = Array.isArray(deck.slides) ? deck.slides : [];
      const base = {
        ok: true,
        deckId,
        updatedAt: now,
        updatedSlideIds,
        deletedSlideIds: [...deletedSlideIds].filter(
          (slideId) =>
            signaturesBeforeOperations.has(slideId) &&
            !signaturesAfterOperations.has(slideId),
        ),
        ...(unchangedSlideIds.length
          ? {
              unchangedSlideIds,
              partial: true,
              message: `Applied, but ${unchangedSlideIds.join(", ")} came out identical to the stored slide and were not written — do not report those slides as edited.`,
            }
          : {}),
        ...(sourceRewriteRequested ? { sourceRewritten: true } : {}),
        ...(sourceImportCleared && !sourceRewriteRequested
          ? { sourceImportCleared: true }
          : {}),
        ...(layoutFitSlideIdList.length
          ? {
              layoutFit: {
                status: "pending" as const,
                slides: layoutFitSlideIdList.map((slideId) => {
                  const slide = finalSlides.find((s) => s.id === slideId);
                  return {
                    slideId,
                    contentHash: hashSlideContent(
                      typeof slide?.content === "string" ? slide.content : "",
                    ),
                    layoutFitRevision:
                      typeof slide?.layoutFitRevision === "string"
                        ? slide.layoutFitRevision
                        : undefined,
                  };
                }),
              },
            }
          : {}),
      };
      return base;
    });
  },
});
