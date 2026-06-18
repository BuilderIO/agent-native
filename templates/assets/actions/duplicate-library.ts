import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import {
  serializeAsset,
  serializeGenerationPreset,
  serializeLibrary,
} from "./_helpers.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function copyTitle(title: string): string {
  const trimmed = title.trim() || "Brand kit";
  return /\(copy\)$/i.test(trimmed) ? trimmed : `${trimmed} (copy)`;
}

function remapJsonValue(
  value: unknown,
  ids: Map<string, string>,
): JsonValue | unknown {
  if (typeof value === "string") {
    return ids.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapJsonValue(item, ids));
  }
  if (!value || typeof value !== "object") {
    return value as JsonValue;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = remapJsonValue(item, ids);
  }
  return next;
}

function remapJsonText(
  text: string | null | undefined,
  ids: Map<string, string>,
) {
  return stringifyJson(remapJsonValue(parseJson(text, {}), ids));
}

export default defineAction({
  description:
    "Duplicate a Brand Kit into a new private copy owned by the current user. Copies the kit metadata, collections, folders, generation presets, and curated reference/saved assets, but not generation history, handoff sessions, shares, or visibility.",
  schema: z.object({
    id: z.string().describe("Source Brand Kit / asset library ID"),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("Optional title for the duplicated Brand Kit"),
  }),
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: unknown }).id
        : null;
    if (typeof id !== "string" || !id) return null;
    return {
      url: buildDeepLink({
        app: "assets",
        view: "library",
        params: { libraryId: id },
      }),
      label: "Open duplicated Brand Kit",
      view: "library",
    };
  },
  run: async ({ id, title }) => {
    await assertAccess("asset-library", id, "viewer");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const db = getDb();
    const [source] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, id))
      .limit(1);
    if (!source) throw new Error("Brand kit not found.");

    const now = nowIso();
    const newLibraryId = nanoid();
    const newTitle = title?.trim() || copyTitle(source.title);

    const [collections, folders, presets, assets] = await Promise.all([
      db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.libraryId, id)),
      db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.libraryId, id)),
      db
        .select()
        .from(schema.assetGenerationPresets)
        .where(eq(schema.assetGenerationPresets.libraryId, id)),
      db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.libraryId, id),
            inArray(schema.assets.status, ["reference", "saved"]),
            ne(schema.assets.role, "subject_reference"),
          ),
        ),
    ]);

    const collectionIds = new Map(
      collections.map((collection) => [collection.id, nanoid()]),
    );
    const folderIds = new Map(folders.map((folder) => [folder.id, nanoid()]));
    const presetIds = new Map(presets.map((preset) => [preset.id, nanoid()]));
    const assetIds = new Map(assets.map((asset) => [asset.id, nanoid()]));
    const allIds = new Map([
      ...collectionIds,
      ...folderIds,
      ...presetIds,
      ...assetIds,
    ]);

    const copiedCollections = collections.map((collection) => ({
      id: collectionIds.get(collection.id)!,
      libraryId: newLibraryId,
      title: collection.title,
      description: collection.description,
      category: collection.category,
      styleBrief: remapJsonText(collection.styleBrief, allIds),
      promptTemplate: collection.promptTemplate,
      defaultAspectRatio: collection.defaultAspectRatio,
      defaultImageSize: collection.defaultImageSize,
      sortOrder: collection.sortOrder,
      createdAt: now,
      updatedAt: now,
    }));

    const copiedFolders = folders.map((folder) => ({
      id: folderIds.get(folder.id)!,
      libraryId: newLibraryId,
      parentId: folder.parentId
        ? (folderIds.get(folder.parentId) ?? null)
        : null,
      title: folder.title,
      description: folder.description,
      sortOrder: folder.sortOrder,
      createdAt: now,
      updatedAt: now,
    }));

    const copiedPresets = presets.map((preset) => ({
      id: presetIds.get(preset.id)!,
      libraryId: newLibraryId,
      collectionId: preset.collectionId
        ? (collectionIds.get(preset.collectionId) ?? null)
        : null,
      title: preset.title,
      description: preset.description,
      category: preset.category,
      mediaType: preset.mediaType,
      promptTemplate: preset.promptTemplate,
      aspectRatio: preset.aspectRatio,
      imageSize: preset.imageSize,
      model: preset.model,
      textPolicy: preset.textPolicy,
      referencePolicy: preset.referencePolicy,
      settings: remapJsonText(preset.settings, allIds),
      sortOrder: preset.sortOrder,
      createdAt: now,
      updatedAt: now,
    }));

    const copiedAssets = assets.map((asset) => ({
      id: assetIds.get(asset.id)!,
      libraryId: newLibraryId,
      collectionId: asset.collectionId
        ? (collectionIds.get(asset.collectionId) ?? null)
        : null,
      folderId: asset.folderId ? (folderIds.get(asset.folderId) ?? null) : null,
      mediaType: asset.mediaType,
      role: asset.role,
      status: asset.status,
      title: asset.title,
      description: asset.description,
      altText: asset.altText,
      prompt: asset.prompt,
      model: asset.model,
      aspectRatio: asset.aspectRatio,
      imageSize: asset.imageSize,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      sizeBytes: asset.sizeBytes,
      objectKey: asset.objectKey,
      thumbnailObjectKey: asset.thumbnailObjectKey,
      sourceUrl: asset.sourceUrl,
      generationRunId: null,
      metadata: remapJsonText(asset.metadata, allIds),
      createdAt: now,
      updatedAt: now,
    }));

    const copiedLibrary = {
      id: newLibraryId,
      title: newTitle,
      description: source.description,
      customInstructions: source.customInstructions ?? "",
      styleBrief: remapJsonText(source.styleBrief, allIds),
      settings: remapJsonText(source.settings, allIds),
      canonicalLogoAssetId: source.canonicalLogoAssetId
        ? (assetIds.get(source.canonicalLogoAssetId) ?? null)
        : null,
      coverAssetId: source.coverAssetId
        ? (assetIds.get(source.coverAssetId) ?? null)
        : null,
      archivedAt: null,
      ownerEmail,
      orgId: getRequestOrgId(),
      visibility: "private" as const,
      createdAt: now,
      updatedAt: now,
    };

    await db.transaction(async (tx) => {
      await tx.insert(schema.assetLibraries).values(copiedLibrary);
      if (copiedCollections.length) {
        await tx.insert(schema.assetCollections).values(copiedCollections);
      }
      if (copiedFolders.length) {
        await tx.insert(schema.assetFolders).values(copiedFolders);
      }
      if (copiedPresets.length) {
        await tx.insert(schema.assetGenerationPresets).values(copiedPresets);
      }
      if (copiedAssets.length) {
        await tx.insert(schema.assets).values(copiedAssets);
      }
    });

    return {
      ...serializeLibrary(copiedLibrary),
      sourceLibraryId: id,
      copiedCounts: {
        collections: copiedCollections.length,
        folders: copiedFolders.length,
        presets: copiedPresets.length,
        assets: copiedAssets.length,
      },
      collections: copiedCollections,
      folders: copiedFolders,
      generationPresets: copiedPresets.map(serializeGenerationPreset),
      assets: copiedAssets.map(serializeAsset),
    };
  },
});
