import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import {
  getGenerationCreativeContext,
  mergeCreativeContextReuseLabels,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type {
  CreativeContextElementProvenance,
  CreativeContextReuseLabel,
} from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePaddingForWrite } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
} from "../server/lib/deck-versions.js";
import {
  applySlideContentEdits,
  formatSlideHtml,
  type SlideContentEdit,
} from "../server/lib/slide-content-patch.js";
import {
  assertSourceSlidePreserved,
  sourceImportForDeck,
} from "../server/lib/source-import.js";
import {
  createLayoutFitRevision,
  hashSlideContent,
} from "../shared/slide-fit.js";
import {
  assertStyleOnlyEdit,
  styleOnlyEditsSuggestion,
} from "../shared/slide-style-only.js";
import { slideLabelFor, touchAgentSlidePresence } from "./_agent-presence.js";
import { getDeckUrl } from "./_app-url.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { assertNoRenderArtifacts } from "./_render-artifacts.js";
import {
  getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab,
} from "./_tab-state.js";
import { isAgentPatchCaller, withDeckLock } from "./patch-deck.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
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
    if (Boolean(label.itemId) !== Boolean(label.itemVersionId)) {
      context.addIssue({
        code: "custom",
        message: "itemId and itemVersionId must be provided together",
      });
    }
    if (
      (label.influence ?? "reference-conditioned") !== "generated" &&
      !label.itemId
    ) {
      context.addIssue({
        code: "custom",
        message: "Only generated labels may omit context item ids",
      });
    }
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

const unresolvedPlaceholderPattern =
  /__[A-Za-z][A-Za-z0-9]*(?:[_ -][A-Za-z0-9]+)*__/g;

function assertNoNewUnresolvedPlaceholders(
  previousContent: string,
  nextContent: string,
): void {
  const previous = new Set(previousContent.match(unresolvedPlaceholderPattern));
  const introduced = [
    ...new Set(nextContent.match(unresolvedPlaceholderPattern)),
  ].filter((marker) => !previous.has(marker));
  if (introduced.length > 0) {
    fail(
      `Slide edit introduced unresolved placeholder content: ${introduced.join(", ")}. Re-read the slide and preserve the existing content instead of using markers as stand-ins.`,
      { errorCode: "slide_unresolved_placeholder" },
    );
  }
}

export default defineAction({
  title: "Edit one Slides slide",
  description:
    'Edit exactly one Slides slide. For a focused edit or translation of current or selected text, use one literal replace item in edits with the exact text and expectedMatches=1; when view-screen supplies an objectId for a selected element, use that objectId instead of find to replace only that element\'s inner content. The top-level objectId and replace fields are also supported as a compact alternative to edits. When view-screen already supplies the target, do not fetch the full deck, use fullContent, or wait for layout-fit. The exception is a verified layout overflow: call get-deck with slideId to read the complete HTML and contentHash, then make one fullContent repair with baseContentHash. For a style request, get-deck\'s designSystem and deckStyle (also printed by view-screen) are authoritative; for anything beyond colors (spacing, element order, sizes) first read the representativeSlideId with a targeted get-deck and mirror its structure. Introduce colors or fonts the deck does not already use only when the user asks for them. Use targeted get-deck with slideId only if the selection text is missing, truncated, ambiguous, the literal match fails, or the edit changes markup or layout; then use ordered edits and an optional baseContentHash. Use exactly one input mode: edits, legacy find/replace or objectId/replace, or fullContent. Mixed modes are rejected and write nothing. Prefer edits over fullContent so unrelated markup is not regenerated. For style-only requests, set styleOnly=true and use edits that change only the requested CSS declarations and preserve text and layout properties; in that mode the action rejects fullContent and the top-level legacy find/replace/objectId fields, so express even a single replacement as edits: [{"find":"...","replace":"...","occurrence":1}] — occurrence, not expectedMatches, because a CSS declaration often repeats on a slide and expectedMatches rejects that outright. To copy one slide\'s look onto others ("make every slide match slide 1"), read the reference slide and each target with get-deck (slideId, compact=false), change only the .fmd-slide wrapper\'s own background declaration, and leave interior card, image, and gradient fills alone unless the user asked for those too. A deck-wide restyle is one patch-deck call covering every slide, not one update-slide per slide; reserve styleOnly update-slide for one or a few targeted slides, passing that slide\'s contentHash as baseContentHash. Never use unresolved placeholder markers as stand-ins for preserved content. Content edits clear existing click-reveal metadata; style-only CSS edits preserve it because the HTML structure remains stable. Use patch-deck with the complete animations list when a content edit intentionally changes both content and reveals. Source-imported slides preserve their original images and factual copy by default. The action returns immediately after persistence; layoutFit.status=pending means the open editor will measure the new content asynchronously, and get-layout-overflows can check the returned contentHash plus layoutFitRevision later.',
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
    find: z
      .string()
      .optional()
      .describe("Text to find (for surgical search-replace edit)"),
    objectId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Stable data-slide-object-id for replacing the selected element's inner content",
      ),
    replace: z
      .string()
      .optional()
      .describe(
        "Replacement text; pass an empty string explicitly to clear it",
      ),
    fullContent: z
      .string()
      .optional()
      .describe("Full HTML to replace entire slide content"),
    edits: z
      .array(
        z.union([
          z
            .object({
              op: z.literal("replace").optional(),
              find: z.string().optional(),
              objectId: z.string().min(1).optional(),
              replace: z.string(),
              all: z.boolean().optional(),
              occurrence: z.number().int().positive().optional(),
              expectedMatches: z.number().int().nonnegative().optional(),
              required: z.boolean().optional(),
            })
            .superRefine((edit, context) => {
              if ((edit.find !== undefined) === (edit.objectId !== undefined)) {
                context.addIssue({
                  code: "custom",
                  message:
                    "A replace edit requires exactly one of find or objectId",
                });
              }
              if (
                edit.objectId !== undefined &&
                (edit.all !== undefined || edit.occurrence !== undefined)
              ) {
                context.addIssue({
                  code: "custom",
                  message:
                    "objectId replacement does not support all or occurrence",
                });
              }
              if (
                edit.objectId !== undefined &&
                edit.expectedMatches !== undefined &&
                edit.expectedMatches !== 1
              ) {
                context.addIssue({
                  code: "custom",
                  message: "objectId replacement expectedMatches must be 1",
                });
              }
            }),
          z.object({
            op: z.enum(["insert-before", "insert-after"]),
            marker: z.string(),
            content: z.string(),
            occurrence: z.number().int().positive().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
          z.object({
            op: z.literal("replace-between"),
            start: z.string(),
            end: z.string(),
            content: z.string(),
            includeDelimiters: z.boolean().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
          z.object({
            op: z.literal("regex-replace"),
            pattern: z.string(),
            replace: z.string(),
            flags: z.string().optional(),
            all: z.boolean().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
        ]),
      )
      .min(1)
      .optional()
      .describe(
        "Ordered atomic edits against the current HTML. For one exact text replacement, use find and expectedMatches=1; for a selected element without exact selectedText, use its objectId to replace only the element's inner content. Each edit must match unless required=false.",
      ),
    styleOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Set true for a styling-only request, including propagating one slide\'s colors to other slides. Requires the structured "edits" array: fullContent and the top-level legacy find/replace/objectId fields are rejected, so send find/replace as edits: [{"find":"...","replace":"...","occurrence":1}] instead. Use occurrence rather than expectedMatches here: a CSS declaration often appears more than once on a slide, and expectedMatches rejects that outright. Rejects any change outside CSS declarations, including text, markup, or layout structure.',
      ),
    baseContentHash: z
      .string()
      .optional()
      .describe(
        "Optional hash returned by view-screen or get-deck for the exact slide source being patched. The edit is rejected if the source changed since it was read.",
      ),
    format: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Format the resulting HTML with Prettier before persisting it.",
      ),
    preserveSource: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Keep source-imported images and factual copy (default true). Set false only when the user explicitly asks to rewrite the source slide.",
      ),
    contextPackId: z
      .string()
      .optional()
      .describe(
        "Exact pack used for this edit; omit to inherit the deck pack.",
      ),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this edit only without changing the saved preference or deck pack.",
      ),
    reuseLabels: z
      .array(reuseLabelSchema)
      .optional()
      .default([])
      .describe("Exact context item versions that influenced this slide edit."),
  }),
  http: { method: "POST" },
  run: async (args, ctx) => {
    const isAgentCaller = isAgentPatchCaller(ctx?.caller);
    const {
      deckId,
      slideId,
      find,
      objectId,
      replace,
      fullContent,
      edits,
      baseContentHash,
      format,
      preserveSource,
      styleOnly,
      contextPackId,
      contextModeOverride,
      reuseLabels,
    } = args;
    const hasLegacyMode =
      find !== undefined || objectId !== undefined || replace !== undefined;
    const inputModeCount =
      Number(Boolean(edits)) +
      Number(hasLegacyMode) +
      Number(fullContent !== undefined);
    if (inputModeCount === 0) {
      fail(
        "One of --edits, --find/--replace, --objectId/--replace, or --fullContent is required",
        {
          errorCode: "slide_edit_mode_required",
        },
      );
    }
    if (inputModeCount > 1) {
      fail(
        "Use exactly one input mode: --edits, --find/--replace, --objectId/--replace, or --fullContent; do not combine modes",
        { errorCode: "slide_edit_modes_conflict" },
      );
    }
    if (styleOnly && !edits) {
      fail(
        'Style-only slide edits must use the structured "edits" array. ' +
          'styleOnly rejects "fullContent" and the top-level legacy "find"/"replace"/"objectId" fields. ' +
          styleOnlyEditsSuggestion({ find, objectId, replace }),
        { errorCode: "style_only_slide_edits_required" },
      );
    }
    if (objectId !== undefined && find !== undefined) {
      fail("Use either --find or --objectId for a legacy text edit, not both", {
        errorCode: "slide_find_object_id_conflict",
      });
    }
    if (objectId !== undefined && replace === undefined) {
      fail(
        "Legacy --objectId requires --replace; pass an empty string explicitly to clear the element",
        { errorCode: "slide_object_id_replace_required" },
      );
    }
    if (find !== undefined && replace === undefined) {
      fail(
        "Legacy --find requires --replace; pass an empty string explicitly to clear the match",
        { errorCode: "slide_find_replace_required" },
      );
    }
    if (replace !== undefined && find === undefined && objectId === undefined) {
      fail("Legacy --replace requires --find", {
        errorCode: "slide_replace_requires_find",
      });
    }
    if (find !== undefined && find.length === 0) {
      fail("find must not be empty for legacy search/replace", {
        errorCode: "slide_find_empty",
      });
    }
    await assertAccess("deck", deckId, "editor");

    const browserTabId = getCurrentRequestBrowserTabId();
    if (browserTabId) {
      const currentSelection = await readAppStateForCurrentTab(
        "slides-selection",
        { fallbackToGlobal: false },
      );
      const currentSlideId =
        currentSelection?.deckId === deckId &&
        typeof currentSelection.slideId === "string"
          ? currentSelection.slideId
          : null;
      const selectionItems = Array.isArray(currentSelection?.items)
        ? currentSelection.items.filter(
            (item): item is Record<string, unknown> =>
              typeof item === "object" && item !== null,
          )
        : [];
      const selectedObjectIds = new Set(
        selectionItems.flatMap((item) =>
          typeof item.objectId === "string" ? [item.objectId] : [],
        ),
      );
      const selectedTexts = new Set(
        selectionItems.flatMap((item) =>
          typeof item.selectedText === "string" ? [item.selectedText] : [],
        ),
      );
      const usesCurrentSelection =
        (typeof objectId === "string" && selectedObjectIds.has(objectId)) ||
        (typeof find === "string" && selectedTexts.has(find)) ||
        (Array.isArray(edits) &&
          edits.some((edit) => {
            if (!edit || typeof edit !== "object") return false;
            const candidate = edit as {
              find?: unknown;
              objectId?: unknown;
            };
            return (
              (typeof candidate.objectId === "string" &&
                selectedObjectIds.has(candidate.objectId)) ||
              (typeof candidate.find === "string" &&
                selectedTexts.has(candidate.find))
            );
          }));

      if (
        currentSlideId &&
        currentSlideId !== slideId &&
        usesCurrentSelection &&
        baseContentHash === undefined
      ) {
        fail(
          `The selected Slides target is on slide ${currentSlideId}, but this edit targets ${slideId}. Re-read view-screen and use the selection slide ID; no write was made.`,
          {
            errorCode: "slide_target_not_current",
            statusCode: 409,
            details: { deckId, currentSlideId, requestedSlideId: slideId },
          },
        );
      }
    }

    const rmw = await withDeckLock(deckId, async () => {
      const db = getDb();

      const [row] = await db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          data: schema.decks.data,
          ownerEmail: schema.decks.ownerEmail,
          designSystemId: schema.decks.designSystemId,
          updatedAt: schema.decks.updatedAt,
        })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (!row) {
        fail(`Deck ${deckId} not found`, {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }

      const deck = JSON.parse(row.data);
      const existingContext = storedCreativeContext(deck.creativeContext);
      if (
        existingContext &&
        contextPackId !== undefined &&
        contextPackId !== existingContext.contextPackId
      ) {
        fail(
          "The slide edit must use the deck's existing creative-context pack",
          { errorCode: "creative_context_pack_mismatch", statusCode: 409 },
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slideIndex = Array.isArray(deck.slides)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          deck.slides.findIndex((s: any) => s.id === slideId)
        : -1;
      const slide = slideIndex >= 0 ? deck.slides[slideIndex] : undefined;
      if (!slide) {
        fail(`Slide ${slideId} not found in deck ${deckId}`, {
          errorCode: "slide_not_found",
          statusCode: 404,
        });
      }

      if (
        baseContentHash !== undefined &&
        hashSlideContent(String(slide.content ?? "")) !== baseContentHash
      ) {
        fail(
          "Slide content changed since it was read. Call get-deck with this slideId again and rebase the patch.",
          { errorCode: "slide_content_stale", statusCode: 409 },
        );
      }

      let applied = false;
      let notFound = false;
      let editResults: string[] | undefined;
      const previousContent = String(slide.content ?? "");
      const validateNextContent = (
        nextContent: string,
        styleOnlyBaseline = previousContent,
      ) => {
        assertNoRenderArtifacts(previousContent, nextContent, slideId);
        assertNoNewUnresolvedPlaceholders(previousContent, nextContent);
        if (styleOnly) {
          assertStyleOnlyEdit(styleOnlyBaseline, nextContent);
        }
        assertSourceSlidePreserved({
          metadata: sourceImportForDeck(deck.sourceImport),
          slideId,
          nextContent,
          preserveSource,
        });
      };

      if (fullContent !== undefined) {
        const nextContent = normalizeSlidePaddingForWrite(
          previousContent,
          fullContent,
        );
        validateNextContent(nextContent);
        slide.content = nextContent;
        applied = nextContent !== previousContent;
      } else if (edits) {
        const sourceContent = format
          ? await formatSlideHtml(previousContent)
          : previousContent;
        const patched = await applySlideContentEdits(
          sourceContent,
          edits as SlideContentEdit[],
          format,
        );
        const nextContent = styleOnly
          ? patched.content
          : normalizeSlidePaddingForWrite(previousContent, patched.content);
        validateNextContent(
          nextContent,
          styleOnly ? sourceContent : previousContent,
        );
        slide.content = nextContent;
        applied = patched.changed;
        editResults = patched.applied;
        if (!applied) slide.content = previousContent;
      } else if (objectId !== undefined) {
        const sourceContent = format
          ? await formatSlideHtml(previousContent)
          : previousContent;
        const patched = await applySlideContentEdits(
          sourceContent,
          [{ objectId, replace: replace! }],
          format,
        );
        const nextContent = normalizeSlidePaddingForWrite(
          previousContent,
          patched.content,
        );
        validateNextContent(nextContent);
        slide.content = nextContent;
        applied = patched.changed;
        editResults = patched.applied;
        if (!applied) slide.content = previousContent;
      } else if (find !== undefined) {
        const idx = previousContent.indexOf(find);
        if (idx === -1) {
          notFound = true;
        } else {
          const nextContent =
            previousContent.slice(0, idx) +
            (replace ?? "") +
            previousContent.slice(idx + find.length);
          validateNextContent(nextContent);
          slide.content = nextContent;
          applied = nextContent !== previousContent;
        }
      }

      if (applied) {
        slide.layoutFitRevision = createLayoutFitRevision();
        if (isAgentCaller) delete slide.layoutWarningDismissed;
      }

      if (applied && Array.isArray(slide.animations) && !styleOnly) {
        delete slide.animations;
      }

      if (applied) {
        const shouldResolveCreativeContext =
          Boolean(existingContext) ||
          contextPackId !== undefined ||
          contextModeOverride !== undefined ||
          reuseLabels.length > 0;
        let creativeContext:
          | {
              contextMode: "off" | "auto" | "pinned";
              contextPackId: string | null;
              reuseLabels: CreativeContextReuseLabel[];
              mergedReuseLabels: CreativeContextReuseLabel[];
              elementProvenance: CreativeContextElementProvenance[];
            }
          | undefined;

        if (shouldResolveCreativeContext) {
          const effectivePackId =
            contextPackId ?? existingContext?.contextPackId;
          const requestedLabels: CreativeContextReuseLabel[] =
            reuseLabels.length
              ? reuseLabels
              : [
                  {
                    kind: "slide",
                    label: "Net-new slide edit",
                    dataRole: "untrusted-reference",
                    elementId: slideId,
                    influence: "generated",
                  },
                ];
          const validated = await validateGenerationCreativeContext({
            contextPackId: effectivePackId,
            contextPackSource:
              contextPackId === undefined ? "inherited" : "explicit",
            contextModeOverride,
            reuseLabels: requestedLabels,
            reuseLabelsSource: reuseLabels.length ? "explicit" : "inherited",
          });
          const contextMode =
            validated.contextMode === "off"
              ? "off"
              : (existingContext?.contextMode ?? validated.contextMode);
          const slideReuseLabels = validated.reuseLabels.map((label) => ({
            ...label,
            elementId: slideId,
          }));
          const mergedReuseLabels = mergeCreativeContextReuseLabels(
            existingContext?.reuseLabels ?? [],
            slideReuseLabels,
          );
          const previous =
            contextMode === "off"
              ? null
              : await getGenerationCreativeContext({
                  appId: "slides",
                  artifactType: "deck",
                  artifactId: deckId,
                });
          const editedElementProvenance = slideReuseLabels.map((label) => ({
            elementId: slideId,
            influence: label.influence ?? ("reference-conditioned" as const),
            ...(label.itemId ? { itemId: label.itemId } : {}),
            ...(label.itemVersionId
              ? { itemVersionId: label.itemVersionId }
              : {}),
            label: label.label,
          }));
          const elementProvenance =
            contextMode === "off"
              ? editedElementProvenance
              : replaceCreativeContextElementProvenance(
                  previous?.elementProvenance ?? [],
                  editedElementProvenance,
                );
          creativeContext = {
            contextMode,
            contextPackId: validated.contextPackId,
            reuseLabels: slideReuseLabels,
            mergedReuseLabels,
            elementProvenance,
          };
          slide.creativeContextReuseLabels = slideReuseLabels;
          deck.creativeContext =
            contextMode === "off" && existingContext
              ? existingContext
              : {
                  contextMode,
                  contextPackId: validated.contextPackId,
                  reuseLabels: mergedReuseLabels,
                };
        }
        const now = nextDeckRevision(row.updatedAt);
        deck.updatedAt = now;
        await db.transaction(async (tx: any) => {
          await createDeckVersionSnapshot(
            {
              id: row.id,
              title: row.title ?? "Untitled",
              data: row.data ?? "",
              ownerEmail: row.ownerEmail ?? "",
            },
            {
              force: isAgentPatchCaller(ctx?.caller),
              chatContext: deckVersionChatContextFromAction(ctx),
              label: "Before slide edit",
              db: tx,
            },
          );
          const updateResult = await tx
            .update(schema.decks)
            .set({ data: JSON.stringify(deck), updatedAt: now })
            .where(deckRevisionWhere(schema.decks, deckId, row.updatedAt));
          assertDeckWriteApplied(updateResult, deckId, "slide edit");
          if (creativeContext) {
            await recordGenerationCreativeContext(
              {
                appId: "slides",
                artifactType: "deck",
                artifactId: deckId,
                contextMode: creativeContext.contextMode,
                contextPackId: creativeContext.contextPackId,
                reuseLabels:
                  creativeContext.contextMode === "off"
                    ? creativeContext.reuseLabels
                    : creativeContext.mergedReuseLabels,
                elementProvenance: creativeContext.elementProvenance,
              },
              { db: tx },
            );
          }
        });
        return {
          applied,
          notFound,
          editResults,
          slide,
          slideIndex,
          contentHash: hashSlideContent(String(slide.content ?? "")),
          layoutFitRevision: slide.layoutFitRevision,
          ...(creativeContext
            ? {
                contextMode: creativeContext.contextMode,
                contextPackId: creativeContext.contextPackId,
                reuseLabels: creativeContext.reuseLabels,
              }
            : {}),
        };
      }

      return {
        applied,
        notFound,
        editResults,
        slide,
        slideIndex,
        contentHash: hashSlideContent(String(slide.content ?? "")),
        layoutFitRevision: slide.layoutFitRevision,
      };
    });

    if (rmw.notFound) {
      fail(
        `Nothing was written: text not found in slide: "${find!.slice(0, 60)}". Current slide contentHash is ${rmw.contentHash}; call get-deck with this slideId and rebase the patch against the current HTML.`,
        { errorCode: "slide_text_not_found" },
      );
    }

    const { applied, editResults } = rmw;
    const unmatched = (editResults ?? []).filter((entry) =>
      entry.endsWith(":0"),
    );
    if (!applied) {
      fail(
        unmatched.length
          ? `Nothing was written: ${unmatched.join(", ")} matched no text in the slide. Current slide contentHash is ${rmw.contentHash}; call get-deck with this slideId and rebase the patch against the current HTML.`
          : `Nothing was written: the result is identical to the current slide content (contentHash ${rmw.contentHash}). The slide already says what this edit would have made it say.`,
        { errorCode: "slide_edit_noop" },
      );
    }

    if (applied) {
      touchAgentSlidePresence({
        deckId,
        slideId,
        label: slideLabelFor(rmw.slide, rmw.slideIndex),
      });
    }

    const agentChangeId = deckVersionChangeGroupFromAction(ctx);
    await notifyClients(deckId, {
      slideId,
      actor: "agent",
      ...(agentChangeId ? { agentChangeId } : {}),
    });

    track(
      "deck_edited",
      {
        app_name: "slides",
        template_name: "slides",
        output_id: deckId,
        output_type: "deck",
        slide_id: slideId,
        edit_mode: "update_slide",
        edits_count: applied,
      },
      ctx,
    );

    console.log(
      `update-slide: deck=${deckId} slide=${slideId} ${edits ? `edits=${edits.length}` : objectId !== undefined ? `objectId="${objectId}"` : find !== undefined ? `find="${find.slice(0, 40)}"` : "fullContent"} applied=${applied}`,
    );

    const base = {
      ok: true,
      deckId,
      slideId,
      applied,
      editResults,
      ...(unmatched.length
        ? {
            partial: true,
            message: `Applied, but ${unmatched.join(", ")} matched no text and was skipped — do not report those parts as done.`,
          }
        : {}),
      contentHash: rmw.contentHash,
      layoutFit: {
        status: "pending" as const,
        slideId,
        contentHash: rmw.contentHash,
        layoutFitRevision: rmw.layoutFitRevision,
      },
      appUrl: getDeckUrl(deckId),
      deepLink: deckDeepLink(deckId),
      ...(rmw.contextMode
        ? {
            contextMode: rmw.contextMode,
            contextPackId: rmw.contextPackId,
            reuseLabels: rmw.reuseLabels,
          }
        : {}),
    };

    return base;
  },
  link: ({ result, args }) => {
    const deckId =
      result && typeof result === "object"
        ? ((result as { deckId?: string }).deckId ??
          (typeof args.deckId === "string" ? args.deckId : undefined))
        : typeof args.deckId === "string"
          ? args.deckId
          : undefined;
    if (!deckId) return null;
    return {
      url: deckDeepLink(deckId),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
