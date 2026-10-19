import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import {
  getRequestRunContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  formatAgentDesignSystemContext,
  loadAgentDesignSystemContext,
} from "@agent-native/core/shared";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getPreset } from "../app/lib/design-systems.js";
import { getDb, schema } from "../server/db/index.js";
import { appStateKey } from "../shared/app-state-tabs.js";
import { isSlides2DeckData } from "../shared/deck-app-scope.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
import { slides2DeckScope } from "../shared/deck-scope.js";
import {
  slideEditorCommandSchema,
  slideEditorStatusSchema,
  SLIDE_EDITOR_COMMAND_KEY,
  SLIDE_EDITOR_STATUS_KEY,
} from "../shared/editor-control.js";
import { normalizeOwnerEmail } from "../shared/ownership.js";
import { summarizeDeckStyle } from "../shared/representative-slide.js";
import { parseSlideCommentAnchor } from "../shared/slide-comment-anchor.js";
import { summarizeSlideCommentReactions } from "../shared/slide-comment-reactions.js";
import {
  hashSlideContent,
  slideFitMeasurementMatchesSlide,
  type DeckFitState,
} from "../shared/slide-fit.js";
import { currentSlideTextRangeSelection } from "../shared/slide-text-range-selection.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";
import getDeckTemplate from "./get-deck-template.js";
import getDesignSystem from "./get-design-system.js";
import listDeckTemplates from "./list-deck-templates.js";
import listSlideThemes from "./list-slide-themes.js";

type CurrentSlideFitMeasurement = DeckFitState["slides"][string] & {
  slideId: string;
};

function getSlideSourceIdentity(
  slide: {
    sourceTsx?: string;
    revision?: unknown;
    sourceHash?: unknown;
  } | null,
): { revision: number; sourceHash: string } | null {
  if (
    !slide ||
    typeof slide.sourceTsx !== "string" ||
    !slide.sourceTsx.trim()
  ) {
    return null;
  }

  const hasRevision = Object.hasOwn(slide, "revision");
  const hasSourceHash = Object.hasOwn(slide, "sourceHash");
  if (hasRevision !== hasSourceHash) return null;

  const revision = hasRevision ? slide.revision : 1;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return null;
  }

  const sourceHash = createHash("sha256")
    .update(slide.sourceTsx, "utf8")
    .digest("hex");
  if (hasSourceHash && slide.sourceHash !== sourceHash) return null;

  return { revision, sourceHash };
}

const CURRENT_SLIDE_COMMENT_LIMIT = 100;
const MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR = 8_000;

function getRenderedInstanceIdentity(
  item: Record<string, unknown>,
): { instanceIndex: number; instanceCount: number } | null {
  const instanceIndex = item.instanceIndex;
  const instanceCount = item.instanceCount;
  if (
    typeof instanceIndex !== "number" ||
    !Number.isSafeInteger(instanceIndex) ||
    typeof instanceCount !== "number" ||
    !Number.isSafeInteger(instanceCount) ||
    instanceIndex < 0 ||
    instanceCount < 1 ||
    instanceCount > MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR ||
    instanceIndex >= instanceCount
  ) {
    return null;
  }
  return { instanceIndex, instanceCount };
}

function getCurrentSlideFitMeasurement(
  value: unknown,
  slide: { id: string; content?: string; layoutFitRevision?: string } | null,
  deckId: string,
): CurrentSlideFitMeasurement | null {
  if (!slide || !value || typeof value !== "object") return null;

  const measurement = value as Record<string, unknown>;
  const slideId = measurement.slideId;
  const measurementDeckId = measurement.deckId;
  const contentHash = measurement.contentHash;
  const contentHeight = measurement.contentHeight;
  const contentWidth = measurement.contentWidth;
  const viewportHeight = measurement.viewportHeight;
  const viewportWidth = measurement.viewportWidth;
  const verticalOverflow = measurement.verticalOverflow;
  const horizontalOverflow = measurement.horizontalOverflow;
  const measuredAt = measurement.measuredAt;
  const layoutFitRevision = measurement.layoutFitRevision;

  if (
    typeof slideId !== "string" ||
    slideId !== slide.id ||
    (measurementDeckId !== undefined && measurementDeckId !== deckId) ||
    typeof contentHash !== "string" ||
    (layoutFitRevision !== undefined &&
      typeof layoutFitRevision !== "string") ||
    !slideFitMeasurementMatchesSlide(
      {
        contentHash,
        ...(typeof layoutFitRevision === "string" ? { layoutFitRevision } : {}),
      },
      slide,
    ) ||
    typeof contentHeight !== "number" ||
    !Number.isFinite(contentHeight) ||
    typeof contentWidth !== "number" ||
    !Number.isFinite(contentWidth) ||
    typeof viewportHeight !== "number" ||
    !Number.isFinite(viewportHeight) ||
    typeof viewportWidth !== "number" ||
    !Number.isFinite(viewportWidth) ||
    typeof verticalOverflow !== "number" ||
    !Number.isFinite(verticalOverflow) ||
    typeof horizontalOverflow !== "number" ||
    !Number.isFinite(horizontalOverflow) ||
    typeof measuredAt !== "number" ||
    !Number.isFinite(measuredAt)
  ) {
    return null;
  }

  return {
    slideId,
    contentHash,
    ...(typeof layoutFitRevision === "string" ? { layoutFitRevision } : {}),
    contentHeight,
    contentWidth,
    viewportHeight,
    viewportWidth,
    verticalOverflow,
    horizontalOverflow,
    measuredAt,
  };
}

export default defineAction({
  title: "Inspect current Slides 2 screen",
  description:
    "Inspect the current Slides 2 screen when the active deck, slide, selection, template, or slide theme is unknown. Returns the current deck and slide IDs, slide previews, current slide HTML, matching visual selection metadata, the template gallery, or the slide themes gallery and selected theme summary. For selectedText or objectId edits on legacy/imported HTML slides, use update-slide with the matching content hash. For React source-backed slides, never send selected text or objectId to update-slide: read get-slide-source and use update-slide-source with a unique locator grounded in the current source. Use a selection line/column only when its source identity is current; if the locator is missing or stale, remap only when the selected element maps uniquely, otherwise ask the user to reselect or clarify. Selected source objects include their rendered instance index and count; a count above one means the JSX source callsite is shared and duplicate/delete cannot target one rendered copy safely. A current selectedTextRange includes UTF-16 offsets and expectedText for update-slide-source set-text-range-style; pass expectedText as prevText. Do not load the full deck for focused edits.",
  schema: z.object({}),
  http: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (_args) => {
    const storedNavigation = await readAppStateForCurrentTab(
      appStateKey("navigation"),
      { fallbackToGlobal: true },
    );
    const navigation = (
      storedNavigation?.app === "slides-2" ? storedNavigation : null
    ) as {
      app?: "slides-2";
      view?: string;
      deckId?: string;
      templateId?: string;
      themeId?: string;
      search?: string;
      homeTab?: "recent" | "templates";
      deckSearch?: string;
      deckFilter?: "all" | "created-by-me" | "shared";
      slideId?: string | null;
      slideNumber?: number;
      slideIndex?: number;
      editorMode?: "edit" | "preview";
    } | null;
    const chatScope = getRequestRunContext()?.chatScope;
    const scopedDeckId =
      chatScope?.type === "deck" && typeof chatScope.id === "string"
        ? chatScope.id
        : null;
    const effectiveNavigation = scopedDeckId
      ? {
          ...(navigation ?? {}),
          view: "editor",
          deckId: scopedDeckId,
          slideId:
            navigation?.deckId === scopedDeckId ? navigation.slideId : null,
          slideNumber:
            navigation?.deckId === scopedDeckId
              ? navigation.slideNumber
              : undefined,
          slideIndex:
            navigation?.deckId === scopedDeckId ? navigation.slideIndex : 0,
          editorMode:
            navigation?.deckId === scopedDeckId
              ? navigation.editorMode
              : "edit",
        }
      : navigation;
    if (!scopedDeckId && navigation?.view === "themes") {
      const result = await listSlideThemes.run({});
      const selected = navigation.themeId
        ? result.themes.find((theme) => theme.id === navigation.themeId)
        : undefined;
      return [
        "## Current Screen",
        "view: themes",
        ...(selected
          ? [
              `themeId: ${selected.id}`,
              `themeName: ${selected.name}`,
              `themeDescription: ${JSON.stringify(selected.description)}`,
              `themeMode: ${selected.mode}`,
              `themePalette: background=${selected.preview.background}, text=${selected.preview.text}, accent=${selected.preview.accent}`,
            ]
          : []),
        "### Slide themes",
        ...result.themes.map(
          (theme) =>
            `- id=${theme.id} name=${JSON.stringify(theme.name)} mode=${theme.mode}`,
        ),
        "Use get-slide-theme to read a selected theme's full authoring guide.",
      ].join("\n");
    }
    if (
      !scopedDeckId &&
      (navigation?.view === "templates" || navigation?.templateId)
    ) {
      const result = await listDeckTemplates.run({
        search: navigation.search,
        page: 1,
        pageSize: 6,
        includePreview: "false",
      });
      const selected = navigation.templateId
        ? await getDeckTemplate.run({ id: navigation.templateId })
        : null;
      return [
        "## Current Screen",
        `view: ${navigation.view ?? "list"}`,
        ...(navigation.view === "list"
          ? [`homeTab: ${navigation.homeTab ?? "templates"}`]
          : []),
        `templateSearch: ${navigation.search ?? ""}`,
        ...(selected
          ? [
              `templateId: ${selected.id}`,
              `templateTitle: ${selected.title}`,
              `slideCount: ${selected.slideCount}`,
            ]
          : []),
        "### Templates",
        ...result.templates.map(
          (template) =>
            `- id=${template.id} title=${JSON.stringify(template.title)} slides=${template.slideCount}`,
        ),
        "Use get-deck-template to inspect a template, then create-deck-from-template to save an editable copy without AI generation.",
      ].join("\n");
    }
    if (
      !scopedDeckId &&
      navigation?.view !== "templates" &&
      navigation?.homeTab === "templates"
    ) {
      const result = await listDeckTemplates.run({
        page: 1,
        pageSize: 24,
        includePreview: "false",
      });
      return [
        "## Current Screen",
        "view: list",
        "homeTab: templates",
        `### Home templates (${result.templates.length} of ${result.total})`,
        ...result.templates.map(
          (template) =>
            `- id=${template.id} title=${JSON.stringify(template.title)} slides=${template.slideCount}`,
        ),
      ].join("\n");
    }
    const db = getDb();

    if (effectiveNavigation?.deckId) {
      const rows = await db
        .select()
        .from(schema.decks)
        .where(
          and(
            eq(schema.decks.id, effectiveNavigation.deckId),
            accessFilter(schema.decks, schema.deckShares),
          ),
        )
        .limit(1);

      if (rows.length === 0 || !isSlides2DeckData(rows[0].data)) {
        return [
          `view: ${effectiveNavigation.view ?? "editor"}`,
          `deckId: ${effectiveNavigation.deckId}  (NOT FOUND in database — the deck may have just been created and not yet persisted)`,
          "",
          "Wait a moment and call view-screen again, or list-decks to see what's available.",
        ].join("\n");
      }

      const deck = JSON.parse(rows[0].data);
      const slides: Array<{
        id: string;
        layout?: string;
        content?: string;
        sourceTsx?: string;
        revision?: unknown;
        sourceHash?: unknown;
        background?: string;
        layoutFitRevision?: string;
      }> = Array.isArray(deck?.slides) ? deck.slides : [];
      const navigationSlideIndex = effectiveNavigation.slideId
        ? slides.findIndex((slide) => slide.id === effectiveNavigation.slideId)
        : -1;
      const slideIndex =
        navigationSlideIndex >= 0
          ? navigationSlideIndex
          : typeof effectiveNavigation.slideIndex === "number"
            ? effectiveNavigation.slideIndex
            : typeof effectiveNavigation.slideNumber === "number" &&
                Number.isFinite(effectiveNavigation.slideNumber) &&
                effectiveNavigation.slideNumber >= 1
              ? effectiveNavigation.slideNumber - 1
              : 0;
      const slideNumber = slideIndex + 1;
      const currentSlide = slides[slideIndex] ?? null;

      const lines: string[] = [];
      lines.push(`## Current Screen`);
      lines.push(``);
      lines.push(`view: ${effectiveNavigation.view ?? "editor"}`);
      if (
        effectiveNavigation.view === undefined ||
        effectiveNavigation.view === "editor"
      ) {
        lines.push(
          `editorMode: ${effectiveNavigation.editorMode === "preview" ? "preview" : "edit"}`,
        );
      }
      lines.push(
        `deckId: ${rows[0].id}            ← use this as deckId for add-slide / update-slide / create-deck, and as id for get-deck`,
      );
      lines.push(`deckTitle: ${rows[0].title ?? deck?.title ?? "(untitled)"}`);
      lines.push(`slideCount: ${slides.length}`);
      lines.push(
        `slideNumbering: User-visible slide numbers are 1-based and match the UI. "Slide 1" means the first slide, not internal index 1. Use slideId for edits.`,
      );
      lines.push(
        `currentSlideNumber: ${slideNumber} of ${slides.length}   (1-based; matches the UI)`,
      );
      lines.push(
        `currentSlideIndex: ${slideIndex}   (0-based internal value only; do not use this to interpret "slide N" from the user)`,
      );
      if (currentSlide) {
        const sourceBacked = typeof currentSlide.sourceTsx === "string";
        lines.push(
          `currentSlideId: ${currentSlide.id}   ← use this for ${sourceBacked ? "update-slide-source --slideId" : "update-slide --slideId"}`,
        );
        lines.push(`currentSlideLayout: ${currentSlide.layout ?? "(none)"}`);
        lines.push(
          sourceBacked
            ? `currentSlideContentHash: ${hashSlideContent(String(currentSlide.content ?? ""))}   (preview hash only; read get-slide-source for the revision and sourceHash used by update-slide-source)`
            : `currentSlideContentHash: ${hashSlideContent(String(currentSlide.content ?? ""))}   ← baseContentHash for update-slide`,
        );
      } else {
        lines.push(
          `currentSlideId: (no slide for slide number ${slideNumber} / internal index ${slideIndex} — deck may be empty)`,
        );
      }
      lines.push(``);
      lines.push(`### All slides in this deck (${slides.length})`);
      if (slides.length === 0) {
        lines.push(`(empty — use add-slide to add slides)`);
      } else {
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const marker = i === slideIndex ? " ◀ current" : "";
          const contentPreview =
            typeof s.content === "string"
              ? s.content
                  .replace(/<[^>]+>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 60)
              : "";
          lines.push(
            `Slide ${i + 1}. id=${s.id}  internalIndex=${i}  layout=${s.layout ?? "-"}  "${contentPreview}"${marker}`,
          );
        }
      }
      const { deckStyle, representativeSlideIndex } = summarizeDeckStyle(
        slides,
        slideIndex,
      );
      const designSystem = await loadAgentDesignSystemContext(
        resolveDeckDesignSystemId(rows[0], deck),
        getDesignSystem,
      );
      if (deckStyle.length > 0 || representativeSlideIndex !== null) {
        lines.push(``);
        lines.push(`### Deck style (shared across slides)`);
        lines.push(...deckStyle);
        if (representativeSlideIndex !== null) {
          const sibling = slides[representativeSlideIndex]!;
          lines.push(
            `representativeSlide: id=${sibling.id} (slide ${representativeSlideIndex + 1}, layout=${sibling.layout ?? "-"})   ← before a style or layout change, read it with get-deck { id: deckId, slideId: "${sibling.id}", compact: "false" } and mirror its structure and values`,
          );
        }
      }
      if (designSystem) {
        lines.push("", ...formatAgentDesignSystemContext(designSystem));
      }
      const designSystemPreset = getPreset(
        typeof deck?.designSystemId === "string"
          ? deck.designSystemId
          : "default",
      );
      const storedTweaks =
        typeof deck?.tweaks === "object" &&
        deck.tweaks !== null &&
        !Array.isArray(deck.tweaks)
          ? (deck.tweaks as Record<string, string | number | boolean>)
          : {};
      lines.push(
        "",
        "### Deck style controls",
        `designSystemPreset: ${designSystemPreset.name} (${designSystemPreset.id})`,
        `storedTweaks: ${JSON.stringify(storedTweaks)}`,
      );
      for (const tweak of designSystemPreset.tweaks) {
        const currentValue = storedTweaks[tweak.id] ?? tweak.defaultValue;
        const choices = tweak.options?.length
          ? tweak.options
              .map(
                (option) => `${JSON.stringify(option.value)} (${option.label})`,
              )
              .join(", ")
          : tweak.type === "toggle"
            ? "true, false"
            : tweak.type === "slider"
              ? "finite numbers"
              : "(none)";
        lines.push(
          `- ${tweak.id} (${tweak.label}): current=${JSON.stringify(currentValue)}; choices=${choices}`,
        );
      }
      lines.push(
        "Change these with patch-deck-fields.fields.tweaks; include the complete storedTweaks map and use exact listed choices.",
      );
      if (currentSlide?.content) {
        lines.push(``);
        lines.push(
          `### Current slide HTML (slide ${slideNumber}, internal index ${slideIndex}, id ${currentSlide.id})`,
        );
        lines.push("```html");
        lines.push(currentSlide.content);
        lines.push("```");
      }

      const fetchedCommentRows = currentSlide
        ? await db
            .select({
              id: schema.slideComments.id,
              slideId: schema.slideComments.slideId,
              threadId: schema.slideComments.threadId,
              parentId: schema.slideComments.parentId,
              content: schema.slideComments.content,
              quotedText: schema.slideComments.quotedText,
              anchor: schema.slideComments.anchor,
              emojiReactionsJson: schema.slideComments.emojiReactionsJson,
              authorEmail: schema.slideComments.authorEmail,
              resolved: schema.slideComments.resolved,
              createdAt: schema.slideComments.createdAt,
            })
            .from(schema.slideComments)
            .where(
              and(
                eq(schema.slideComments.deckId, rows[0].id),
                eq(schema.slideComments.slideId, currentSlide.id),
              ),
            )
            .orderBy(asc(schema.slideComments.createdAt))
            .limit(CURRENT_SLIDE_COMMENT_LIMIT + 1)
        : [];
      const commentsTruncated =
        fetchedCommentRows.length > CURRENT_SLIDE_COMMENT_LIMIT;
      const commentRows = commentsTruncated
        ? fetchedCommentRows.slice(0, CURRENT_SLIDE_COMMENT_LIMIT)
        : fetchedCommentRows;
      lines.push(``);
      lines.push(
        `### Comments on current slide (${commentRows.length}${commentsTruncated ? "; more available" : ""})`,
      );
      if (commentsTruncated) {
        lines.push(
          `commentsStatus: truncated; showing the first ${CURRENT_SLIDE_COMMENT_LIMIT}. Use list-slide-comments with { deckId: "${rows[0].id}", slideId: "${currentSlide?.id}", limit: ${CURRENT_SLIDE_COMMENT_LIMIT}, offset: ${CURRENT_SLIDE_COMMENT_LIMIT} } to continue.`,
        );
      }
      if (commentRows.length === 0) {
        lines.push(`(no comments)`);
      } else {
        for (const comment of commentRows) {
          const anchor = parseSlideCommentAnchor(comment.anchor);
          const reactions = summarizeSlideCommentReactions(
            comment.emojiReactionsJson,
            getRequestUserEmail(),
          );
          lines.push(
            `commentId: ${comment.id}  threadId: ${comment.threadId}  parentId: ${comment.parentId ?? "(root)"}`,
          );
          lines.push(
            `author: ${comment.authorEmail}  resolved: ${comment.resolved ? "true" : "false"}  createdAt: ${comment.createdAt}`,
          );
          lines.push(`content: ${comment.content}`);
          if (comment.quotedText)
            lines.push(`quotedText: ${comment.quotedText}`);
          if (anchor) lines.push(`anchor: ${JSON.stringify(anchor)}`);
          if (reactions.length > 0) {
            lines.push(`reactions: ${JSON.stringify(reactions)}`);
          }
        }
      }

      const panels = (await readAppStateForCurrentTab(
        appStateKey("slides-panels"),
        {
          fallbackToGlobal: false,
        },
      )) as { layersOpen?: boolean; animationsOpen?: boolean } | null;
      const openPanels = [
        panels?.layersOpen ? "layers" : null,
        panels?.animationsOpen ? "animations" : null,
      ].filter(Boolean);
      lines.push(``);
      lines.push(`### Editor panels`);
      lines.push(
        panels
          ? `openPanels: ${openPanels.join(", ") || "none"}`
          : `openPanels: unknown`,
      );

      const editorStatusState = await readAppStateForCurrentTab(
        appStateKey(SLIDE_EDITOR_STATUS_KEY),
        { fallbackToGlobal: false },
      );
      const editorStatus = slideEditorStatusSchema.safeParse(editorStatusState);
      const currentEditorSourceIdentity = getSlideSourceIdentity(currentSlide);
      if (
        editorStatus.success &&
        currentSlide &&
        currentEditorSourceIdentity &&
        editorStatus.data.deckId === rows[0].id &&
        editorStatus.data.slideId === currentSlide.id &&
        editorStatus.data.sourceRevision ===
          currentEditorSourceIdentity.revision &&
        editorStatus.data.sourceHash === currentEditorSourceIdentity.sourceHash
      ) {
        lines.push(``);
        lines.push(`### Visual editor draft`);
        lines.push(`editorSessionId: ${editorStatus.data.editorSessionId}`);
        lines.push(`editorHistoryVersion: ${editorStatus.data.historyVersion}`);
        lines.push(
          `editorSavedSource: revision=${editorStatus.data.sourceRevision} hash=${editorStatus.data.sourceHash}`,
        );
        lines.push(
          `editorDraft: ${editorStatus.data.hasPendingEdits ? "pending edits" : "saved"}; canSave=${editorStatus.data.canSave}`,
        );
        lines.push(
          `editorHistoryControls: canUndo=${editorStatus.data.canUndo} canRedo=${editorStatus.data.canRedo}`,
        );
        const editorCommandState = await readAppStateForCurrentTab(
          appStateKey(SLIDE_EDITOR_COMMAND_KEY),
          { fallbackToGlobal: false },
        );
        const editorCommand =
          slideEditorCommandSchema.safeParse(editorCommandState);
        if (
          editorCommand.success &&
          editorCommand.data.deckId === editorStatus.data.deckId &&
          editorCommand.data.slideId === editorStatus.data.slideId &&
          editorCommand.data.editorSessionId ===
            editorStatus.data.editorSessionId &&
          (editorCommand.data.status !== "pending" ||
            (editorCommand.data.historyVersion ===
              editorStatus.data.historyVersion &&
              editorCommand.data.sourceRevision ===
                editorStatus.data.sourceRevision &&
              editorCommand.data.sourceHash === editorStatus.data.sourceHash))
        ) {
          lines.push(
            `lastEditorCommand: id=${editorCommand.data.commandId} operation=${editorCommand.data.operation} status=${editorCommand.data.status}` +
              (editorCommand.data.failureCode
                ? ` failure=${editorCommand.data.failureCode}`
                : ""),
          );
        }
      }

      const selection = (await readAppStateForCurrentTab(
        appStateKey("slides-selection"),
        { fallbackToGlobal: false },
      )) as {
        deckId?: string;
        slideId?: string;
        sourceRevision?: number;
        sourceHash?: string;
        mode?: string;
        activeTool?: string;
        textRange?: unknown;
        items?: Array<{
          selector?: string;
          runtimeSelector?: string;
          objectId?: string;
          text?: string;
          selectedText?: string;
          textTruncated?: boolean;
          kind?: string;
          tagName?: string;
          sourceLine?: number;
          sourceColumn?: number;
          sourceTag?: string;
          sourceText?: string;
          sourceStyle?: Record<string, unknown>;
          imageSrc?: string;
          videoSrc?: string;
          style?: Record<string, unknown>;
        }>;
      } | null;
      const openPanel = (await readAppStateForCurrentTab(
        appStateKey("slides-open-panel"),
        { fallbackToGlobal: false },
      )) as {
        deckId?: string;
        slideId?: string;
        panel?: string | null;
      } | null;
      if (
        openPanel?.panel &&
        openPanel.deckId === rows[0].id &&
        openPanel.slideId === currentSlide?.id
      ) {
        lines.push(``);
        lines.push(`### Open side panel`);
        lines.push(`openPanel: ${openPanel.panel}`);
      }
      const matchingSelectionSlides =
        selection?.deckId === rows[0].id && selection.slideId
          ? slides.filter((slide) => slide.id === selection.slideId)
          : [];
      const selectionSlide =
        matchingSelectionSlides.length === 1
          ? matchingSelectionSlides[0]
          : null;
      const selectionSourceIdentity = getSlideSourceIdentity(selectionSlide);
      const selectionSourceMatches = Boolean(
        selection &&
        selectionSourceIdentity &&
        selection.sourceRevision === selectionSourceIdentity.revision &&
        selection.sourceHash === selectionSourceIdentity.sourceHash,
      );
      const rangeTarget =
        selection?.items?.length === 1 &&
        typeof selection.items[0]?.sourceLine === "number" &&
        typeof selection.items[0]?.sourceColumn === "number"
          ? {
              line: selection.items[0].sourceLine,
              column: selection.items[0].sourceColumn,
            }
          : null;
      const selectedTextRange =
        selectionSourceMatches && selectionSlide && selectionSourceIdentity
          ? currentSlideTextRangeSelection(
              selection?.textRange,
              {
                slideId: selectionSlide.id,
                ...selectionSourceIdentity,
              },
              rangeTarget,
            )
          : null;
      if (selection && selectionSlide) {
        const sourceBackedSelection =
          typeof selectionSlide.sourceTsx === "string";
        lines.push(``);
        lines.push(`### Current visual selection`);
        if (typeof selectionSlide.sourceTsx === "string") {
          lines.push(
            `sourceSelectionStatus: ${selectionSourceMatches ? "current" : selectionSourceIdentity ? "stale or unverified" : "current source integrity could not be verified"}`,
          );
        }
        lines.push(
          `editorCurrentSlideId: ${selectionSlide.id}   ← authoritative slide recorded by the editor; use this for the next focused edit`,
        );
        lines.push(
          `selectionSlideId: ${selection.slideId}` +
            (selectionSlide.id === currentSlide?.id
              ? `   (matches currentSlideId)`
              : `   (differs from currentSlideId ${currentSlide?.id ?? "(none)"} — use selectionSlideId, the slide this selection was made on)`),
        );
        if (selectionSlide.id !== currentSlide?.id) {
          if (typeof selectionSlide.sourceTsx === "string") {
            lines.push(
              `selectionSlideSource: React source-backed; read get-slide-source for this slide before update-slide-source`,
            );
          } else {
            lines.push(
              `selectionSlideContentHash: ${hashSlideContent(String(selectionSlide.content ?? ""))}   ← use as baseContentHash with selectionSlideId`,
            );
          }
        }
        lines.push(`mode: ${selection.mode ?? "unknown"}`);
        lines.push(`activeTool: ${selection.activeTool ?? "select"}`);
        if (selectedTextRange) {
          lines.push(
            `selectedTextRange: source element at ${selectedTextRange.sourceLine}:${selectedTextRange.sourceColumn}; UTF-16 offsets [${selectedTextRange.start}, ${selectedTextRange.end}); expectedText=${JSON.stringify(selectedTextRange.expectedText)}`,
          );
          lines.push(
            `selectedTextRangeStatus: current; use update-slide-source with set-text-range-style at line=${selectedTextRange.sourceLine}, column=${selectedTextRange.sourceColumn}, start=${selectedTextRange.start}, end=${selectedTextRange.end}, and expectedText as prevText`,
          );
        }
        if (Array.isArray(selection.items) && selection.items.length > 0) {
          for (const [index, item] of selection.items.entries()) {
            if (
              typeof item.sourceLine === "number" &&
              Number.isInteger(item.sourceLine) &&
              item.sourceLine >= 1
            ) {
              const sourceColumn =
                typeof item.sourceColumn === "number" &&
                Number.isInteger(item.sourceColumn) &&
                item.sourceColumn >= 0
                  ? item.sourceColumn
                  : 0;
              lines.push(
                `selected ${index + 1}: source element <${typeof item.sourceTag === "string" ? item.sourceTag : "element"}> at ${item.sourceLine}:${sourceColumn}`,
              );
              const renderedInstance = getRenderedInstanceIdentity(item);
              if (renderedInstance) {
                lines.push(
                  `renderedInstance: ${renderedInstance.instanceIndex + 1} of ${renderedInstance.instanceCount}`,
                );
                if (renderedInstance.instanceCount > 1) {
                  lines.push(
                    `sourceCallsiteStatus: shared across ${renderedInstance.instanceCount} visible instances; duplicate/delete cannot target one rendered copy safely and will be rejected`,
                  );
                }
              } else {
                lines.push(
                  "sourceCallsiteStatus: rendered instance metadata is unavailable; duplicate/delete require a fresh editor selection",
                );
              }
              if (typeof item.sourceText === "string") {
                lines.push(
                  `sourceTextPreview: ${JSON.stringify(item.sourceText)}`,
                );
              }
              lines.push(
                selectionSourceMatches
                  ? `sourceTargetStatus: use get-slide-source, then update-slide-source with line=${item.sourceLine}, column=${sourceColumn}; the selection revision and source hash match the current source, and sourceTextPreview is not an exact browser-range selection`
                  : `sourceTargetStatus: the selection source identity is stale or unavailable; do not apply this line and column directly. Reselect the element or inspect the current source with get-slide-source`,
              );
              if (
                item.sourceStyle &&
                typeof item.sourceStyle === "object" &&
                !Array.isArray(item.sourceStyle)
              ) {
                lines.push(`sourceStyle: ${JSON.stringify(item.sourceStyle)}`);
              }
              continue;
            }
            const isImageSelection =
              item.kind === "image" || item.tagName?.toLowerCase() === "img";
            const isVideoSelection =
              item.kind === "video" || item.tagName?.toLowerCase() === "video";
            lines.push(
              `selected ${index + 1}: ${item.kind ?? "element"} ${item.tagName ?? ""} selector=${item.selector ?? "(none)"}`,
            );
            if (item.objectId && !isImageSelection) {
              lines.push(`objectId: ${item.objectId}`);
              lines.push(
                sourceBackedSelection
                  ? "objectIdStatus: React source-backed slide; do not use objectId with update-slide. Read get-slide-source and map the element to a unique source locator for update-slide-source, or reselect/clarify if ambiguous"
                  : "objectIdStatus: stable selected-element target on a legacy/imported HTML slide; use it with one update-slide replace edit when selectedText is unavailable",
              );
            }
            if (item.runtimeSelector) {
              lines.push(`runtimeSelector: ${item.runtimeSelector}`);
            }
            if (item.selectedText) {
              lines.push(`selectedText: ${item.selectedText}`);
              lines.push(
                sourceBackedSelection
                  ? "selectedTextStatus: React source-backed slide; read get-slide-source and map this text to a unique source locator for update-slide-source, or reselect/clarify if ambiguous"
                  : "selectedTextStatus: exact browser range on a legacy/imported HTML slide; use verbatim as edits.find with expectedMatches: 1",
              );
            }
            if (isImageSelection) {
              lines.push(
                "imageStatus: image selection has no editable text content; use the targeted image/markup workflow",
              );
            } else if (isVideoSelection) {
              lines.push(
                sourceBackedSelection
                  ? "videoStatus: React source-backed slide; read get-slide-source and edit through update-slide-source only when the source target is unique, otherwise reselect/clarify"
                  : "videoStatus: legacy/imported HTML video selection has no editable text content; use update-slide to change its source or playback attributes",
              );
            } else if (item.text) {
              lines.push(`text: ${item.text}`);
              if (!item.selectedText) {
                lines.push(
                  sourceBackedSelection
                    ? "textStatus: React source-backed element preview; read get-slide-source and map it to a unique JSX source locator for update-slide-source, or reselect/clarify if ambiguous"
                    : item.objectId
                      ? "textStatus: element preview is not an exact browser-range selection; use objectId with update-slide for an element-only replacement"
                      : item.textTruncated === true
                        ? `textStatus: element preview may be truncated; use get-deck with slideId=${selectionSlide.id} before editing`
                        : item.textTruncated === false
                          ? `textStatus: element text is complete but is not an exact browser-range selection; use get-deck with slideId=${selectionSlide.id} before editing`
                          : `textStatus: element preview status unknown; use get-deck with slideId=${selectionSlide.id} before editing`,
                );
              } else {
                lines.push(
                  sourceBackedSelection
                    ? "textStatus: React source-backed selection; read get-slide-source and map the text to a unique JSX source locator for update-slide-source, or reselect/clarify if ambiguous"
                    : "textStatus: element preview; use selectedText for a literal replacement",
                );
              }
            }
            if (item.imageSrc) lines.push(`imageSrc: ${item.imageSrc}`);
            if (item.videoSrc) lines.push(`videoSrc: ${item.videoSrc}`);
            if (item.style) {
              lines.push(`style: ${JSON.stringify(item.style)}`);
            }
          }
        } else {
          lines.push(`(no selected elements)`);
        }
      }

      const currentSlideMeasurement = getCurrentSlideFitMeasurement(
        await readAppStateForCurrentTab(appStateKey("slide-fit-check")),
        currentSlide,
        rows[0].id,
      );
      const verticalOverflow = currentSlideMeasurement?.verticalOverflow ?? 0;
      const horizontalOverflow =
        currentSlideMeasurement?.horizontalOverflow ?? 0;
      if (
        currentSlideMeasurement &&
        (verticalOverflow > 0 || horizontalOverflow > 0)
      ) {
        lines.push(``);
        lines.push(`### ⚠ Layout overflows the canvas`);
        lines.push(
          `This slide's natural rendered content is ${currentSlideMeasurement.contentWidth}x${currentSlideMeasurement.contentHeight}px, ` +
            `but the canvas content area is ${currentSlideMeasurement.viewportWidth}x${currentSlideMeasurement.viewportHeight}px ` +
            `(overflow: ${verticalOverflow}px vertical, ${horizontalOverflow}px horizontal). The renderer no longer ` +
            `auto-shrinks overflowing slides — you must rewrite the slide HTML so ` +
            `the rendered content fits the measured content area. Options, ` +
            `in order of preference: (1) tighten copy — shorter headings/bullets, ` +
            `drop low-value lines; (2) reduce vertical density — fewer stacked ` +
            `cards, smaller gaps, slightly smaller body font (not below 16px); ` +
            `(3) reduce slide padding (e.g. 40px top/bottom); (4) split the ` +
            `content across two slides if it genuinely cannot be compressed. ` +
            `Do not solve this with transform: scale, overflow: scroll, or ` +
            `absolute positioning — only the HTML shape can fix it now.`,
        );
      }

      const deckFit = (await readAppStateForCurrentTab(
        appStateKey("deck-fit-checks"),
      )) as DeckFitState | null;
      if (
        deckFit?.deckId === rows[0].id &&
        deckFit.aspectRatio === (deck.aspectRatio ?? "16:9") &&
        deckFit.slides
      ) {
        type DeckFitSummary =
          | { kind: "unknown"; index: number }
          | {
              kind: "overflow";
              index: number;
              measurement: (typeof deckFit.slides)[string];
            };
        const measured: DeckFitSummary[] = slides.flatMap(
          (slide, index): DeckFitSummary[] => {
            const measurement =
              slide.id === currentSlideMeasurement?.slideId
                ? currentSlideMeasurement
                : deckFit.slides[slide.id];
            if (
              !measurement ||
              !slideFitMeasurementMatchesSlide(measurement, slide) ||
              !Number.isFinite(measurement.verticalOverflow) ||
              !Number.isFinite(measurement.horizontalOverflow) ||
              !Number.isFinite(measurement.contentHeight) ||
              !Number.isFinite(measurement.contentWidth) ||
              !Number.isFinite(measurement.viewportHeight) ||
              !Number.isFinite(measurement.viewportWidth) ||
              !Number.isFinite(measurement.measuredAt)
            ) {
              return [{ kind: "unknown" as const, index }];
            }
            return measurement.verticalOverflow > 0 ||
              measurement.horizontalOverflow > 0
              ? [{ kind: "overflow" as const, index, measurement }]
              : [];
          },
        );
        const unknown = measured.filter((item) => item.kind === "unknown");
        const overflows = measured.filter((item) => item.kind === "overflow");
        lines.push(``);
        lines.push(`### Deck-wide layout fit`);
        if (unknown.length > 0) {
          lines.push(
            `Measured ${slides.length - unknown.length} of ${slides.length} slides; ` +
              `the remaining slides need a fresh browser measurement before claiming the deck fits.`,
          );
        } else if (overflows.length > 0) {
          lines.push(
            `Overflow detected on ${overflows.length} slide(s): ${overflows
              .map((item) => {
                if (item.kind !== "overflow") return "";
                return `slide ${item.index + 1} (${item.measurement.verticalOverflow}px vertical, ${item.measurement.horizontalOverflow}px horizontal)`;
              })
              .join(", ")}.`,
          );
        } else {
          lines.push(
            `All ${slides.length} slides fit their measured content area.`,
          );
        }
      }

      return lines.join("\n");
    }

    const rows = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        ownerEmail: schema.decks.ownerEmail,
      })
      .from(schema.decks)
      .where(
        and(accessFilter(schema.decks, schema.deckShares), slides2DeckScope),
      )
      .orderBy(desc(schema.decks.updatedAt));

    const normalizedUserEmail = normalizeOwnerEmail(getRequestUserEmail());
    const homeTab =
      navigation?.homeTab === "templates" ? "templates" : "recent";
    const deckFilter = navigation?.deckFilter ?? "all";
    const normalizedDeckSearch =
      homeTab === "recent" && typeof navigation?.deckSearch === "string"
        ? navigation.deckSearch.trim().toLowerCase()
        : "";
    const filteredRows = rows.filter((row) => {
      if (deckFilter !== "all") {
        if (normalizedUserEmail === null) return false;
        const isOwnedByCurrentUser =
          normalizeOwnerEmail(row.ownerEmail) === normalizedUserEmail;
        if (
          (deckFilter === "created-by-me" && !isOwnedByCurrentUser) ||
          (deckFilter === "shared" && isOwnedByCurrentUser)
        ) {
          return false;
        }
      }
      return (
        !normalizedDeckSearch ||
        (row.title ?? "").toLowerCase().includes(normalizedDeckSearch)
      );
    });
    const lines: string[] = [];
    lines.push(`## Current Screen`);
    lines.push(``);
    lines.push(`view: ${effectiveNavigation?.view ?? "list"}`);
    lines.push(`No deck currently open. User is on the deck list.`);
    lines.push(`homeTab: ${homeTab}`);
    if (normalizedDeckSearch) {
      lines.push(`deckSearch: ${navigation?.deckSearch ?? ""}`);
    }
    lines.push(
      `deckFilter: ${
        deckFilter === "created-by-me"
          ? "created by me"
          : deckFilter === "shared"
            ? "shared with me"
            : "all accessible decks"
      }`,
    );
    lines.push(``);
    lines.push(
      deckFilter === "created-by-me"
        ? `### Decks created by current user (${filteredRows.length} of ${rows.length})`
        : deckFilter === "shared"
          ? `### Decks shared with current user (${filteredRows.length} of ${rows.length})`
          : `### All decks (${filteredRows.length} of ${rows.length})`,
    );
    if (filteredRows.length === 0) {
      lines.push(
        deckFilter === "all" && !normalizedDeckSearch
          ? `(no decks — use create-deck to make one)`
          : `(no decks match the current Home filters)`,
      );
    } else {
      for (const row of filteredRows) {
        lines.push(`- id=${row.id}  title="${row.title ?? "(untitled)"}"`);
      }
      lines.push(``);
      lines.push(
        `(slide counts omitted here for performance — call list-decks or open a deck to see slide content)`,
      );
    }
    return lines.join("\n");
  },
});
