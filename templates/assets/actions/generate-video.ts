import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DEFAULT_GENERATION_REFERENCE_LIMIT,
  selectReferences,
} from "../server/lib/generation.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { getObject } from "../server/lib/storage.js";
import {
  compileVideoPrompt,
  startGeminiVideoGeneration,
  type VideoReferenceImage,
} from "../server/lib/video-generation.js";
import { completeVideoGenerationRun } from "../server/lib/video-runs.js";
import {
  IMAGE_CATEGORIES,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type StyleBrief,
} from "../shared/api.js";
import { serializeAsset, serializeGenerationRun } from "./_helpers.js";

export default defineAction({
  description:
    "Start an async Veo video generation run from a brand kit/library. Use a media-type @mention with refId video to choose this instead of image generation, and use a brand-kit @mention as libraryId. Poll the returned run with refresh-generation-run until it completes and creates a video asset.",
  schema: z.object({
    libraryId: z
      .string()
      .optional()
      .describe(
        "Brand kit/library ID. Pass the refId from a brand-kit @mention, or choose a kit from view-screen/list-libraries.",
      ),
    folderId: z.string().min(1).nullable().optional(),
    collectionId: z.string().optional(),
    prompt: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    aspectRatio: z.enum(VIDEO_ASPECT_RATIOS).default("16:9"),
    durationSeconds: z.coerce
      .number()
      .pipe(z.union([z.literal(4), z.literal(6), z.literal(8)]))
      .default(8),
    resolution: z.enum(VIDEO_RESOLUTIONS).default("720p"),
    model: z.enum(VIDEO_MODELS).default("veo-3.1-generate-preview"),
    category: z.enum(IMAGE_CATEGORIES).default("video"),
    referenceAssetIds: z
      .array(z.string())
      .max(3)
      .optional()
      .describe(
        "Up to three image assets to guide product, subject, or style.",
      ),
    sourceAssetId: z
      .string()
      .optional()
      .describe("Optional starting image asset for image-to-video."),
    negativePrompt: z.string().optional(),
    enhancePrompt: z.coerce.boolean().default(true),
    generateAudio: z.coerce.boolean().default(true),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z.string().optional(),
    waitForCompletion: z.coerce.boolean().default(false),
  }),
  run: async (input) => {
    const libraryId = input.libraryId;
    if (!libraryId) {
      throw new Error(
        "No brand kit selected. Tag a brand kit with @ or pass libraryId.",
      );
    }
    const args = {
      ...input,
      libraryId,
    };
    await assertAccess("asset-library", args.libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, args.libraryId))
      .limit(1);
    if (!library) throw new Error("Asset library not found.");
    const [collection] = args.collectionId
      ? await db
          .select()
          .from(schema.assetCollections)
          .where(eq(schema.assetCollections.id, args.collectionId))
          .limit(1)
      : [null];
    if (collection && collection.libraryId !== args.libraryId) {
      throw new Error("Collection does not belong to this asset library.");
    }
    if (args.folderId !== undefined && args.folderId !== null) {
      const [folder] = await db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.id, args.folderId))
        .limit(1);
      if (!folder || folder.libraryId !== args.libraryId) {
        throw new Error("Folder does not belong to this asset library.");
      }
    }

    let sourceImage: VideoReferenceImage | null = null;
    if (args.sourceAssetId) {
      const [sourceAsset] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, args.sourceAssetId))
        .limit(1);
      if (!sourceAsset || sourceAsset.libraryId !== args.libraryId) {
        throw new Error("Source asset does not belong to this asset library.");
      }
      if (!sourceAsset.mimeType.startsWith("image/")) {
        throw new Error("sourceAssetId must refer to an image asset.");
      }
      sourceImage = {
        id: sourceAsset.id,
        mimeType: sourceAsset.mimeType,
        data: (await getObject(sourceAsset.objectKey)).toString("base64"),
        role: sourceAsset.role,
      };
    }

    const styleBrief = {
      ...parseJson<StyleBrief>(library.styleBrief, {}),
      ...parseJson<StyleBrief>(collection?.styleBrief, {}),
    };
    const references = sourceImage
      ? []
      : await selectReferences({
          libraryId: args.libraryId,
          collectionId: args.collectionId,
          categories: [args.category],
          referenceAssetIds: args.referenceAssetIds,
          limit: Math.min(3, DEFAULT_GENERATION_REFERENCE_LIMIT),
        });
    const referenceImages = references.slice(0, 3).map((ref) => ({
      id: ref.id,
      mimeType: ref.mimeType,
      data: ref.data,
      role: ref.role,
    }));
    const compiledPrompt = compileVideoPrompt({
      libraryTitle: library.title,
      styleBrief,
      customInstructions: library.customInstructions,
      prompt: args.prompt,
      referenceCount: sourceImage ? 1 : referenceImages.length,
      includeAudio: args.generateAudio,
    });
    const runId = nanoid();
    const now = nowIso();
    const ownerEmail = getRequestUserEmail() ?? null;
    const orgId = getRequestOrgId() ?? null;
    const referenceAssetIds = sourceImage
      ? [sourceImage.id]
      : referenceImages.map((ref) => ref.id);
    const settingsUsed = {
      model: args.model,
      aspectRatio: args.aspectRatio,
      durationSeconds: args.durationSeconds,
      resolution: args.resolution,
      negativePrompt: args.negativePrompt ?? null,
      enhancePrompt: args.enhancePrompt,
      generateAudio: args.generateAudio,
      mediaType: "video",
      category: args.category,
      folderId: args.folderId ?? null,
      collectionId: args.collectionId ?? null,
    };
    const baseMetadata = {
      mediaType: "video",
      title: args.title ?? null,
      description: args.description ?? null,
      category: args.category,
      folderId: args.folderId ?? null,
      sourceAssetId: args.sourceAssetId ?? null,
      referenceSelection: {
        mode: args.referenceAssetIds?.length
          ? "explicit"
          : sourceImage
            ? "source-image"
            : "sampled-latest",
        selectedAssetIds: referenceAssetIds,
      },
      settingsUsed,
    };
    await db.insert(schema.assetGenerationRuns).values({
      id: runId,
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? null,
      presetId: null,
      sessionId: null,
      prompt: args.prompt,
      compiledPrompt,
      mediaType: "video",
      model: args.model,
      aspectRatio: args.aspectRatio,
      imageSize: args.resolution,
      durationSeconds: args.durationSeconds,
      resolution: args.resolution,
      groundingMode: "off",
      referenceAssetIds: stringifyJson(referenceAssetIds),
      status: "pending",
      source: args.source,
      callerAppId: args.callerAppId ?? null,
      ownerEmail,
      orgId,
      metadata: stringifyJson(baseMetadata),
      createdAt: now,
    });

    const operation = await startGeminiVideoGeneration({
      model: args.model,
      compiledPrompt,
      aspectRatio: args.aspectRatio,
      durationSeconds: args.durationSeconds,
      resolution: args.resolution,
      sourceImage,
      referenceImages,
      negativePrompt: args.negativePrompt,
      enhancePrompt: args.enhancePrompt,
      generateAudio: args.generateAudio,
    });
    const processingMetadata = {
      ...baseMetadata,
      operationName: operation.operationName,
      provider: "gemini",
      providerStatus: "processing",
      startedAt: nowIso(),
    };
    const run = {
      id: runId,
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? null,
      presetId: null,
      sessionId: null,
      prompt: args.prompt,
      compiledPrompt,
      mediaType: "video",
      model: args.model,
      aspectRatio: args.aspectRatio,
      imageSize: args.resolution,
      durationSeconds: args.durationSeconds,
      resolution: args.resolution,
      groundingMode: "off",
      referenceAssetIds: stringifyJson(referenceAssetIds),
      status: "processing",
      error: null,
      metadata: stringifyJson(processingMetadata),
      createdAt: now,
      completedAt: null,
      source: args.source,
      callerAppId: args.callerAppId ?? null,
      ownerEmail,
      orgId,
    };
    await db
      .update(schema.assetGenerationRuns)
      .set({ status: "processing", metadata: run.metadata })
      .where(eq(schema.assetGenerationRuns.id, runId));

    if (args.waitForCompletion) {
      const completed = await completeVideoGenerationRun(run);
      if (completed.status === "completed") {
        const asset = serializeAsset(completed.asset);
        return {
          run: serializeGenerationRun(completed.run),
          asset,
          artifactType: "video",
          Artifacts: [`Video: ${asset.url} (ID: ${asset.id}, Run: ${runId})`],
        };
      }
    }

    return {
      run: serializeGenerationRun(run),
      operationName: operation.operationName,
      artifactType: "video",
      message:
        "Video generation started. Call refresh-generation-run with this runId until status is completed.",
    };
  },
});
