import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { serializeTemplate } from "./_helpers.js";
import {
  assertPresetReferenceAssetsValid,
  assertPresetReferenceModelCompatible,
  assertPresetSkeletonAssetsValid,
} from "./_preset-skeleton-validation.js";
import { resolveTemplateAccess } from "./_template-access.js";
import { templateFieldsSchema, templateHasPins } from "./_template-input.js";

export default defineAction({
  description: "Update an asset template's reusable generation rules.",
  schema: templateFieldsSchema
    .omit({ libraryId: true })
    .extend({ id: z.string() }),
  run: async ({ id, ...args }) => {
    const template = (await resolveTemplateAccess(id, "editor")).resource;
    const db = getDb();
    if (args.collectionId) {
      if (!template.libraryId)
        throw new Error("A collection requires an associated Brand Kit.");
      const [collection] = await db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.id, args.collectionId))
        .limit(1);
      if (!collection || collection.libraryId !== template.libraryId)
        throw new Error("Collection does not belong to this asset library.");
    }
    const nextSettings = {
      ...parseJson<Record<string, unknown>>(template.settings, {}),
      ...(args.settings ?? {}),
    };
    if (args.includeLogo !== undefined)
      nextSettings.includeLogo = args.includeLogo;
    if (!template.libraryId && templateHasPins(nextSettings).length)
      throw new Error(
        "Global templates cannot pin images, use a skeleton, or composite a canonical logo.",
      );
    if (
      template.libraryId &&
      (args.settings !== undefined || args.includeLogo !== undefined)
    ) {
      await assertPresetSkeletonAssetsValid({
        db,
        libraryId: template.libraryId,
        settings: nextSettings,
      });
      await assertPresetReferenceAssetsValid({
        db,
        libraryId: template.libraryId,
        settings: nextSettings,
      });
    }
    assertPresetReferenceModelCompatible({
      model: args.model ?? template.model,
      settings: nextSettings,
    });
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    for (const key of [
      "title",
      "description",
      "collectionId",
      "category",
      "promptTemplate",
      "aspectRatio",
      "imageSize",
      "model",
      "textPolicy",
      "referencePolicy",
      "sortOrder",
    ] as const)
      if (args[key] !== undefined) updates[key] = args[key];
    if (args.settings !== undefined || args.includeLogo !== undefined)
      updates.settings = stringifyJson(nextSettings);
    await db
      .update(schema.assetTemplates)
      .set(updates)
      .where(eq(schema.assetTemplates.id, id));
    return serializeTemplate({ ...template, ...updates });
  },
});
