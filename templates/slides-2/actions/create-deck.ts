import { defineAction, embedApp, fail } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import {
  recordGenerationCreativeContext,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextElementProvenance } from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import {
  HYGIENE_ACTION_DESCRIPTION,
  slideHygieneResult,
} from "../server/lib/slide-hygiene.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "../server/lib/slide-source-limits.js";
import { splitSlideSourcePages } from "../server/lib/slide-source.js";
import { trackSlides } from "../server/lib/slides-tracking.js";
import {
  resolveDefaultDesignSystemId,
  resolveDesignSystemIdByTitle,
} from "../server/workspace-defaults.js";
import {
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
} from "../shared/action-ui.js";
import { appStateKey } from "../shared/app-state-tabs.js";
import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
import {
  assertHumanReadableDeckTitle,
  repairGeneratedDeckTitle,
} from "../shared/deck-title.js";
import { generationTimingFields } from "../shared/generation-timing.js";
import {
  ensureUniqueSlideIds,
  rebindCreativeContextSlideLabels,
} from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import { trackDeckCreationStarted } from "./_deck-tracking.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { assertNoDeckRenderArtifacts } from "./_render-artifacts.js";
import {
  assertSourceBackedSlidesUnchanged,
  compileSlideSource,
} from "./_slide-source.js";
import { writeAppStateForCurrentTab } from "./_tab-state.js";
import getDesignSystem from "./get-design-system.js";

const ReuseLabelSchema = z
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

const SlideSchema = z
  .object({
    id: z.string().describe("Unique slide ID, e.g. 'slide-1'"),
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
        "Default-exported React component for this slide; imports are limited to React and named @open-slide/core primitives; use static local CSS and uploaded image or MP4/WebM asset:// handles. Find videos with `list-assets` using media set to `video` or `all`.",
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
    notes: z.string().optional().describe("Speaker notes for this slide"),
    creativeContextReuseLabels: z
      .array(ReuseLabelSchema)
      .optional()
      .describe("Exact context item versions that influenced this slide"),
  })
  .superRefine(({ content, sourceTsx }, context) => {
    if ((content === undefined) === (sourceTsx === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["sourceTsx"],
        message: "Pass exactly one of sourceTsx or legacy content.",
      });
    }
  });

const SlidesSchema = z.preprocess(
  (v) => (v === undefined ? [] : typeof v === "string" ? JSON.parse(v) : v),
  z.array(SlideSchema),
);

const PromptDraftSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("Stable client-generated ID for this prompt-first draft"),
  designSystemId: z
    .string()
    .nullable()
    .describe("Selected design-system ID, or null when none was selected"),
  generationContext: z
    .object({
      originalPrompt: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          url: z.string().optional(),
          originalName: z.string(),
          type: z.string(),
        }),
      ),
      designSystemId: z.string().nullable(),
      referenceDeckId: z.string().nullable(),
      mode: z.literal("new"),
      generationAttemptId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      generationStartedAt: z.number().nonnegative(),
    })
    .passthrough()
    .describe("The initial prompt and reference context saved with the draft"),
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function promptDraftConflict(): never {
  fail("This prompt draft ID is already in use.", {
    errorCode: "deck_create_conflict",
    statusCode: 409,
  });
}

function promptDraftMatches(
  row: typeof schema.decks.$inferSelect,
  expected: {
    id: string;
    ownerEmail: string;
    orgId: string | null | undefined;
    title: string;
    designSystemId: string | undefined;
    aspectRatio: string | undefined;
    generationContext: Record<string, unknown>;
  },
): boolean {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    // coercion-ok: malformed stored data cannot match the expected prompt draft; false leads to a conflict instead of reusing it.
    return false;
  }

  return (
    row.id === expected.id &&
    row.ownerEmail === expected.ownerEmail &&
    (row.orgId ?? null) === (expected.orgId ?? null) &&
    row.title === expected.title &&
    (row.designSystemId ?? null) === (expected.designSystemId ?? null) &&
    data.appId === "slides-2" &&
    data.title === expected.title &&
    Array.isArray(data.slides) &&
    data.slides.length === 0 &&
    (data.designSystemId ?? null) === (expected.designSystemId ?? null) &&
    (data.aspectRatio ?? null) === (expected.aspectRatio ?? null) &&
    stableJson(data.generationContext) ===
      stableJson(expected.generationContext)
  );
}

type PersistedDeckWrite = Pick<
  typeof schema.decks.$inferSelect,
  | "id"
  | "title"
  | "data"
  | "designSystemId"
  | "ownerEmail"
  | "orgId"
  | "updatedAt"
>;

function persistedDeckWriteColumns() {
  return {
    id: schema.decks.id,
    title: schema.decks.title,
    data: schema.decks.data,
    designSystemId: schema.decks.designSystemId,
    ownerEmail: schema.decks.ownerEmail,
    orgId: schema.decks.orgId,
    updatedAt: schema.decks.updatedAt,
  };
}

function assertPersistedDeckWrite(
  persisted: PersistedDeckWrite | undefined,
  expected: PersistedDeckWrite,
  operation: string,
): void {
  if (
    !persisted ||
    persisted.id !== expected.id ||
    persisted.title !== expected.title ||
    persisted.data !== expected.data ||
    (persisted.designSystemId ?? null) !== (expected.designSystemId ?? null) ||
    persisted.ownerEmail !== expected.ownerEmail ||
    (persisted.orgId ?? null) !== (expected.orgId ?? null) ||
    persisted.updatedAt !== expected.updatedAt
  ) {
    fail(
      `Database did not return the expected persisted deck after ${operation}.`,
      {
        errorCode: "deck_persistence_unverified",
        statusCode: 503,
      },
    );
  }
}

function expandSourcePageArrays(slides: z.infer<typeof SlidesSchema>) {
  return slides.flatMap((slide) => {
    if (slide.sourceTsx === undefined) return [slide];
    const pageSources = splitSlideSourcePages(slide.sourceTsx);
    const { notes, ...sharedFields } = slide;
    if (pageSources.length === 1) {
      const page = pageSources[0]!;
      return [
        {
          ...sharedFields,
          sourceTsx: page.sourceTsx,
          ...(page.notes !== undefined
            ? { notes: page.notes }
            : notes !== undefined
              ? { notes }
              : {}),
        },
      ];
    }

    return pageSources.map((page, index) => ({
      ...sharedFields,
      id: index === 0 ? slide.id : `${slide.id}-page-${index + 1}`,
      sourceTsx: page.sourceTsx,
      ...(page.notes !== undefined
        ? { notes: page.notes }
        : index === 0 && notes !== undefined
          ? { notes }
          : {}),
    }));
  });
}

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides-2",
    view: "editor",
    params: { deckId },
  });
}

function deckNavigationCommand(deckId: string): Record<string, string> {
  return {
    app: "slides-2",
    view: "editor",
    deckId,
    _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

function createGenerationAttemptId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `slides-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function generationTerminalEvent(signal?: AbortSignal): {
  name: "generation_failed" | "generation_stuck" | "generation_cancelled";
  outcome: "failed" | "stuck" | "cancelled";
  failure_code: string;
} {
  if (!signal?.aborted) {
    return {
      name: "generation_failed",
      outcome: "failed",
      failure_code: "action_error",
    };
  }

  const reason =
    typeof signal.reason === "string"
      ? signal.reason
      : signal.reason instanceof Error
        ? signal.reason.name
        : "";
  if (/cancel/i.test(reason)) {
    return {
      name: "generation_cancelled",
      outcome: "cancelled",
      failure_code: "cancelled",
    };
  }
  if (/stuck|timeout|no_progress/i.test(reason)) {
    return {
      name: "generation_stuck",
      outcome: "stuck",
      failure_code: "stuck",
    };
  }
  return {
    name: "generation_cancelled",
    outcome: "cancelled",
    failure_code: "cancelled",
  };
}

export default defineAction({
  title: "Create Slides 2 deck",
  description:
    "Create an editable Slides 2 deck, optionally already populated with slides, or atomically replace all slides in an existing deck. For generated slides, pass one default-exported React component in each `slides[].sourceTsx`; a static `export default [Cover, Body] satisfies Page[]` is also split into one source-backed slide per local component (up to 40 pages). An index-aligned static `export const notes = [...]` is copied into each page's presenter notes, and static `Cover.transition = {...}` overrides are preserved per page over the module `transition` default. Source is validated and stored in SQL; the opaque Worker runtime derives rendered HTML for the editor and presenter. The Slides 2 editor's browser PDF export renders that Worker artifact in the sandbox. Server PPTX export attempts bounded static rendering for source slides without a saved preview; sources requiring Worker rendering return `source_runtime_export_required` before a file is created. Server HTML/Google Slides exports and the shared PresentationView PDF path still need static HTML previews and return that error when a source slide has no preview. React and the eleven Worker-supported named `@open-slide/core` values are supported: `CANVAS_WIDTH`, `CANVAS_HEIGHT`, `defaultDesign`, `designToCssVars`, `cssVarsToString`, `Step`, `Steps`, `useSlidePageNumber`, `useIsActivePage`, `ImagePlaceholder`, and `MorphElement`. `cssVarsToString` serializes a bounded safe custom-property map to text and does not enable runtime CSS injection. Static `design`, `meta`, and validated `transition` exports are supported. Use inline styles or static CSS strings in local `style`/`css`/`keyframe` constants; CSS is sanitized and scoped, and Tailwind classes have no stylesheet in the frame. Do not use arbitrary imports, browser globals, event handlers, remote CSS/fonts, or external URLs. Images and videos use uploaded `asset://` handles only. Call `list-assets` with `media` set to `video` or `all` to find uploaded MP4/WebM videos; it defaults to images. Use the returned `assetId` as the React `<video>` source, and an uploaded image handle for an optional poster. For an existing source-backed slide, read it with `get-slide-source`, save with `update-slide-source` using its revision and sourceHash, then read it back; do not change generated slide source through `slides[].content`. `slides[].content` is for imported or legacy HTML and the derived static preview only. " +
    "When all pages are authored before persistence, pass the full ordered deck in this call so it is saved atomically in any host. For genuinely live in-app generation, create the deck with slides: [], then add each page sequentially with add-slide; pass generationComplete=false on intermediate writes and true on the final write of an action-owned generation. The final write persists completion so later additions are ordinary edits. Use patch-deck for deck structure, and never issue parallel writes to the same deck. " +
    "Home's prompt-first flow may pass promptDraft to persist its stable empty draft with the original prompt and reference context before dispatching generation; retrying that ID is safe only while the same owner's initial draft fields still match. " +
    "Pass presenter-only speaker notes in each slide's `notes` field; keep them out of slide HTML. " +
    "Pass deckId to replace an existing deck. " +
    "Returns the deck id, title, effective designSystemId, linked designSystem.agentContext when readable, slide count, persistenceStatus, and postProcessStatus. persistenceStatus is verified only after SQL RETURNING confirms the stored row. A failed post-process then means the SQL write was verified; read the deck and use navigate if needed instead of creating it again. The action resolves and attaches the effective default; use design-system context available before this call to author its slides, and use returned agentContext before adding slides in the empty-deck workflow. After all slide writes, call get-layout-overflows once for final verification and once more only after a repair, then audit-contrast once for the slides created or changed (again only after a repair). If measurements are unknown, report the unmeasured slides and wait for a new editor measurement before checking again. Every generated source component should render a complete 1920×1080 composition with a clear type hierarchy, intentional alignment, readable contrast, and at least one visual or structural treatment beyond plain text. If no design system is linked, choose and record one subject-appropriate deck-level visual contract with semantic --deck-* values, then reuse its canvas, type, spacing, surface, and accent tokens across every slide; vary composition instead of alternating themes or using a stock provider/brand palette." +
    HYGIENE_ACTION_DESCRIPTION,
  schema: z.object({
    title: z.string().describe("Deck title"),
    slides: SlidesSchema.describe(
      "Array of slides with id and exactly one of sourceTsx (generated React component or static Page[] module) or content (legacy/import HTML), optional layout, and presenter-only notes. React source supports bounded Worker rendering with the supported page primitives; read the create-deck skill for the exact syntax and CSS limits.",
    ),
    deckId: z
      .string()
      .optional()
      .describe(
        "If provided, update this existing deck instead of creating a new one",
      ),
    promptDraft: PromptDraftSchema.optional().describe(
      "Home-only prompt-first draft bootstrap. Requires a new deck with no slides; retries reuse the ID only when the persisted owner and initial fields match.",
    ),
    generationAttemptId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional()
      .describe(
        "Browser-owned generation attempt ID; only joins an existing deck when it exactly matches that deck's persisted generationContext",
      ),
    aspectRatio: z
      .enum(ASPECT_RATIO_VALUES)
      .optional()
      .describe(
        "Slide aspect ratio for the deck (defaults to 16:9 when omitted)",
      ),
    designSystemId: z
      .string()
      .optional()
      .describe(
        "Optional design system ID to link to the deck; omit to use your default, or pass its exact title as `designSystem` instead.",
      ),
    designSystem: z
      .string()
      .optional()
      .describe(
        "Exact title of an accessible design system to link (case-insensitive, whitespace-trimmed); resolved server-side. Use designSystemId when you already have the id; the id wins if both are given.",
      ),
    contextPackId: z
      .string()
      .optional()
      .describe("Immutable pack returned by pre-generation context search"),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this deck generation only without changing the saved preference.",
      ),
    reuseLabels: z
      .array(ReuseLabelSchema)
      .optional()
      .default([])
      .describe("Deck-wide exact context item versions used"),
  }),
  chatUI: {
    renderer: SLIDES_DECK_RESULT_RENDERER,
    when: (_args, result) => projectSlidesDeckResult(result) !== null,
    projectResult: (_args, result) => projectSlidesDeckResult(result),
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck preview",
      description: "Open the generated deck in the Slides 2 editor.",
      iframeTitle: "Agent-Native Slides 2",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  retrySafe: (input) => input.promptDraft !== undefined,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (
    {
      title,
      slides: rawSlides,
      deckId,
      promptDraft,
      generationAttemptId: browserGenerationAttemptId,
      aspectRatio,
      designSystemId: explicitDesignSystemId,
      designSystem,
      contextPackId,
      contextModeOverride,
      reuseLabels,
    },
    ctx,
  ) => {
    if (
      promptDraft &&
      (deckId ||
        browserGenerationAttemptId !== undefined ||
        rawSlides.length > 0)
    ) {
      fail(
        "promptDraft is only valid for a new empty deck without generationAttemptId.",
        { statusCode: 400 },
      );
    }
    if (
      promptDraft &&
      promptDraft.designSystemId !==
        promptDraft.generationContext.designSystemId
    ) {
      fail("promptDraft designSystemId must match its generationContext.", {
        statusCode: 400,
      });
    }
    const generationAttemptId =
      promptDraft?.generationContext.generationAttemptId ??
      browserGenerationAttemptId ??
      createGenerationAttemptId();
    const actionOwnsGenerationLifecycle =
      browserGenerationAttemptId === undefined && promptDraft === undefined;
    const generationStartedAt = Date.now();
    let generationOutputId = deckId;
    const db = getDb();
    let browserOwnedDeck: typeof schema.decks.$inferSelect | undefined;
    if (deckId) {
      await assertAccess("deck", deckId, "editor");
      const existing = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      browserOwnedDeck = existing[0];
      if (!browserOwnedDeck)
        fail(`Deck not found: ${deckId}`, {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      const existingData = JSON.parse(browserOwnedDeck.data);
      assertSlides2DeckData(existingData);
      if (browserGenerationAttemptId !== undefined) {
        const persistedAttemptId = (
          existingData as {
            generationContext?: { generationAttemptId?: string };
          }
        ).generationContext?.generationAttemptId;
        if (persistedAttemptId !== browserGenerationAttemptId) {
          fail(
            "generationAttemptId does not match the deck's persisted generationContext",
            { errorCode: "generation_attempt_conflict", statusCode: 409 },
          );
        }
      }
    } else if (browserGenerationAttemptId !== undefined) {
      fail("generationAttemptId requires a matching existing deck", {
        errorCode: "generation_attempt_deck_required",
        statusCode: 400,
      });
    }
    const now = new Date().toISOString();
    const sourceOwnerEmail =
      browserOwnedDeck?.ownerEmail ?? getRequestUserEmail();
    const sourceOrgId = browserOwnedDeck?.orgId ?? getRequestOrgId();
    const slidesWithContent = await Promise.all(
      expandSourcePageArrays(rawSlides).map(async (slide) => {
        if (slide.sourceTsx !== undefined) {
          if (!sourceOwnerEmail) {
            fail("A signed-in owner is required to resolve slide assets.", {
              errorCode: "not_authenticated",
              statusCode: 401,
            });
          }
          const compiled = await compileSlideSource(slide.sourceTsx, {
            ownerEmail: sourceOwnerEmail,
            orgId: sourceOrgId,
          });
          return {
            ...slide,
            content: compiled.content,
            revision: 1,
            sourceHash: compiled.sourceHash,
          };
        }
        return { ...slide, content: normalizeSlidePadding(slide.content!) };
      }),
    );
    const normalizedSlides = ensureUniqueSlideIds(slidesWithContent);
    const slides = rebindCreativeContextSlideLabels(
      normalizedSlides.slides,
      normalizedSlides.originalIds,
    );
    const hygieneInputs = slides.map((slide) => ({
      slideId: slide.id,
      html: slide.content,
    }));
    const incrementalGeneration = !deckId && slides.length === 0;
    const isEmptyExistingDeckReplacement = Boolean(
      deckId && slides.length === 0,
    );
    const tracksGenerationLifecycle =
      actionOwnsGenerationLifecycle && !isEmptyExistingDeckReplacement;
    if (tracksGenerationLifecycle) {
      trackSlides(
        "generation_started",
        {
          generation_attempt_id: generationAttemptId,
          source: "create_deck_action",
          generation_mode: incrementalGeneration ? "incremental" : "bulk",
          started_at_ms: generationStartedAt,
          has_reference_deck: Boolean(contextPackId),
          slide_count: slides.length,
          ...(deckId ? { output_id: deckId } : {}),
        },
        ctx,
      );
    }
    // Rewriting an existing deck is an edit, not the start of a new deck.
    if (actionOwnsGenerationLifecycle && !deckId) {
      // The deck id is minted later, so the start joins its deck_created on
      // generation_attempt_id.
      trackDeckCreationStarted(
        undefined,
        undefined,
        {
          generationAttemptId,
          mode: "new",
          ...(explicitDesignSystemId || designSystem
            ? { designSystemId: explicitDesignSystemId || String(designSystem) }
            : {}),
        },
        ctx,
      );
    }
    try {
      const validatedCreativeContext = await validateGenerationCreativeContext({
        contextPackId,
        contextModeOverride,
        reuseLabels: Array.from(
          new Map(
            [
              ...reuseLabels,
              ...slides.flatMap(
                (slide) => slide.creativeContextReuseLabels ?? [],
              ),
            ].map((label) => [`${label.itemId}:${label.itemVersionId}`, label]),
          ).values(),
        ),
      });
      const creativeContextProvenance = {
        contextMode: validatedCreativeContext.contextMode,
        contextPackId: validatedCreativeContext.contextPackId,
        reuseLabels: validatedCreativeContext.reuseLabels,
      };
      const elementProvenance: CreativeContextElementProvenance[] = [
        ...reuseLabels.map((label) => ({
          elementId: label.elementId ?? "deck",
          influence: label.influence ?? ("reference-conditioned" as const),
          ...(label.itemId ? { itemId: label.itemId } : {}),
          ...(label.itemVersionId
            ? { itemVersionId: label.itemVersionId }
            : {}),
          label: label.label,
        })),
        ...slides.flatMap((slide) => {
          const labels = slide.creativeContextReuseLabels ?? [];
          return labels.length
            ? labels.map((label) => ({
                elementId: label.elementId ?? slide.id,
                influence:
                  label.influence ?? ("reference-conditioned" as const),
                ...(label.itemId ? { itemId: label.itemId } : {}),
                ...(label.itemVersionId
                  ? { itemVersionId: label.itemVersionId }
                  : {}),
                label: label.label,
              }))
            : [
                {
                  elementId: slide.id,
                  influence: "generated" as const,
                  label: "Net-new slide",
                },
              ];
        }),
        ...(reuseLabels.length === 0 && slides.length === 0
          ? [
              {
                elementId: "deck",
                influence: "generated" as const,
                label: "Net-new deck",
              },
            ]
          : []),
      ];

      const firstSlideContent = slides[0]?.content;
      const resolvedTitle =
        repairGeneratedDeckTitle(title, firstSlideContent) ?? title;

      const designSystemId = promptDraft
        ? (promptDraft.designSystemId ?? undefined)
        : (explicitDesignSystemId ??
          (designSystem
            ? await resolveDesignSystemIdByTitle(designSystem)
            : undefined));

      if (deckId) {
        if (designSystemId) {
          await assertAccess("design-system", designSystemId, "viewer");
        }
        const existingDeck = browserOwnedDeck;
        if (!existingDeck) {
          fail(`Deck not found: ${deckId}`, {
            errorCode: "deck_not_found",
            statusCode: 404,
          });
        }
        const existingDeckTitle =
          repairGeneratedDeckTitle(
            title,
            firstSlideContent,
            existingDeck.title,
          ) ?? resolvedTitle;
        assertHumanReadableDeckTitle(existingDeckTitle);
        const writeNow = nextDeckRevision(existingDeck.updatedAt);
        const prevData = JSON.parse(existingDeck.data);
        const previousDesignSystemId = resolveDeckDesignSystemId(
          existingDeck,
          prevData,
        );
        const data = {
          ...prevData,
          title: existingDeckTitle,
          slides,
          updatedAt: writeNow,
          aspectRatio: aspectRatio ?? prevData.aspectRatio,
          designSystemId: designSystemId ?? prevData.designSystemId,
          creativeContext: creativeContextProvenance,
          ...(actionOwnsGenerationLifecycle
            ? {
                generationContext: incrementalGeneration
                  ? {
                      generationAttemptId,
                      generationMode: "action",
                      generationStartedAt,
                    }
                  : undefined,
              }
            : {}),
        };
        assertSourceBackedSlidesUnchanged(
          prevData,
          data,
          slides.flatMap((slide) =>
            typeof slide.sourceTsx === "string" ? [slide.id] : [],
          ),
        );
        assertNoDeckRenderArtifacts(existingDeck.data, data);
        await db.transaction(async (tx: any) => {
          await createDeckVersionSnapshot(
            {
              id: existingDeck.id,
              title: existingDeck.title,
              data: existingDeck.data,
              ownerEmail: existingDeck.ownerEmail,
            },
            { force: true, label: "Before bulk replace", db: tx },
          );
          const updatedRows = await tx
            .update(schema.decks)
            .set({
              title: existingDeckTitle,
              data: JSON.stringify(data),
              designSystemId: designSystemId ?? previousDesignSystemId,
              updatedAt: writeNow,
            })
            .where(
              deckRevisionWhere(schema.decks, deckId, existingDeck.updatedAt),
            )
            .returning(persistedDeckWriteColumns());
          assertDeckWriteApplied(
            { rowsAffected: updatedRows.length },
            deckId,
            "deck replacement",
          );
          assertPersistedDeckWrite(
            updatedRows[0],
            {
              id: existingDeck.id,
              title: existingDeckTitle,
              data: JSON.stringify(data),
              designSystemId: designSystemId ?? previousDesignSystemId,
              ownerEmail: existingDeck.ownerEmail,
              orgId: existingDeck.orgId,
              updatedAt: writeNow,
            },
            "deck replacement",
          );
        });
        let loadedDesignSystem: Awaited<
          ReturnType<typeof loadAgentDesignSystemContext>
        > = null;
        let postProcessErrorType: string | undefined;
        try {
          await recordGenerationCreativeContext({
            appId: "slides-2",
            artifactType: "deck",
            artifactId: deckId,
            ...creativeContextProvenance,
            ...(elementProvenance.length ? { elementProvenance } : {}),
          });
          await notifyClients(deckId);
          await writeAppStateForCurrentTab(
            appStateKey("navigate"),
            deckNavigationCommand(deckId),
          );
          await writeAppState("refresh-signal", {
            ts: writeNow,
            source: "create-deck",
          });
          loadedDesignSystem = await loadAgentDesignSystemContext(
            designSystemId ?? previousDesignSystemId,
            getDesignSystem,
            { full: true },
          );
        } catch (error) {
          postProcessErrorType =
            error instanceof Error ? error.name : "unknown_error";
        }
        const postProcessStatus = postProcessErrorType ? "failed" : "completed";
        if (postProcessErrorType && tracksGenerationLifecycle) {
          const generationEndedAt = Date.now();
          trackSlides(
            "generation_outcome_unresolved",
            {
              generation_attempt_id: generationAttemptId,
              source: "create_deck_action",
              generation_mode: "bulk",
              output_id: deckId,
              output_type: "deck",
              slide_count: slides.length,
              outcome: "unresolved",
              reason: "postprocess_failed",
              persisted_output: true,
              error_type: postProcessErrorType,
              ...generationTimingFields(generationStartedAt, generationEndedAt),
            },
            ctx,
          );
        } else if (!postProcessErrorType && tracksGenerationLifecycle) {
          const generationEndedAt = Date.now();
          trackSlides(
            "generation_completed",
            {
              generation_attempt_id: generationAttemptId,
              source: "create_deck_action",
              generation_mode: "bulk",
              output_id: deckId,
              output_type: "deck",
              slide_count: slides.length,
              ...generationTimingFields(generationStartedAt, generationEndedAt),
              ...(loadedDesignSystem
                ? { design_system_status: loadedDesignSystem.status }
                : {}),
            },
            ctx,
          );
        }
        trackSlides(
          "deck_edited",
          {
            ...(browserGenerationAttemptId !== undefined ||
            tracksGenerationLifecycle
              ? { generation_attempt_id: generationAttemptId }
              : {}),
            output_id: deckId,
            output_type: "deck",
            slide_count: slides.length,
            edit_mode: "replace_all",
          },
          ctx,
        );
        return {
          id: deckId,
          title: existingDeckTitle,
          slideCount: slides.length,
          designSystemId: designSystemId ?? previousDesignSystemId,
          designSystem: loadedDesignSystem,
          url: getDeckUrl(deckId),
          appUrl: getDeckUrl(deckId),
          deepLink: deckDeepLink(deckId),
          slides,
          persistenceStatus: "verified",
          postProcessStatus,
          ...creativeContextProvenance,
          ...slideHygieneResult(hygieneInputs),
        };
      }

      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail)
        fail("no authenticated user", {
          errorCode: "not_authenticated",
          statusCode: 401,
        });
      assertHumanReadableDeckTitle(resolvedTitle);

      if (
        promptDraft &&
        explicitDesignSystemId !== undefined &&
        explicitDesignSystemId !== promptDraft.designSystemId
      ) {
        fail("Prompt draft design system does not match its initial context.", {
          errorCode: "prompt_draft_context_mismatch",
          statusCode: 400,
        });
      }

      let resolvedDesignSystemId = designSystemId;
      if (resolvedDesignSystemId) {
        await assertAccess("design-system", resolvedDesignSystemId, "viewer");
      } else if (!promptDraft) {
        resolvedDesignSystemId =
          (await resolveDefaultDesignSystemId(ownerEmail)) ?? undefined;
      }

      const id =
        promptDraft?.id ??
        `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      generationOutputId = id;
      const data: Record<string, unknown> = {
        appId: "slides-2",
        title: resolvedTitle,
        slides,
        createdAt: now,
        updatedAt: now,
        ...(tracksGenerationLifecycle && incrementalGeneration
          ? {
              generationContext: {
                generationAttemptId,
                generationMode: "action",
                generationStartedAt,
              },
            }
          : {}),
        ...(promptDraft
          ? { generationContext: promptDraft.generationContext }
          : {}),
      };
      if (aspectRatio) data.aspectRatio = aspectRatio;
      if (resolvedDesignSystemId) data.designSystemId = resolvedDesignSystemId;
      data.creativeContext = creativeContextProvenance;
      assertNoDeckRenderArtifacts(null, data);
      const insertValues = {
        id,
        title: resolvedTitle,
        data: JSON.stringify(data),
        designSystemId: resolvedDesignSystemId ?? null,
        ownerEmail,
        orgId: getRequestOrgId(),
        createdAt: now,
        updatedAt: now,
      };
      if (promptDraft) {
        const existingRows = await db
          .select()
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (
            !promptDraftMatches(existing, {
              id,
              ownerEmail,
              orgId: insertValues.orgId,
              title: resolvedTitle,
              designSystemId: resolvedDesignSystemId,
              aspectRatio,
              generationContext: promptDraft.generationContext,
            })
          ) {
            throw promptDraftConflict();
          }
          return {
            id,
            title: resolvedTitle,
            updatedAt: existing.updatedAt ?? undefined,
            slideCount: 0,
            designSystemId: resolvedDesignSystemId ?? null,
            designSystem: null,
            url: getDeckUrl(id),
            appUrl: getDeckUrl(id),
            deepLink: deckDeepLink(id),
            slides: [],
            persistenceStatus: "verified",
            postProcessStatus: "skipped",
            ...creativeContextProvenance,
            ...slideHygieneResult(hygieneInputs),
          };
        }
      }
      try {
        const insertedRows = await db
          .insert(schema.decks)
          .values(insertValues)
          .returning(persistedDeckWriteColumns());
        assertPersistedDeckWrite(
          insertedRows[0],
          {
            id: insertValues.id,
            title: insertValues.title,
            data: insertValues.data,
            designSystemId: insertValues.designSystemId,
            ownerEmail: insertValues.ownerEmail,
            orgId: insertValues.orgId ?? null,
            updatedAt: insertValues.updatedAt,
          },
          "deck creation",
        );
      } catch (error) {
        if (!promptDraft || !isUniqueViolation(error)) throw error;
        const existingRows = await db
          .select()
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .limit(1);
        const existing = existingRows[0];
        if (
          !existing ||
          !promptDraftMatches(existing, {
            id,
            ownerEmail,
            orgId: insertValues.orgId,
            title: resolvedTitle,
            designSystemId: resolvedDesignSystemId,
            aspectRatio,
            generationContext: promptDraft.generationContext,
          })
        ) {
          throw promptDraftConflict();
        }
        return {
          id,
          title: resolvedTitle,
          updatedAt: existing.updatedAt ?? undefined,
          slideCount: 0,
          designSystemId: resolvedDesignSystemId ?? null,
          designSystem: null,
          url: getDeckUrl(id),
          appUrl: getDeckUrl(id),
          deepLink: deckDeepLink(id),
          slides: [],
          persistenceStatus: "verified",
          postProcessStatus: "skipped",
          ...creativeContextProvenance,
          ...slideHygieneResult(hygieneInputs),
        };
      }

      let loadedDesignSystem: Awaited<
        ReturnType<typeof loadAgentDesignSystemContext>
      > = null;
      let postProcessErrorType: string | undefined;
      try {
        await recordGenerationCreativeContext({
          appId: "slides-2",
          artifactType: "deck",
          artifactId: id,
          ...creativeContextProvenance,
          ...(elementProvenance.length ? { elementProvenance } : {}),
        });
        await notifyClients(id);
        if (!promptDraft) {
          await writeAppStateForCurrentTab(
            appStateKey("navigate"),
            deckNavigationCommand(id),
          );
          await writeAppState("refresh-signal", {
            ts: now,
            source: "create-deck",
          });
        }
        loadedDesignSystem = await loadAgentDesignSystemContext(
          resolvedDesignSystemId,
          getDesignSystem,
          { full: true },
        );
      } catch (error) {
        postProcessErrorType =
          error instanceof Error ? error.name : "unknown_error";
      }
      const postProcessStatus = postProcessErrorType ? "failed" : "completed";
      if (postProcessErrorType && tracksGenerationLifecycle) {
        const generationEndedAt = Date.now();
        trackSlides(
          "generation_outcome_unresolved",
          {
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            generation_mode: incrementalGeneration ? "incremental" : "bulk",
            output_id: id,
            output_type: "deck",
            slide_count: slides.length,
            outcome: "unresolved",
            reason: "postprocess_failed",
            persisted_output: true,
            error_type: postProcessErrorType,
            ...generationTimingFields(generationStartedAt, generationEndedAt),
          },
          ctx,
        );
      }
      if (incrementalGeneration) {
        const generationEndedAt = Date.now();
        trackSlides(
          "generation_request_accepted",
          {
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            generation_mode: incrementalGeneration ? "incremental" : "bulk",
            output_id: id,
            output_type: "deck",
            slide_count: slides.length,
            ...generationTimingFields(generationStartedAt, generationEndedAt),
          },
          ctx,
        );
      } else if (
        postProcessStatus === "completed" &&
        tracksGenerationLifecycle
      ) {
        const generationEndedAt = Date.now();
        trackSlides(
          "generation_completed",
          {
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            generation_mode: "bulk",
            output_id: id,
            output_type: "deck",
            slide_count: slides.length,
            ...generationTimingFields(generationStartedAt, generationEndedAt),
            ...(loadedDesignSystem
              ? { design_system_status: loadedDesignSystem.status }
              : {}),
          },
          ctx,
        );
      }
      trackSlides(
        "deck_created",
        {
          generation_attempt_id: generationAttemptId,
          creation_method: "generated",
          purpose: "direct",
          generation_mode: incrementalGeneration ? "incremental" : "bulk",
          output_id: id,
          output_type: "deck",
          slide_count: slides.length,
        },
        ctx,
      );
      return {
        id,
        title: resolvedTitle,
        updatedAt: now,
        slideCount: slides.length,
        designSystemId: resolvedDesignSystemId ?? null,
        designSystem: loadedDesignSystem,
        url: getDeckUrl(id),
        appUrl: getDeckUrl(id),
        deepLink: deckDeepLink(id),
        slides,
        persistenceStatus: "verified",
        postProcessStatus,
        ...creativeContextProvenance,
        ...slideHygieneResult(hygieneInputs),
      };
    } catch (error) {
      if (tracksGenerationLifecycle) {
        const terminal = generationTerminalEvent(ctx?.signal);
        const generationEndedAt = Date.now();
        trackSlides(
          terminal.name,
          {
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            ...(generationOutputId
              ? { output_id: generationOutputId, output_type: "deck" }
              : {}),
            slide_count: slides.length,
            ...generationTimingFields(generationStartedAt, generationEndedAt),
            outcome: terminal.outcome,
            failure_code: terminal.failure_code,
            error_type: error instanceof Error ? error.name : "unknown_error",
          },
          ctx,
        );
      }
      throw error;
    }
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides 2",
      view: "editor",
    };
  },
});
