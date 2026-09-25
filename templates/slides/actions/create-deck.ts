import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
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
  resolveDefaultDesignSystemId,
  resolveDesignSystemIdByTitle,
} from "../server/workspace-defaults.js";
import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
import {
  assertHumanReadableDeckTitle,
  repairGeneratedDeckTitle,
} from "../shared/deck-title.js";
import {
  ensureUniqueSlideIds,
  rebindCreativeContextSlideLabels,
} from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
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

const SlideSchema = z.object({
  id: z.string().describe("Unique slide ID, e.g. 'slide-1'"),
  content: z.string().describe("Full HTML content of the slide"),
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
});

// Accept either a parsed array (HTTP/agent) or a JSON string (CLI)
const SlidesSchema = z.preprocess(
  (v) => (v === undefined ? [] : typeof v === "string" ? JSON.parse(v) : v),
  z.array(SlideSchema),
);

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

function deckNavigationCommand(deckId: string): Record<string, string> {
  return {
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

function trackGenerationEvent(
  name: string,
  properties: Record<string, unknown>,
  source: Parameters<typeof track>[2],
): void {
  try {
    track(name, properties, source);
  } catch {
    // coercion-ok: analytics is best-effort and must not affect deck writes.
  }
}

export default defineAction({
  title: "Create Slides deck",
  description:
    "Create the real editable Agent-Native Slides deck, optionally already populated with slides, or atomically replace all slides in an existing deck. This is the primary Slides MCP write action: use it instead of creating or publishing a standalone HTML artifact with the host's file tools. Put slide markup in `slides[].content`; this action persists it and returns an Open in Slides link. " +
    "For short AI-generated decks in MCP app hosts, pass all generated slides in this call so the real deck editor opens inline already populated. " +
    "For longer decks or live in-app generation, create the deck with slides: [], then add every generated slide with add-slide sequentially so each write preserves per-slide Creative Context provenance; pass generationComplete=false on intermediate writes and true on the final write; use patch-deck for edits to existing slides or deck structure, and never issue parallel writes to the same deck. The new deck is also opened in the connected Slides UI. " +
    "Pass presenter-only speaker notes in each slide's `notes` field; keep them out of slide HTML. " +
    "Pass deckId to replace an existing deck. " +
    "Returns the deck id, title, effective designSystemId, linked designSystem.agentContext when readable, and slide count. Apply that context before authoring slides. Every generated slide must be a fully styled composition with the exact padded `fmd-slide` wrapper, a clear type hierarchy, intentional alignment, readable contrast, and at least one visual or structural treatment beyond plain text. If no design system is linked, choose and record one subject-appropriate deck-level visual contract with semantic --deck-* values, then reuse its canvas, type, spacing, surface, and accent tokens across every slide; vary composition instead of alternating themes or using a stock provider/brand palette.",
  schema: z.object({
    title: z.string().describe("Deck title"),
    slides: SlidesSchema.describe(
      "Array of slides with id, content (HTML), optional layout, and presenter-only notes",
    ),
    deckId: z
      .string()
      .optional()
      .describe(
        "If provided, update this existing deck instead of creating a new one",
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
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck preview",
      description: "Open the generated deck in the real Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  http: { method: "POST" },
  run: async (
    {
      title,
      slides: rawSlides,
      deckId,
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
    const generationAttemptId =
      browserGenerationAttemptId ?? createGenerationAttemptId();
    const actionOwnsGenerationLifecycle =
      browserGenerationAttemptId === undefined;
    const generationStartedAt = Date.now();
    let generationOutputId = deckId;
    const db = getDb();
    let browserOwnedDeck: typeof schema.decks.$inferSelect | undefined;
    if (browserGenerationAttemptId !== undefined) {
      if (!deckId) {
        throw new Error(
          "generationAttemptId requires a matching existing deck",
        );
      }
      await assertAccess("deck", deckId, "editor");
      const existing = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      browserOwnedDeck = existing[0];
      const persistedAttemptId = browserOwnedDeck
        ? (
            JSON.parse(browserOwnedDeck.data) as {
              generationContext?: { generationAttemptId?: string };
            }
          ).generationContext?.generationAttemptId
        : undefined;
      if (persistedAttemptId !== browserGenerationAttemptId) {
        throw new Error(
          "generationAttemptId does not match the deck's persisted generationContext",
        );
      }
    }
    const now = new Date().toISOString();
    const normalizedSlides = ensureUniqueSlideIds(
      rawSlides.map((s) => ({
        ...s,
        content: normalizeSlidePadding(s.content),
      })),
    );
    const slides = rebindCreativeContextSlideLabels(
      normalizedSlides.slides,
      normalizedSlides.originalIds,
    );
    const incrementalGeneration = !deckId && slides.length === 0;
    if (actionOwnsGenerationLifecycle) {
      trackGenerationEvent(
        "generation_started",
        {
          app_name: "slides",
          template_name: "slides",
          generation_attempt_id: generationAttemptId,
          source: "create_deck_action",
          generation_mode: incrementalGeneration ? "incremental" : "bulk",
          has_reference_deck: Boolean(contextPackId),
          slide_count: slides.length,
          ...(deckId ? { output_id: deckId } : {}),
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

      // Resolve the title form before the branches split so replacing a deck
      // honors it the same way creating one does.
      const designSystemId =
        explicitDesignSystemId ??
        (designSystem
          ? await resolveDesignSystemIdByTitle(designSystem)
          : undefined);

      if (deckId) {
        if (designSystemId) {
          await assertAccess("design-system", designSystemId, "viewer");
        }
        // Update existing deck — requires editor access.
        let existingDeck = browserOwnedDeck;
        if (!existingDeck) {
          await assertAccess("deck", deckId, "editor");
          const existing = await db
            .select()
            .from(schema.decks)
            .where(eq(schema.decks.id, deckId))
            .limit(1);
          existingDeck = existing[0];
        }
        if (!existingDeck) {
          throw new Error(`Deck not found: ${deckId}`);
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
        };
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
          const updateResult = await tx
            .update(schema.decks)
            .set({
              title: existingDeckTitle,
              data: JSON.stringify(data),
              designSystemId: designSystemId ?? previousDesignSystemId,
              updatedAt: writeNow,
            })
            .where(
              deckRevisionWhere(schema.decks, deckId, existingDeck.updatedAt),
            );
          assertDeckWriteApplied(updateResult, deckId, "deck replacement");
        });
        let loadedDesignSystem: Awaited<
          ReturnType<typeof loadAgentDesignSystemContext>
        > = null;
        let postProcessErrorType: string | undefined;
        try {
          await recordGenerationCreativeContext({
            appId: "slides",
            artifactType: "deck",
            artifactId: deckId,
            ...creativeContextProvenance,
            ...(elementProvenance.length ? { elementProvenance } : {}),
          });
          // Broadcast to open editors (in-process SSE) + application-state
          // refresh signal (cross-process polling fallback for serverless).
          await notifyClients(deckId);
          await writeAppStateForCurrentTab(
            "navigate",
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
        if (postProcessErrorType && actionOwnsGenerationLifecycle) {
          trackGenerationEvent(
            "generation_outcome_unresolved",
            {
              app_name: "slides",
              template_name: "slides",
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
            },
            ctx,
          );
        } else if (!postProcessErrorType && actionOwnsGenerationLifecycle) {
          trackGenerationEvent(
            "generation_completed",
            {
              app_name: "slides",
              template_name: "slides",
              generation_attempt_id: generationAttemptId,
              source: "create_deck_action",
              generation_mode: "bulk",
              output_id: deckId,
              output_type: "deck",
              slide_count: slides.length,
              duration_ms: Date.now() - generationStartedAt,
              ...(loadedDesignSystem
                ? { design_system_status: loadedDesignSystem.status }
                : {}),
            },
            ctx,
          );
        }
        trackGenerationEvent(
          "deck_edited",
          {
            app_name: "slides",
            template_name: "slides",
            generation_attempt_id: generationAttemptId,
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
          postProcessStatus,
          ...creativeContextProvenance,
        };
      }

      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      assertHumanReadableDeckTitle(resolvedTitle);

      let resolvedDesignSystemId = designSystemId;
      if (resolvedDesignSystemId) {
        await assertAccess("design-system", resolvedDesignSystemId, "viewer");
      } else {
        resolvedDesignSystemId =
          (await resolveDefaultDesignSystemId(ownerEmail)) ?? undefined;
      }

      const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      generationOutputId = id;
      const data: Record<string, unknown> = {
        title: resolvedTitle,
        slides,
        createdAt: now,
        updatedAt: now,
        ...(actionOwnsGenerationLifecycle
          ? {
              generationContext: {
                generationAttemptId,
                generationMode: "action",
              },
            }
          : {}),
      };
      if (aspectRatio) data.aspectRatio = aspectRatio;
      if (resolvedDesignSystemId) data.designSystemId = resolvedDesignSystemId;
      data.creativeContext = creativeContextProvenance;
      await db.insert(schema.decks).values({
        id,
        title: resolvedTitle,
        data: JSON.stringify(data),
        designSystemId: resolvedDesignSystemId ?? null,
        ownerEmail,
        orgId: getRequestOrgId(),
        createdAt: now,
        updatedAt: now,
      });

      let loadedDesignSystem: Awaited<
        ReturnType<typeof loadAgentDesignSystemContext>
      > = null;
      let postProcessErrorType: string | undefined;
      try {
        await recordGenerationCreativeContext({
          appId: "slides",
          artifactType: "deck",
          artifactId: id,
          ...creativeContextProvenance,
          ...(elementProvenance.length ? { elementProvenance } : {}),
        });
        await notifyClients(id);
        await writeAppStateForCurrentTab("navigate", deckNavigationCommand(id));
        await writeAppState("refresh-signal", {
          ts: now,
          source: "create-deck",
        });
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
      if (postProcessErrorType && actionOwnsGenerationLifecycle) {
        trackGenerationEvent(
          "generation_outcome_unresolved",
          {
            app_name: "slides",
            template_name: "slides",
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
          },
          ctx,
        );
      }
      if (incrementalGeneration) {
        trackGenerationEvent(
          "generation_request_accepted",
          {
            app_name: "slides",
            template_name: "slides",
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            generation_mode: incrementalGeneration ? "incremental" : "bulk",
            output_id: id,
            output_type: "deck",
            slide_count: slides.length,
            duration_ms: Date.now() - generationStartedAt,
          },
          ctx,
        );
      } else if (
        postProcessStatus === "completed" &&
        actionOwnsGenerationLifecycle
      ) {
        trackGenerationEvent(
          "generation_completed",
          {
            app_name: "slides",
            template_name: "slides",
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            generation_mode: "bulk",
            output_id: id,
            output_type: "deck",
            slide_count: slides.length,
            duration_ms: Date.now() - generationStartedAt,
            ...(loadedDesignSystem
              ? { design_system_status: loadedDesignSystem.status }
              : {}),
          },
          ctx,
        );
      }
      trackGenerationEvent(
        "deck_created",
        {
          app_name: "slides",
          template_name: "slides",
          generation_attempt_id: generationAttemptId,
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
        slideCount: slides.length,
        designSystemId: resolvedDesignSystemId ?? null,
        designSystem: loadedDesignSystem,
        url: getDeckUrl(id),
        appUrl: getDeckUrl(id),
        deepLink: deckDeepLink(id),
        slides,
        postProcessStatus,
        ...creativeContextProvenance,
      };
    } catch (error) {
      if (actionOwnsGenerationLifecycle) {
        const terminal = generationTerminalEvent(ctx?.signal);
        trackGenerationEvent(
          terminal.name,
          {
            app_name: "slides",
            template_name: "slides",
            generation_attempt_id: generationAttemptId,
            source: "create_deck_action",
            ...(generationOutputId
              ? { output_id: generationOutputId, output_type: "deck" }
              : {}),
            slide_count: slides.length,
            duration_ms: Date.now() - generationStartedAt,
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
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
