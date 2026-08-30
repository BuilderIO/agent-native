import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeTemplate } from "./_helpers.js";
import {
  assertPresetReferenceAssetsValid,
  assertPresetReferenceModelCompatible,
  assertPresetSkeletonAssetsValid,
} from "./_preset-skeleton-validation.js";
import { assertTemplateTargetLibraryAccess } from "./_template-access.js";
import { templateFieldsSchema, templateHasPins } from "./_template-input.js";

export default defineAction({
  description:
    "Create a reusable asset template. A template may be global or associated with one Brand Kit.",
  schema: templateFieldsSchema.extend({ title: z.string().min(1) }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const libraryId = args.libraryId ?? null;
    await assertTemplateTargetLibraryAccess(libraryId);
    const db = getDb();
    if (args.collectionId) {
      if (!libraryId)
        throw new Error("A collection requires an associated Brand Kit.");
      const [collection] = await db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.id, args.collectionId))
        .limit(1);
      if (!collection || collection.libraryId !== libraryId)
        throw new Error("Collection does not belong to this asset library.");
    }
    const settings = {
      ...(args.settings ?? {}),
      ...(args.includeLogo === undefined
        ? {}
        : { includeLogo: args.includeLogo }),
    };
    if (!libraryId && templateHasPins(settings).length)
      throw new Error(
        "Global templates cannot pin images, use a skeleton, or composite a canonical logo.",
      );
    if (libraryId) {
      await assertPresetSkeletonAssetsValid({ db, libraryId, settings });
      await assertPresetReferenceAssetsValid({ db, libraryId, settings });
    }
    assertPresetReferenceModelCompatible({
      model: args.model ?? "gemini-3.1-flash-image",
      settings,
    });
    const now = nowIso();
    const row = {
      id: nanoid(),
      libraryId,
      collectionId: args.collectionId ?? null,
      title: args.title,
      description: args.description ?? null,
      category: args.category ?? "style-only",
      mediaType: "image",
      promptTemplate: args.promptTemplate ?? null,
      aspectRatio: args.aspectRatio ?? "16:9",
      imageSize: args.imageSize ?? "2K",
      model: args.model ?? "gemini-3.1-flash-image",
      textPolicy: args.textPolicy ?? "",
      referencePolicy: args.referencePolicy ?? "auto",
      settings: stringifyJson(settings),
      sortOrder: args.sortOrder ?? 100,
      ownerEmail,
      orgId: getRequestOrgId(),
      visibility: "private" as const,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(schema.assetTemplates).values(row);
    return serializeTemplate(row);
  },
});
