import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  analyzeStyleWithGemini,
  isGeminiImageGenerationConfigured,
  type ReferenceForGeneration,
} from "../server/lib/generation.js";
import { extractDominantColors } from "../server/lib/image-processing.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { getObject } from "../server/lib/storage.js";
import type { StyleBrief } from "../shared/api.js";
import { serializeLibrary } from "./_helpers.js";

/**
 * Synthesize a reusable style guide from a library's reference images.
 */
export default defineAction({
  description:
    "Analyze reference images in an asset library or collection and update the style brief with palette plus vision-derived brand/style traits.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    paletteSize: z.coerce.number().int().min(3).max(12).default(6),
  }),
  run: async ({ libraryId, collectionId, paletteSize }) => {
    await assertAccess("asset-library", libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, libraryId))
      .limit(1);
    if (!library) throw new Error("Asset library not found.");
    const [collection] = collectionId
      ? await db
          .select()
          .from(schema.assetCollections)
          .where(eq(schema.assetCollections.id, collectionId))
          .limit(1)
      : [null];
    if (collection && collection.libraryId !== libraryId) {
      throw new Error("Collection does not belong to this asset library.");
    }

    const rows = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.libraryId, libraryId));
    const refs = rows.filter((asset) => {
      const metadata = parseJson<{ intent?: string }>(asset.metadata, {});
      return (
        asset.role !== "generated" &&
        asset.role !== "subject_reference" &&
        metadata.intent !== "subject" &&
        asset.status !== "archived" &&
        asset.status !== "failed" &&
        asset.mimeType.startsWith("image/") &&
        (!collectionId || asset.collectionId === collectionId)
      );
    });

    const colorScores = new Map<string, number>();
    const referenceData: ReferenceForGeneration[] = [];
    for (const ref of refs) {
      const buffer = await getObject(ref.objectKey).catch(() => null);
      if (!buffer) continue;
      const metadata = parseJson<{ category?: string }>(ref.metadata, {});
      referenceData.push({
        id: ref.id,
        role: ref.role,
        category: metadata.category,
        mimeType: ref.mimeType,
        data: buffer.toString("base64"),
      });
      const colors = await extractDominantColors(buffer).catch(
        (): string[] => [],
      );
      colors.forEach((hex, idx) => {
        // Earlier colors in each ref's palette dominate; weight accordingly.
        const weight = colors.length - idx;
        colorScores.set(hex, (colorScores.get(hex) ?? 0) + weight);
      });
    }

    const palette = [...colorScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, paletteSize)
      .map(([hex]) => hex);

    const previous = collection
      ? parseJson<StyleBrief>(collection.styleBrief, {})
      : parseJson<StyleBrief>(library.styleBrief, {});
    let analyzedStyle: StyleBrief = {};
    let analysisModel: string | null = null;
    let analysisMode: "vision" | "palette" = "palette";
    if (
      referenceData.length > 0 &&
      (await isGeminiImageGenerationConfigured().catch(() => false))
    ) {
      try {
        const output = await analyzeStyleWithGemini({
          references: referenceData,
          previous,
        });
        analyzedStyle = output.styleBrief;
        analysisModel = output.model;
        analysisMode = "vision";
      } catch {
        analyzedStyle = {};
      }
    }
    const styleBrief: StyleBrief = {
      ...previous,
      ...Object.fromEntries(
        Object.entries(analyzedStyle).filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value),
        ),
      ),
      palette: palette.length > 0 ? palette : previous.palette,
    };

    const analyzedAt = nowIso();
    if (collection) {
      await db
        .update(schema.assetCollections)
        .set({ styleBrief: stringifyJson(styleBrief), updatedAt: analyzedAt })
        .where(eq(schema.assetCollections.id, collection.id));
    } else {
      const settings = parseJson<Record<string, unknown>>(library.settings, {});
      settings.brandAnalysis = {
        analyzedAt,
        referenceCount: refs.length,
        analyzedImageCount: referenceData.length,
        mode: analysisMode,
        model: analysisModel,
      };
      await db
        .update(schema.assetLibraries)
        .set({
          styleBrief: stringifyJson(styleBrief),
          settings: stringifyJson(settings),
          updatedAt: analyzedAt,
        })
        .where(eq(schema.assetLibraries.id, libraryId));
    }

    return {
      libraryId,
      collectionId: collection?.id ?? null,
      analyzed: refs.length,
      analyzedImages: referenceData.length,
      mode: analysisMode,
      model: analysisModel,
      palette,
      styleBrief,
      library: collection
        ? undefined
        : serializeLibrary({
            ...library,
            styleBrief: stringifyJson(styleBrief),
            settings: stringifyJson({
              ...parseJson<Record<string, unknown>>(library.settings, {}),
              brandAnalysis: {
                analyzedAt,
                referenceCount: refs.length,
                analyzedImageCount: referenceData.length,
                mode: analysisMode,
                model: analysisModel,
              },
            }),
          }),
    };
  },
});
