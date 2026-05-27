import { defineAction } from "@agent-native/core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { createAssetFromBuffer } from "../server/lib/assets.js";
import { serializeAsset, serializeLibrary } from "./_helpers.js";
import {
  DEFAULT_LIBRARY_PRESET_VERSION,
  getLibraryPreset,
  type LibraryPresetReferenceImage,
} from "../shared/library-presets.js";

const ACTION_DIR = path.dirname(fileURLToPath(import.meta.url));

function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".avif") return "image/avif";
  return "image/webp";
}

async function readLocalPresetReference(publicPath: string) {
  const relativePath = publicPath.replace(/^\/+/, "");
  const candidatePaths = [
    path.join(process.cwd(), "public", relativePath),
    path.join(process.cwd(), "dist", relativePath),
    path.join(process.cwd(), "templates", "assets", "public", relativePath),
    path.resolve(ACTION_DIR, "..", "public", relativePath),
    path.resolve(ACTION_DIR, "..", "dist", relativePath),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return {
        buffer: await fs.readFile(candidatePath),
        mimeType: mimeTypeFromPath(candidatePath),
        objectKey: publicPath,
      };
    } catch {
      // Try the next build/dev layout.
    }
  }

  return null;
}

async function loadPresetReferenceImage(
  reference: LibraryPresetReferenceImage,
) {
  const local = await readLocalPresetReference(reference.path);
  if (local) return local;

  const response = await fetch(reference.downloadUrl, {
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      "user-agent":
        "agent-native-assets-template/1.0 (preset reference seeding)",
    },
  });
  if (!response.ok) {
    throw new Error(`Reference image fetch failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (!contentType?.startsWith("image/")) {
    throw new Error(`Reference image returned ${contentType || "unknown"}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: contentType,
    objectKey: null,
  };
}

export default defineAction({
  description:
    "Create an editable asset library from a built-in style preset, such as tactile 3D, storybook painting, clay studio, or paper-cut collage.",
  schema: z.object({
    presetId: z.string().min(1).describe("Built-in library preset ID"),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("Optional custom name for the new library"),
    description: z
      .string()
      .optional()
      .describe("Optional custom description for the new library"),
  }),
  run: async ({ presetId, title, description }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const preset = getLibraryPreset(presetId);
    if (!preset) {
      throw new Error(`Unknown asset library preset: ${presetId}`);
    }

    const now = nowIso();
    const row = {
      id: nanoid(),
      title: title?.trim() || preset.title,
      description: description?.trim() || preset.description,
      customInstructions: preset.customInstructions,
      styleBrief: stringifyJson(preset.styleBrief),
      settings: stringifyJson({
        source: "default-library-preset",
        presetId: preset.id,
        presetVersion: DEFAULT_LIBRARY_PRESET_VERSION,
        tags: preset.tags,
        samplePrompts: preset.samplePrompts,
        referenceImages: preset.referenceImages.map((reference) => ({
          id: reference.id,
          title: reference.title,
          path: reference.path,
          sourceUrl: reference.sourceUrl,
          sourceName: reference.sourceName,
          author: reference.author,
          licenseName: reference.licenseName,
          licenseUrl: reference.licenseUrl,
        })),
      }),
      coverAssetId: null as string | null,
      ownerEmail,
      orgId: getRequestOrgId(),
      createdAt: now,
      updatedAt: now,
    };

    const db = getDb();
    await db.insert(schema.assetLibraries).values(row);

    const referenceAssets = [];
    const referenceSeedErrors = [];
    for (const reference of preset.referenceImages) {
      try {
        const image = await loadPresetReferenceImage(reference);
        const asset = await createAssetFromBuffer({
          libraryId: row.id,
          buffer: image.buffer,
          mimeType: image.mimeType,
          role: "style_reference",
          status: "reference",
          title: reference.title,
          description: reference.description,
          altText: reference.title,
          sourceUrl: reference.sourceUrl,
          objectKey: image.objectKey ?? undefined,
          thumbnailObjectKey: image.objectKey ?? undefined,
          metadata: {
            category: "style-only",
            presetId: preset.id,
            presetVersion: DEFAULT_LIBRARY_PRESET_VERSION,
            presetReferenceId: reference.id,
            referencePath: reference.path,
            sourceName: reference.sourceName,
            sourceUrl: reference.sourceUrl,
            author: reference.author,
            licenseName: reference.licenseName,
            licenseUrl: reference.licenseUrl,
          },
          category: "style-only",
        });
        referenceAssets.push(asset);
      } catch (error) {
        referenceSeedErrors.push({
          id: reference.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (referenceAssets[0]) {
      row.coverAssetId = referenceAssets[0].id;
      await db
        .update(schema.assetLibraries)
        .set({ coverAssetId: referenceAssets[0].id, updatedAt: now })
        .where(eq(schema.assetLibraries.id, row.id));
    }

    return {
      ...serializeLibrary(row),
      referenceCount: referenceAssets.length,
      generatedCount: 0,
      videoCount: 0,
      preset,
      referenceAssets: referenceAssets.map(serializeAsset),
      referenceSeedErrors,
    };
  },
});
