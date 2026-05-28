import { defineAction } from "@agent-native/core";
import { z } from "zod";
import pLimit from "p-limit";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import generateImage from "./generate-image.js";
import { requireGenerationSessionInLibrary } from "./_helpers.js";
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

export default defineAction({
  description:
    "Generate several brand-consistent images in parallel from one library. Use this for slide decks, landing pages, and multi-slot design work. Each returned image includes assetId, runId, previewUrl, downloadUrl, and embedPath.",
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
        result.status === "fulfilled"
          ? { slotId: slots[index].slotId, ok: true, ...result.value }
          : {
              slotId: slots[index].slotId,
              ok: false,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : "Image generation failed",
            },
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
