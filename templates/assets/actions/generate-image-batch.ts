import { defineAction } from "@agent-native/core";
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

export default defineAction({
  description:
    "Generate several brand-consistent images in parallel from one library. This is synchronous for images: one call waits for every slot and returns final image artifacts. Use this for slide decks, landing pages, and multi-slot design work. Do not call get-generation-run or refresh-generation-run after a normal image batch result.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    presetId: z.string().optional(),
    sessionId: z.string().optional(),
    slots: z
      .array(
        z.object({
          slotId: z.string(),
          prompt: z.string().min(1),
          aspectRatio: z.enum(ASPECT_RATIOS).optional(),
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
    model: z.enum(IMAGE_MODELS).optional(),
    tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
    intent: z.enum(GENERATION_INTENTS).default("generate"),
    styleStrength: z.enum(STYLE_STRENGTHS).default("balanced"),
    includeLogo: z.coerce.boolean().default(false),
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
  run: async ({ slots, ...base }) => {
    await assertAccess("asset-library", base.libraryId, "editor");
    if (base.sessionId) {
      await requireGenerationSessionInLibrary(base.sessionId, base.libraryId);
    }
    const limit = pLimit(4);
    const variantBatchId = nanoid();
    const results = await Promise.allSettled(
      slots.map((slot) =>
        limit(() =>
          generateImage.run({
            libraryId: base.libraryId,
            collectionId: base.collectionId,
            presetId: base.presetId,
            sessionId: base.sessionId,
            prompt: slot.prompt,
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
            dismissible: slot.dismissible,
            sourceAssetId: slot.sourceAssetId,
            subjectAssetId: slot.subjectAssetId,
            source: base.source,
            callerAppId: base.callerAppId,
            activateSessionAsset: false,
          }),
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
