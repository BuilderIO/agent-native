import { defineAction } from "@agent-native/core";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { createAssetFromBuffer } from "../server/lib/assets.js";
import { compositeLogo } from "../server/lib/image-processing.js";
import {
  compilePrompt,
  generateWithGemini,
  selectReferences,
} from "../server/lib/generation.js";
import { getObject } from "../server/lib/storage.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import {
  ASPECT_RATIOS,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
  type ImageVariantState,
  type StyleBrief,
} from "../shared/api.js";
import { serializeAsset } from "./_helpers.js";

export default defineAction({
  description:
    "Generate one brand-consistent image from a library. Returns a verified image artifact with preview/download/embed URLs. Use generate-image-batch for multiple independent slots.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    prompt: z.string().min(1),
    aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
    imageSize: z.enum(IMAGE_SIZES).default("2K"),
    model: z.enum(IMAGE_MODELS).default("gemini-3.1-flash-image-preview"),
    categories: z.array(z.enum(IMAGE_CATEGORIES)).optional(),
    includeLogo: z.coerce.boolean().default(false),
    slotId: z.string().optional(),
    sourceAssetId: z.string().optional(),
    groundingMode: z.enum(["auto", "off", "google-search"]).default("auto"),
    // Audit metadata. Defaulted to "chat" because that's the agent's typical
    // entry point; the UI Generate popover and A2A callers override.
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design'). Audit log filters on this.",
      ),
  }),
  parallelSafe: true,
  run: async (args) => {
    await assertAccess("image-library", args.libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.imageLibraries)
      .where(eq(schema.imageLibraries.id, args.libraryId))
      .limit(1);
    if (!library) throw new Error("Image library not found.");
    const [collection] = args.collectionId
      ? await db
          .select()
          .from(schema.imageCollections)
          .where(eq(schema.imageCollections.id, args.collectionId))
          .limit(1)
      : [null];
    const styleBrief = {
      ...parseJson<StyleBrief>(library.styleBrief, {}),
      ...parseJson<StyleBrief>(collection?.styleBrief, {}),
    };
    const references = await selectReferences({
      libraryId: args.libraryId,
      collectionId: args.collectionId,
      categories: args.categories,
      sourceAssetId: args.sourceAssetId,
      limit: 12,
    });
    const category = args.categories?.[0] ?? collection?.category;
    const compiledPrompt = compilePrompt({
      libraryTitle: library.title,
      styleBrief,
      prompt: args.prompt,
      referenceCount: references.length,
      includeLogo: args.includeLogo,
      category: category as any,
    });
    const runId = nanoid();
    const now = nowIso();
    // Capture identity at insert time so the org-admin audit log can filter
    // by owner / org without re-resolving who triggered the run later.
    const ownerEmail = getRequestUserEmail() ?? null;
    const orgId = getRequestOrgId() ?? null;
    await db.insert(schema.imageGenerationRuns).values({
      id: runId,
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? null,
      prompt: args.prompt,
      compiledPrompt,
      model: args.model,
      aspectRatio: args.aspectRatio,
      imageSize: args.imageSize,
      groundingMode: args.groundingMode,
      referenceAssetIds: stringifyJson(references.map((ref) => ref.id)),
      status: "pending",
      source: args.source,
      callerAppId: args.callerAppId ?? null,
      ownerEmail,
      orgId,
      metadata: stringifyJson({
        slotId: args.slotId,
        sourceAssetId: args.sourceAssetId,
      }),
      createdAt: now,
    });

    const slotId = args.slotId ?? runId;
    await upsertVariantSlot({
      runId,
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? null,
      prompt: args.prompt,
      slotId,
      status: "pending",
    });

    try {
      const generated = await generateWithGemini({
        prompt: args.prompt,
        compiledPrompt,
        references,
        model: args.model,
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
        groundingMode: args.groundingMode,
      });
      let image = generated.image;
      let mimeType = generated.mimeType;
      if (args.includeLogo && library.canonicalLogoAssetId) {
        const [logo] = await db
          .select()
          .from(schema.imageAssets)
          .where(eq(schema.imageAssets.id, library.canonicalLogoAssetId))
          .limit(1);
        if (logo) {
          image = await compositeLogo({
            image,
            logo: await getObject(logo.objectKey),
          });
          mimeType = "image/png";
        }
      }
      const asset = await createAssetFromBuffer({
        libraryId: args.libraryId,
        collectionId: args.collectionId ?? null,
        buffer: image,
        mimeType,
        role: "generated",
        status: "candidate",
        prompt: args.prompt,
        model: generated.model,
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
        generationRunId: runId,
        metadata: {
          provider: generated.provider,
          compiledPrompt,
          referenceAssetIds: references.map((ref) => ref.id),
          sourceAssetId: args.sourceAssetId,
          includeLogo: args.includeLogo,
          generated: true,
        },
        category: category as any,
      });
      await db
        .update(schema.imageGenerationRuns)
        .set({
          status: "completed",
          completedAt: nowIso(),
          metadata: stringifyJson({
            assetId: asset.id,
            slotId,
            sourceAssetId: args.sourceAssetId,
            includeLogo: args.includeLogo,
            categories: args.categories ?? [],
            provider: generated.provider,
          }),
        })
        .where(eq(schema.imageGenerationRuns.id, runId));
      const serialized = serializeAsset(asset);
      await upsertVariantSlot({
        runId,
        libraryId: args.libraryId,
        collectionId: args.collectionId ?? null,
        prompt: args.prompt,
        slotId,
        status: "ready",
        assetId: asset.id,
        previewUrl: serialized.previewUrl,
        thumbnailUrl: serialized.thumbnailUrl,
      });
      return {
        ...serialized,
        runId,
        artifactType: "image",
        Artifacts: [
          `Image: ${serialized.url} (ID: ${asset.id}, Run: ${runId})`,
        ],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Image generation failed.";
      await db
        .update(schema.imageGenerationRuns)
        .set({ status: "failed", error: message, completedAt: nowIso() })
        .where(eq(schema.imageGenerationRuns.id, runId));
      await upsertVariantSlot({
        runId,
        libraryId: args.libraryId,
        collectionId: args.collectionId ?? null,
        prompt: args.prompt,
        slotId,
        status: "failed",
        error: message,
      });
      throw err;
    }
  },
});

async function upsertVariantSlot(input: {
  runId: string;
  libraryId: string;
  collectionId?: string | null;
  prompt: string;
  slotId: string;
  status: "pending" | "ready" | "failed";
  assetId?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}) {
  const current = (await readAppState("image-variants")) as unknown | null;
  const previous = (current ?? null) as ImageVariantState | null;
  const state: ImageVariantState =
    previous?.libraryId === input.libraryId
      ? previous
      : {
          runId: input.runId,
          libraryId: input.libraryId,
          collectionId: input.collectionId,
          prompt: input.prompt,
          slots: [],
          updatedAt: nowIso(),
        };
  const nextSlot = {
    slotId: input.slotId,
    status: input.status,
    assetId: input.assetId,
    previewUrl: input.previewUrl,
    thumbnailUrl: input.thumbnailUrl,
    error: input.error,
  };
  const index = state.slots.findIndex((slot) => slot.slotId === input.slotId);
  if (index >= 0) state.slots[index] = nextSlot;
  else state.slots.push(nextSlot);
  state.updatedAt = nowIso();
  await writeAppState(
    "image-variants",
    state as unknown as Record<string, unknown>,
  );
}
