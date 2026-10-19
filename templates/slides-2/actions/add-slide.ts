import {
  ActionContractError,
  defineAction,
  embedApp,
  fail,
} from "@agent-native/core";
import type { WriteReceipt } from "@agent-native/core/action";
import { buildDeepLink, getRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
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

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
} from "../server/lib/deck-versions.js";
import { noteGenerationFirstOutput } from "../server/lib/generation-completion.js";
import {
  HYGIENE_ACTION_DESCRIPTION,
  slideHygieneResult,
} from "../server/lib/slide-hygiene.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "../server/lib/slide-source-limits.js";
import { trackSlides } from "../server/lib/slides-tracking.js";
import {
  projectSlidesAddedSlideResult,
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
} from "../shared/action-ui.js";
import { isRealSlide } from "../shared/blank-slide.js";
import { repairGeneratedDeckTitle } from "../shared/deck-title.js";
import { generationTimingFields } from "../shared/generation-timing.js";
import {
  createLayoutFitRevision,
  hashSlideContent,
} from "../shared/slide-fit.js";
import { slideLabelFor, touchAgentSlidePresence } from "./_agent-presence.js";
import { getDeckUrl } from "./_app-url.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import {
  assertNoDeckRenderArtifacts,
  assertNoRenderArtifactsInNewSlide,
} from "./_render-artifacts.js";
import { compileSlideSource } from "./_slide-source.js";
import { isAgentPatchCaller, withDeckLock } from "./patch-deck.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides-2",
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

interface DeckCreativeContext {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
}

function deckCreativeContext(value: unknown): DeckCreativeContext | null {
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

export default defineAction({
  title: "Add slide to deck",
  description:
    "Add a single React-source slide to an editable Slides 2 deck. This is the primary Slides 2 authoring action: use it after create-deck instead of creating or publishing a standalone HTML artifact. " +
    "When the full deck can be authored before persistence, pass all slides to create-deck in one atomic call. Use add-slide sequentially only for genuinely live in-app generation, where pages appear as they are authored; each write preserves per-slide Creative Context provenance. Never issue independent parallel writes to the same deck. " +
    "For an open action-owned incremental generation created with slides: [], pass generationComplete=false on each intermediate add-slide call and true on the final call; the final write persists completion so later additions are ordinary edits. " +
    "For an agent-generated deck with a persisted target slide count, stop once that many real (non-blank) slides exist. If the user explicitly asks for more slides after the target, re-read the deck and set targetSlideCountOverride to the new total of real slides on the first add-slide call. " +
    "Before the first incremental write, assign each planned page a unique stable slideId and include it in the call. Reuse that ID and the same sourceTsx or content and notes after an unclear result. If a retry returns duplicate_slide_id, call get-deck with slideIds=[slideId] and compact=false; treat it as saved only when its ID and sourceTsx or content and notes match, otherwise stop and report the conflict. Calls that omit slideId receive an auto-generated ID and are not retry-safe. " +
    "Before the first slide you add to an existing deck, call `get-deck` with compact=true once and use its `designSystem`, `deckStyle`, and `representativeSlideId`; if designSystem.scope is summary, call `get-design-system` once with its id. Reuse that context for every following slide. Never use generic slide styling from an id alone. " +
    "Pass presenter-only speaker notes in `notes`; keep them out of the slide HTML. " +
    "For generated slides, pass one default-exported React page component in `sourceTsx`; the component is validated and stored in SQL, then rendered in a bounded Worker inside an opaque-origin sandbox. React and the eleven Worker-supported named `@open-slide/core` values are the only module imports: `CANVAS_WIDTH`, `CANVAS_HEIGHT`, `defaultDesign`, `designToCssVars`, `cssVarsToString`, `Step`, `Steps`, `useSlidePageNumber`, `useIsActivePage`, `ImagePlaceholder`, and `MorphElement`. `cssVarsToString` serializes a bounded safe custom-property map to text and does not enable runtime CSS injection. Static `design`, `meta`, and `transition` exports are supported. Use inline styles or static CSS strings in local `style`/`css`/`keyframe` constants; CSS is sanitized and scoped, while Tailwind utilities have no stylesheet in the frame. Do not use arbitrary imports, browser globals, event handlers, CSS imports, remote CSS/fonts, or external URLs. Images and videos must use uploaded `asset://` handles. Call `list-assets` with `media` set to `video` or `all` to find uploaded MP4/WebM videos; it defaults to images. Use the returned `assetId` as the React `<video>` source, and an uploaded image handle for an optional poster. For an existing source-backed slide, read it with `get-slide-source`, save with `update-slide-source` using its revision and sourceHash, then read it back. Do not change generated slide source through legacy `content` or `patch-deck`. The `content` field is retained for legacy/imported HTML. Keep the shared deck theme consistent and use the `get/update-deck-design-tokens` actions for deck-level colors and type scale. " +
    "Use `patch-deck` for supported deck-structure edits, not for appending newly generated slides in this workflow. " +
    'Exception: when the user asks for a blank or empty slide, pass layout="blank" with an empty padded `fmd-slide` wrapper (reuse the deck background if one exists) and skip the get-deck preflight, the styling requirement, and fit/contrast checks. ' +
    "Returns the new slide ID, 1-based slideNumber, updated slide count, realSlideCount (real non-blank slides after the write, present when the deck has a target slide count; compare it, not slideCount, with the target), and pending layoutFit identity. Do not check fit after each write: finish all slide edits, then call get-layout-overflows once, and once more only after a repair. If measurements are unknown, report the unmeasured slides and do not recheck this turn unless the editor has produced a new measurement. If the slide is saved but client notification fails, the result includes notificationStatus='failed' and notificationErrorType; the write already succeeded, so do not retry it." +
    HYGIENE_ACTION_DESCRIPTION,
  schema: z
    .object({
      deckId: z.string().describe("Target deck ID"),
      content: z
        .string()
        .optional()
        .describe("Legacy/imported HTML; use sourceTsx for a generated slide"),
      sourceTsx: z
        .string()
        .max(MAX_SLIDE_SOURCE_BYTES)
        .refine(isSlideSourceWithinByteLimit, {
          message: SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
        })
        .optional()
        .describe(
          "Default-exported React component source for this generated slide; React and named @open-slide/core imports only, bounded static CSS, and uploaded image or MP4/WebM asset:// handles. Find videos with `list-assets` using media set to `video` or `all`.",
        ),
      slideId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Unique stable ID for this page. Provide it on the first generated write and reuse it on retry with the same sourceTsx or content and notes. If duplicate_slide_id is returned, call get-deck with slideIds=[slideId] and compact=false, then compare its ID and payload before treating the write as saved. Omit only when no retry is needed; the action auto-generates an ID and the call is not retry-safe.",
        ),
      layout: z
        .enum([
          "title",
          "section",
          "content",
          "two-column",
          "image",
          "statement",
          "full-image",
          "blank",
        ])
        .optional()
        .describe("Layout type hint"),
      notes: z
        .string()
        .optional()
        .describe(
          "Optional presenter-only speaker notes; keep them out of HTML",
        ),
      position: z
        .preprocess((value) => {
          if (typeof value !== "string") return value;
          const trimmed = value.trim();
          if (trimmed.toLowerCase() === "start") return 0;
          if (trimmed.toLowerCase() === "end") return Number.MAX_SAFE_INTEGER;
          return trimmed === "" ? value : Number(trimmed);
        }, z.number().int().min(0))
        .optional()
        .describe(
          'Where to insert the slide: a 0-based index, or "start" / "end". Omit to append to the end of the deck.',
        ),
      targetSlideCountOverride: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "New total of real slides. Set only when the user explicitly asks for more slides after the persisted target.",
        ),
      generationComplete: z
        .boolean()
        .optional()
        .describe(
          "Required until an action-owned incremental generation is complete: false on intermediate slides and true on the final slide.",
        ),
      contextPackId: z
        .string()
        .optional()
        .describe(
          "Immutable context pack used for this slide. Omit to inherit the deck's existing pack.",
        ),
      contextModeOverride: z
        .literal("off")
        .optional()
        .describe(
          "Disable Creative Context for this slide generation only without changing the saved preference or deck pack.",
        ),
      reuseLabels: z
        .array(reuseLabelSchema)
        .optional()
        .default([])
        .describe(
          "Exact item versions that influenced this slide. Labels are bound to the new slide id.",
        ),
    })
    .superRefine(({ content, sourceTsx }, context) => {
      if ((content === undefined) === (sourceTsx === undefined)) {
        context.addIssue({
          code: "custom",
          path: ["sourceTsx"],
          message: "Pass exactly one of sourceTsx or legacy content.",
        });
      }
    }),
  chatUI: {
    renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER,
    when: (_args, result) => projectSlidesAddedSlideResult(result) !== null,
    projectResult: (_args, result) => projectSlidesAddedSlideResult(result),
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck editor",
      description: "Open the updated deck in the Slides 2 editor.",
      iframeTitle: "Agent-Native Slides 2",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  // Not retrySafe: a replay with the same slideId is rejected and must be
  // reconciled by reading the deck before another add is attempted.
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    {
      deckId,
      content,
      sourceTsx,
      slideId,
      layout,
      notes,
      position,
      contextPackId,
      contextModeOverride,
      reuseLabels,
      targetSlideCountOverride,
      generationComplete,
    },
    ctx,
  ) =>
    withDeckLock(deckId, async () => {
      await assertAccess("deck", deckId, "editor");
      const db = getDb();

      const rows = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId));

      if (!rows.length) {
        fail(`Deck ${deckId} not found`, {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }

      const row = rows[0];
      let parsedDeck: unknown;
      try {
        parsedDeck = JSON.parse(row.data);
      } catch {
        fail("Deck data is not valid JSON.", {
          errorCode: "invalid_deck_data",
          statusCode: 500,
          details: { deckId },
        });
      }
      assertSlides2DeckData(parsedDeck);
      const deck = parsedDeck as Record<string, unknown>;
      const storedSlides: unknown = deck.slides;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let slides: any[];
      if (storedSlides === undefined) {
        slides = [];
      } else if (storedSlides === null) {
        slides = [];
      } else if (Array.isArray(storedSlides)) {
        slides = storedSlides;
      } else {
        fail("Deck data has an invalid slide list.", {
          errorCode: "invalid_deck_data",
          statusCode: 500,
          details: { deckId },
        });
      }
      const newSlideId =
        slideId ??
        `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (slides.some((slide) => slide?.id === newSlideId)) {
        fail(
          `Slide ID ${newSlideId} already exists in deck ${deckId}. Read the deck and continue from its persisted slides instead of retrying this add.`,
          {
            errorCode: "duplicate_slide_id",
            statusCode: 409,
            details: { deckId, slideId: newSlideId },
          },
        );
      }
      const compiledSource =
        sourceTsx === undefined
          ? undefined
          : await compileSlideSource(sourceTsx, {
              ownerEmail: row.ownerEmail,
              orgId: row.orgId,
            });
      const slideContent =
        compiledSource?.content ?? normalizeSlidePadding(content!);
      const generationContext: Record<string, unknown> | null =
        deck.generationContext &&
        typeof deck.generationContext === "object" &&
        !Array.isArray(deck.generationContext)
          ? (deck.generationContext as Record<string, unknown>)
          : null;
      const completesActionGeneration =
        generationComplete === true &&
        generationContext?.generationMode === "action" &&
        generationContext.generationComplete !== true;
      if (
        generationContext?.generationMode === "action" &&
        generationContext.generationComplete !== true &&
        generationComplete === undefined
      ) {
        throw new ActionContractError(
          "Set generationComplete=false on intermediate slides and true on the final slide of an action-owned incremental generation.",
          {
            errorCode: "generation_completion_flag_required",
            details: { deckId },
          },
        );
      }
      const targetSlideCount =
        generationContext &&
        typeof generationContext.targetSlideCount === "number" &&
        Number.isInteger(generationContext.targetSlideCount) &&
        generationContext.targetSlideCount > 0
          ? generationContext.targetSlideCount
          : null;
      // Counting parses slide HTML, so only a deck with a target pays for it.
      const realSlideCount =
        targetSlideCount === null ? null : slides.filter(isRealSlide).length;
      const postWriteRealSlideCount =
        realSlideCount === null
          ? null
          : realSlideCount + (isRealSlide({ content: slideContent }) ? 1 : 0);
      if (targetSlideCountOverride !== undefined) {
        if (!isAgentPatchCaller(ctx?.caller)) {
          throw new ActionContractError(
            "targetSlideCountOverride is only available to agent calls after an explicit user request for more slides.",
            { errorCode: "target_slide_count_override_agent_only" },
          );
        }
        if (
          targetSlideCount === null ||
          realSlideCount === null ||
          targetSlideCountOverride <= targetSlideCount ||
          realSlideCount < targetSlideCount ||
          targetSlideCountOverride <= realSlideCount
        ) {
          throw new ActionContractError(
            targetSlideCount === null || realSlideCount === null
              ? "targetSlideCountOverride requires a persisted target slide count."
              : realSlideCount < targetSlideCount
                ? `targetSlideCountOverride is only valid after the deck reaches its persisted target of ${targetSlideCount} slides; it has ${realSlideCount} real slides (blank placeholders do not count).`
                : `targetSlideCountOverride must extend both the persisted target of ${targetSlideCount} and the current real slide count of ${realSlideCount}.`,
            {
              errorCode: "target_slide_count_override_invalid",
              details: {
                deckId,
                currentSlideCount: slides.length,
                realSlideCount,
                targetSlideCount,
                targetSlideCountOverride,
              },
            },
          );
        }
      }
      if (
        isAgentPatchCaller(ctx?.caller) &&
        targetSlideCount !== null &&
        realSlideCount !== null &&
        realSlideCount >= targetSlideCount &&
        postWriteRealSlideCount !== realSlideCount &&
        targetSlideCountOverride === undefined
      ) {
        fail(
          `No slide was added: this deck already has ${realSlideCount} real slides against its requested target of ${targetSlideCount}. Re-read the deck. If the target is satisfied, stop authoring and finish the response; do not retry. Only if the user explicitly asked for more than ${targetSlideCount} slides, call add-slide again with targetSlideCountOverride set to the new total of real slides.`,
          {
            errorCode: "target_slide_count_reached",
            statusCode: 409,
            details: {
              deckId,
              currentSlideCount: slides.length,
              realSlideCount,
              targetSlideCount,
            },
          },
        );
      }

      const effectiveTargetSlideCount =
        targetSlideCountOverride ?? targetSlideCount;
      if (
        generationComplete &&
        effectiveTargetSlideCount !== null &&
        postWriteRealSlideCount !== null &&
        postWriteRealSlideCount < effectiveTargetSlideCount
      ) {
        throw new ActionContractError(
          `Cannot complete generation before reaching its target of ${effectiveTargetSlideCount} slides; this write would leave ${postWriteRealSlideCount} real slides (blank placeholders do not count).`,
          {
            errorCode: "generation_completed_before_target_reached",
            details: {
              deckId,
              currentSlideCount: slides.length,
              realSlideCount,
              postWriteRealSlideCount,
              postWriteSlideCount: slides.length + 1,
              targetSlideCount: effectiveTargetSlideCount,
            },
          },
        );
      }

      if (targetSlideCountOverride !== undefined) {
        deck.generationContext = {
          ...(generationContext ?? {}),
          targetSlideCount: targetSlideCountOverride,
        };
      }

      const existingContext = deckCreativeContext(deck.creativeContext);
      if (
        existingContext &&
        contextPackId !== undefined &&
        contextPackId !== existingContext.contextPackId
      ) {
        fail(
          "The added slide must use the deck's existing creative-context pack",
          { errorCode: "creative_context_pack_mismatch", statusCode: 409 },
        );
      }
      const effectivePackId = contextPackId ?? existingContext?.contextPackId;
      const requestedLabels: CreativeContextReuseLabel[] = reuseLabels.length
        ? reuseLabels
        : [
            {
              kind: "slide",
              label: "Net-new slide",
              dataRole: "untrusted-reference",
              elementId: newSlideId,
              influence: "generated",
            },
          ];
      let contextMode: "off" | "auto" | "pinned";
      let recordedPackId: string | null;
      let validatedLabels: CreativeContextReuseLabel[];
      if (effectivePackId) {
        const validated = await validateGenerationCreativeContext({
          contextPackId: effectivePackId,
          contextPackSource:
            contextPackId === undefined ? "inherited" : "explicit",
          contextModeOverride,
          reuseLabels: requestedLabels,
          reuseLabelsSource: reuseLabels.length ? "explicit" : "inherited",
        });
        contextMode =
          validated.contextMode === "off"
            ? "off"
            : (existingContext?.contextMode ?? validated.contextMode);
        recordedPackId = validated.contextPackId;
        validatedLabels = validated.reuseLabels;
      } else if (existingContext) {
        const validated = await validateGenerationCreativeContext({
          contextModeOverride,
          reuseLabels: requestedLabels,
        });
        contextMode = validated.contextMode;
        recordedPackId = validated.contextPackId;
        validatedLabels = validated.reuseLabels;
      } else {
        const validated = await validateGenerationCreativeContext({
          contextModeOverride,
          reuseLabels: requestedLabels,
        });
        contextMode = validated.contextMode;
        recordedPackId = validated.contextPackId;
        validatedLabels = validated.reuseLabels;
      }
      const slideReuseLabels = validatedLabels.map((label) => ({
        ...label,
        elementId: newSlideId,
      }));
      const mergedReuseLabels = mergeCreativeContextReuseLabels(
        existingContext?.reuseLabels ?? [],
        slideReuseLabels,
      );
      const previousGeneration =
        contextMode === "off"
          ? null
          : await getGenerationCreativeContext({
              appId: "slides-2",
              artifactType: "deck",
              artifactId: deckId,
            });
      if (
        recordedPackId &&
        previousGeneration?.contextPackId &&
        previousGeneration.contextPackId !== recordedPackId
      ) {
        fail(
          "The deck's recorded creative-context pack does not match its stored metadata",
          {
            errorCode: "creative_context_conflict",
            statusCode: 409,
          },
        );
      }
      const slideElementProvenance = slideReuseLabels.map((label) => ({
        elementId: newSlideId,
        influence: label.influence ?? ("reference-conditioned" as const),
        ...(label.itemId ? { itemId: label.itemId } : {}),
        ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
        label: label.label,
      }));
      const elementProvenance =
        contextMode === "off"
          ? slideElementProvenance
          : replaceCreativeContextElementProvenance(
              previousGeneration?.elementProvenance ?? [],
              slideElementProvenance,
            );

      assertNoRenderArtifactsInNewSlide(
        slideContent,
        newSlideId,
        slides.map((s) => String(s.content ?? "")),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newSlide: any = {
        id: newSlideId,
        content: slideContent,
        layoutFitRevision: createLayoutFitRevision(),
        creativeContextReuseLabels: slideReuseLabels,
        ...(sourceTsx === undefined
          ? {}
          : {
              sourceTsx,
              revision: 1,
              sourceHash: compiledSource!.sourceHash,
            }),
      };
      if (layout) newSlide.layout = layout;
      if (notes !== undefined) newSlide.notes = notes;

      const insertIndex =
        typeof position === "number"
          ? Math.max(0, Math.min(position, slides.length))
          : slides.length;
      const shouldRepairTitle = slides.length === 0;
      slides.splice(insertIndex, 0, newSlide);

      const now = nextDeckRevision(row.updatedAt);
      deck.appId = "slides-2";
      deck.slides = slides;
      if (completesActionGeneration) {
        deck.generationContext = {
          ...(generationContext ?? {}),
          ...(targetSlideCountOverride === undefined
            ? {}
            : { targetSlideCount: targetSlideCountOverride }),
          generationComplete: true,
        };
      }
      const sourceImportCleared =
        deck.sourceImport !== undefined && deck.sourceImport !== null;
      if (sourceImportCleared) delete deck.sourceImport;
      deck.updatedAt = now;
      const currentTitle =
        typeof row.title === "string" && row.title.trim()
          ? row.title
          : typeof deck.title === "string"
            ? deck.title
            : undefined;
      const repairedTitle = shouldRepairTitle
        ? repairGeneratedDeckTitle(currentTitle, newSlide.content)
        : null;
      if (repairedTitle) deck.title = repairedTitle;
      deck.creativeContext =
        contextMode === "off" && existingContext
          ? existingContext
          : {
              contextMode,
              contextPackId: recordedPackId,
              reuseLabels: mergedReuseLabels,
            };

      assertNoDeckRenderArtifacts(row.data, deck);
      const persistedData = JSON.stringify(deck);

      await db.transaction(async (tx: any) => {
        await createDeckVersionSnapshot(
          {
            id: row.id,
            title: row.title,
            data: row.data,
            ownerEmail: row.ownerEmail,
          },
          {
            force: isAgentPatchCaller(ctx?.caller),
            chatContext: deckVersionChatContextFromAction(ctx),
            label: "Before adding slide",
            db: tx,
          },
        );
        const updatedRows = await tx
          .update(schema.decks)
          .set({
            ...(repairedTitle ? { title: repairedTitle } : {}),
            data: persistedData,
            updatedAt: now,
          })
          .where(deckRevisionWhere(schema.decks, deckId, row.updatedAt))
          .returning({
            id: schema.decks.id,
            title: schema.decks.title,
            data: schema.decks.data,
            updatedAt: schema.decks.updatedAt,
          });
        assertDeckWriteApplied(
          { rowsAffected: updatedRows.length },
          deckId,
          "slide addition",
        );
        const persisted = updatedRows[0];
        if (
          persisted?.id !== deckId ||
          persisted.title !== (repairedTitle ?? row.title) ||
          persisted.data !== persistedData ||
          persisted.updatedAt !== now
        ) {
          fail(
            "Database did not return the expected deck after adding a slide.",
            {
              statusCode: 503,
              errorCode: "deck_persistence_unverified",
              details: { deckId, slideId: newSlideId },
            },
          );
        }
        await recordGenerationCreativeContext(
          {
            appId: "slides-2",
            artifactType: "deck",
            artifactId: deckId,
            contextMode,
            contextPackId: recordedPackId,
            reuseLabels:
              contextMode === "off" ? slideReuseLabels : mergedReuseLabels,
            elementProvenance,
          },
          { db: tx },
        );
      });

      touchAgentSlidePresence({
        deckId,
        slideId: newSlideId,
        label: slideLabelFor(newSlide, insertIndex),
      });

      let notificationErrorType: string | undefined;
      try {
        const agentChangeId = deckVersionChangeGroupFromAction(ctx);
        await notifyClients(deckId, {
          slideId: newSlideId,
          actor: "agent",
          ...(agentChangeId ? { agentChangeId } : {}),
        });
      } catch (error) {
        notificationErrorType =
          error instanceof Error && error.name ? error.name : "unknown_error";
      }

      const generationAttemptId =
        typeof generationContext?.generationAttemptId === "string"
          ? generationContext.generationAttemptId
          : undefined;
      const generationStartedAt =
        typeof generationContext?.generationStartedAt === "number" &&
        Number.isFinite(generationContext.generationStartedAt) &&
        generationContext.generationStartedAt >= 0
          ? generationContext.generationStartedAt
          : undefined;
      const browserSessionId = getRequestContext()?.browserSessionId;
      if (
        shouldRepairTitle &&
        generationAttemptId &&
        generationContext?.generationMode !== "action"
      ) {
        noteGenerationFirstOutput(ctx?.turnId || ctx?.runId, {
          deckId,
          generationAttemptId,
          targetSlideCount,
          ...(browserSessionId ? { sessionId: browserSessionId } : {}),
          ...(generationStartedAt !== undefined ? { generationStartedAt } : {}),
        });
      }

      trackSlides(
        "deck_edited",
        {
          output_id: deckId,
          output_type: "deck",
          slide_id: newSlideId,
          slide_count: slides.length,
          edit_mode: "add_slide",
          ...(generationAttemptId
            ? { generation_attempt_id: generationAttemptId }
            : {}),
        },
        ctx,
      );
      if (notificationErrorType) {
        track(
          "deck_change_notification_failed",
          {
            app_name: "slides-2",
            template_name: "slides-2",
            output_id: deckId,
            output_type: "deck",
            slide_id: newSlideId,
            failure_stage: "client_notification",
            error_type: notificationErrorType,
            ...(generationAttemptId
              ? { generation_attempt_id: generationAttemptId }
              : {}),
          },
          ctx,
        );
      }
      if (
        completesActionGeneration &&
        generationAttemptId &&
        generationContext?.generationMode === "action"
      ) {
        const generationEndedAt = Date.now();
        track(
          "generation_completed",
          {
            app_name: "slides-2",
            template_name: "slides-2",
            generation_attempt_id: generationAttemptId,
            output_id: deckId,
            output_type: "deck",
            slide_count: slides.length,
            generation_mode: "incremental",
            outcome: "completed",
            ...generationTimingFields(generationStartedAt, generationEndedAt),
            source: "add_slide_action",
          },
          ctx,
        );
      }

      const _receipt: WriteReceipt = {
        changed: true,
        verified: true,
        summary: `Added slide ${newSlideId} to the deck.`,
        subject: `${deckId}:${newSlideId}`,
        checks: [
          {
            id: "slide-addition",
            ok: true,
            detail: `SQL returned the new slide in deck ${deckId}.`,
          },
        ],
        ...(notificationErrorType
          ? {
              warnings: [
                "The slide was saved, but live client notification failed.",
              ],
            }
          : {}),
      };
      const base = {
        deckId,
        deckTitle:
          (typeof deck.title === "string" ? deck.title.trim() : "") ||
          currentTitle?.trim() ||
          "",
        slideId: newSlideId,
        slideNumber: insertIndex + 1,
        position: insertIndex,
        slideCount: slides.length,
        ...(postWriteRealSlideCount === null
          ? {}
          : { realSlideCount: postWriteRealSlideCount }),
        appUrl: getDeckUrl(deckId),
        deepLink: deckDeepLink(deckId),
        contextMode,
        contextPackId: recordedPackId,
        reuseLabels: slideReuseLabels,
        ...(sourceImportCleared ? { sourceImportCleared: true } : {}),
        ...(notificationErrorType
          ? { notificationStatus: "failed", notificationErrorType }
          : {}),
        layoutFit: {
          status: "pending" as const,
          slideId: newSlideId,
          contentHash: hashSlideContent(newSlide.content),
          layoutFitRevision: newSlide.layoutFitRevision,
        },
        ...slideHygieneResult([
          { slideId: newSlideId, html: newSlide.content },
        ]),
        _receipt,
      };

      return base;
    }),
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
      label: "Open deck in Slides 2",
      view: "editor",
    };
  },
});
