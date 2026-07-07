import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import pLimit from "p-limit";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";
import {
  ASPECT_RATIOS,
  GENERATION_INTENTS,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_QUALITY_TIERS,
  IMAGE_SIZES,
  STYLE_STRENGTHS,
} from "../shared/api.js";
import { requireGenerationSessionInLibrary } from "./_helpers.js";
import generateImage from "./generate-image.js";
import { upsertVariantSlot } from "./variant-slots.js";

const IMAGE_GENERATION_TOOL_TIMEOUT_MS = 12 * 60_000;

export default defineAction({
  description:
    "Generate several brand-consistent images in parallel from one brand kit/library. Use @brand-kit mentions as libraryId and @preset mentions as presetId when present. This is synchronous for images: one call waits for every slot and returns final image artifacts. Use this for slide decks, landing pages, and multi-slot design work. Do not call get-generation-run or refresh-generation-run after a normal image batch result.",
  schema: z.object({
    libraryId: z
      .string()
      .optional()
      .describe(
        "Brand kit/library ID. Pass the refId from a brand-kit @mention, or choose a kit from view-screen/list-libraries.",
      ),
    collectionId: z.string().optional(),
    presetId: z
      .string()
      .optional()
      .describe(
        "Generation preset ID (from a @preset mention or list-generation-presets). The preset already defines aspectRatio, imageSize, model, tier, and category. When you set presetId, OMIT each slot's aspectRatio/imageSize and the top-level model/tier so the preset's values are used; only pass one when the user explicitly asks for a value that differs from the preset.",
      ),
    sessionId: z.string().optional(),
    slots: z
      .array(
        z.object({
          slotId: z.string(),
          prompt: z.string().min(1),
          embeddedText: z
            .string()
            .optional()
            .describe(
              "Exact words to render inside the image, spelled exactly. When set, the image is allowed to contain this text; when omitted, the image avoids embedded text.",
            ),
          textPlacement: z
            .string()
            .optional()
            .describe(
              "Where/how the embedded text should appear, e.g. 'centered headline', 'lower-left label'.",
            ),
          aspectRatio: z
            .enum(ASPECT_RATIOS)
            .optional()
            .describe(
              "Slot aspect ratio. When a presetId is set, omit this — the preset's aspect ratio is used unless the user explicitly asks for a different ratio for this slot. Note: gpt-image-2 supports only 1:1, 2:3, and 3:2; use a Gemini model for other ratios.",
            ),
          imageSize: z.enum(IMAGE_SIZES).optional(),
          categories: z.array(z.enum(IMAGE_CATEGORIES)).optional(),
          referenceAssetIds: z.array(z.string()).optional(),
          sourceAssetId: z.string().optional(),
          subjectAssetId: z.string().optional(),
          intent: z.enum(GENERATION_INTENTS).optional(),
          styleStrength: z.enum(STYLE_STRENGTHS).optional(),
          dismissible: z.coerce.boolean().optional(),
        }),
      )
      .min(1)
      .max(12),
    variantScopeId: z
      .string()
      .optional()
      .describe(
        "Internal UI state scope for live candidate slots. Usually omitted; embedded picker UIs pass a browser-tab scope.",
      ),
    model: z
      .enum(IMAGE_MODELS)
      .optional()
      .describe(
        "Image model applied to every slot. Omit to use the user's picker default. Gemini models accept any aspectRatio; gpt-image-2 supports ONLY 1:1, 2:3, and 3:2, so don't select it when any slot needs a different ratio — use a Gemini model instead.",
      ),
    tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
    intent: z.enum(GENERATION_INTENTS).default("generate"),
    styleStrength: z.enum(STYLE_STRENGTHS).default("balanced"),
    includeLogo: z.coerce
      .boolean()
      .optional()
      .describe(
        "Composite the library's canonical logo onto every slot. When omitted, the selected preset's logo setting is used; pass an explicit value to override it. No-op if the library has no canonical logo.",
      ),
    groundingMode: z.enum(["auto", "off", "google-search"]).default("auto"),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design') so audit logs can filter by app.",
      ),
  }),
  parallelSafe: true,
  timeoutMs: IMAGE_GENERATION_TOOL_TIMEOUT_MS,
  run: async ({ slots, ...inputBase }, context?: ActionRunContext) => {
    const libraryId = inputBase.libraryId;
    if (!libraryId) {
      throw new Error(
        "No brand kit selected. Tag a brand kit with @ or pass libraryId.",
      );
    }
    const base = {
      ...inputBase,
      libraryId,
    };
    await assertAccess("asset-library", base.libraryId, "editor");
    if (base.sessionId) {
      await requireGenerationSessionInLibrary(base.sessionId, base.libraryId);
    }
    const variantBatchId = nanoid();
    await Promise.all(
      slots.map((slot, index) =>
        upsertVariantSlot({
          runId: `pending-${variantBatchId}-${index + 1}`,
          batchId: variantBatchId,
          libraryId: base.libraryId,
          collectionId: base.collectionId ?? null,
          presetId: base.presetId ?? null,
          sessionId: base.sessionId ?? null,
          threadId: context?.threadId ?? null,
          variantScopeId: base.variantScopeId ?? null,
          prompt: slot.prompt,
          slotId: slot.slotId,
          status: "pending",
        }),
      ),
    );
    const limit = pLimit(4);
    const results = await Promise.allSettled(
      slots.map((slot) =>
        limit(() =>
          generateImage.run(
            {
              libraryId: base.libraryId,
              collectionId: base.collectionId,
              presetId: base.presetId,
              sessionId: base.sessionId,
              prompt: slot.prompt,
              embeddedText: slot.embeddedText,
              textPlacement: slot.textPlacement,
              aspectRatio: slot.aspectRatio,
              imageSize: slot.imageSize,
              model: base.model,
              tier: base.tier,
              intent: slot.intent ?? base.intent,
              styleStrength: slot.styleStrength ?? base.styleStrength,
              categories: slot.categories,
              referenceAssetIds: slot.referenceAssetIds,
              includeLogo: base.includeLogo,
              groundingMode: base.groundingMode,
              slotId: slot.slotId,
              variantBatchId,
              variantScopeId: base.variantScopeId,
              dismissible: slot.dismissible,
              sourceAssetId: slot.sourceAssetId,
              subjectAssetId: slot.subjectAssetId,
              source: base.source,
              callerAppId: base.callerAppId,
              activateSessionAsset: false,
            },
            context,
          ),
        ),
      ),
    );
    if (base.sessionId) {
      const primaryAssetId = firstSuccessfulAssetId(results);
      if (primaryAssetId) {
        await getDb()
          .update(schema.assetGenerationSessions)
          .set({ activeAssetId: primaryAssetId, updatedAt: nowIso() })
          .where(eq(schema.assetGenerationSessions.id, base.sessionId));
      }
    }
    return {
      count: results.length,
      images: results.map((result, index) =>
        serializeBatchResult(slots[index].slotId, result),
      ),
    };
  },
});

function firstSuccessfulAssetId(
  results: PromiseSettledResult<Record<string, unknown>>[],
): string | null {
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const assetId = result.value.id ?? result.value.assetId;
    if (typeof assetId === "string" && assetId) return assetId;
  }
  return null;
}

function serializeBatchResult(
  slotId: string,
  result: PromiseSettledResult<Record<string, unknown>>,
) {
  if (result.status === "rejected") {
    return {
      slotId,
      ok: false,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : "Image generation failed",
    };
  }

  const assetId = imageAssetId(result.value);
  if (result.value.dismissed === true) {
    return {
      slotId,
      ok: false,
      dismissed: true,
      runId: stringValue(result.value.runId),
      error: "Candidate was dismissed before it completed.",
    };
  }

  if (!assetId) {
    return {
      slotId,
      ok: false,
      runId: stringValue(result.value.runId),
      error: "Image generation finished without an asset.",
    };
  }

  return { slotId, ok: true, ...result.value };
}

function imageAssetId(value: Record<string, unknown>): string | undefined {
  return stringValue(value.id) ?? stringValue(value.assetId);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
