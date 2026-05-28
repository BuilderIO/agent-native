import { defineAction } from "@agent-native/core";
import {
  writeAppState,
  readAppState,
  deleteAppState,
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
import { applyPromptTemplate } from "../server/lib/generation-presets.js";
import {
  compilePrompt,
  DEFAULT_GENERATION_REFERENCE_LIMIT,
  generateWithManagedImageProvider,
  isImageGenerationSetupError,
  selectReferences,
} from "../server/lib/generation.js";
import { getObject } from "../server/lib/storage.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import {
  ASPECT_RATIOS,
  GENERATION_INTENTS,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_QUALITY_TIERS,
  IMAGE_SIZES,
  STYLE_STRENGTHS,
  type AssetVariantState,
  type ImageCategory,
  type ImageModel,
  type ImageQualityTier,
  type StyleBrief,
} from "../shared/api.js";
import {
  requireGenerationSessionInLibrary,
  serializeAsset,
} from "./_helpers.js";

function resolveModelForTier(
  tier: ImageQualityTier | undefined,
  category: ImageCategory | undefined,
): ImageModel | undefined {
  if (!tier) return undefined;
  if (tier === "fast") return "gemini-3.1-flash-image";
  if (tier === "best") return "gemini-3-pro-image";
  return ["hero", "landing", "logo", "campaign"].includes(category ?? "")
    ? "gemini-3-pro-image"
    : "gemini-3.1-flash-image";
}

export default defineAction({
  description:
    "Generate one brand-consistent image from a library. Returns a verified image artifact with preview/download/embed URLs. Use generate-image-batch for multiple independent slots.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    presetId: z.string().optional(),
    sessionId: z.string().optional(),
    prompt: z.string().min(1),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    imageSize: z.enum(IMAGE_SIZES).optional(),
    model: z.enum(IMAGE_MODELS).optional(),
    tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
    intent: z.enum(GENERATION_INTENTS).default("generate"),
    styleStrength: z.enum(STYLE_STRENGTHS).default("balanced"),
    categories: z.array(z.enum(IMAGE_CATEGORIES)).optional(),
    referenceAssetIds: z
      .array(z.string())
      .optional()
      .describe(
        "Exact reference assets to use. When omitted, the server deterministically chooses a small relevant subset from the latest library references.",
      ),
    includeLogo: z.coerce.boolean().default(false),
    slotId: z.string().optional(),
    sourceAssetId: z.string().optional(),
    subjectAssetId: z
      .string()
      .optional()
      .describe(
        "Subject image to preserve for restyle/edit runs. The subject is attached before style references.",
      ),
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
    activateSessionAsset: z.coerce
      .boolean()
      .default(true)
      .describe(
        "When false, attach the output to the session without making it the active asset. Batch generation selects the active asset deterministically after all slots finish.",
      ),
  }),
  parallelSafe: true,
  run: async (args) => {
    await assertAccess("asset-library", args.libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, args.libraryId))
      .limit(1);
    if (!library) throw new Error("Asset library not found.");
    const session = args.sessionId
      ? await requireGenerationSessionInLibrary(args.sessionId, args.libraryId)
      : null;
    if (
      session?.presetId &&
      args.presetId &&
      args.presetId !== session.presetId
    ) {
      throw new Error("Generation preset does not match this session.");
    }
    if (
      session?.collectionId &&
      args.collectionId &&
      args.collectionId !== session.collectionId
    ) {
      throw new Error("Collection does not match this session.");
    }
    const resolvedPresetId = session?.presetId ?? args.presetId ?? undefined;
    const [preset] = resolvedPresetId
      ? await db
          .select()
          .from(schema.assetGenerationPresets)
          .where(eq(schema.assetGenerationPresets.id, resolvedPresetId))
          .limit(1)
      : [null];
    if (resolvedPresetId && !preset) {
      throw new Error("Generation preset not found.");
    }
    if (preset && preset.libraryId !== args.libraryId) {
      throw new Error("Generation preset does not belong to this library.");
    }
    if (
      session?.collectionId &&
      preset?.collectionId &&
      preset.collectionId !== session.collectionId
    ) {
      throw new Error(
        "Generation preset belongs to a different session collection.",
      );
    }
    if (
      !session?.collectionId &&
      args.collectionId &&
      preset?.collectionId &&
      preset.collectionId !== args.collectionId
    ) {
      throw new Error("Generation preset belongs to a different collection.");
    }
    const resolvedCollectionId =
      session?.collectionId ??
      preset?.collectionId ??
      args.collectionId ??
      undefined;
    const [collection] = resolvedCollectionId
      ? await db
          .select()
          .from(schema.assetCollections)
          .where(eq(schema.assetCollections.id, resolvedCollectionId))
          .limit(1)
      : [null];
    if (collection && collection.libraryId !== args.libraryId) {
      throw new Error("Collection does not belong to this asset library.");
    }
    if (args.intent === "edit" && !args.subjectAssetId) {
      throw new Error("Edit runs require subjectAssetId.");
    }
    if (args.subjectAssetId) {
      const [subject] = await db
        .select({
          id: schema.assets.id,
          libraryId: schema.assets.libraryId,
          mimeType: schema.assets.mimeType,
        })
        .from(schema.assets)
        .where(eq(schema.assets.id, args.subjectAssetId))
        .limit(1);
      if (!subject || subject.libraryId !== args.libraryId) {
        throw new Error("Subject asset must belong to this asset library.");
      }
      if (!subject.mimeType.startsWith("image/")) {
        throw new Error("Subject asset must be an image.");
      }
    }
    const styleBrief = {
      ...parseJson<StyleBrief>(library.styleBrief, {}),
      ...parseJson<StyleBrief>(collection?.styleBrief, {}),
    };
    const resolvedAspectRatio = (args.aspectRatio ??
      preset?.aspectRatio ??
      collection?.defaultAspectRatio ??
      "16:9") as (typeof ASPECT_RATIOS)[number];
    const resolvedImageSize = (args.imageSize ??
      preset?.imageSize ??
      collection?.defaultImageSize ??
      "2K") as (typeof IMAGE_SIZES)[number];
    const presetSettings = parseJson<{ tier?: ImageQualityTier }>(
      preset?.settings,
      {},
    );
    const resolvedTier = args.tier ?? presetSettings.tier;
    const category = (args.categories?.[0] ??
      preset?.category ??
      collection?.category) as ImageCategory | undefined;
    const resolvedModel = (args.model ??
      resolveModelForTier(resolvedTier, category) ??
      preset?.model ??
      "gemini-3.1-flash-image") as (typeof IMAGE_MODELS)[number];
    const resolvedCategories =
      args.categories ??
      (preset?.category ? ([preset.category] as any) : undefined);
    const promptForRun = applyPromptTemplate(
      preset?.promptTemplate,
      args.prompt,
    );
    const presetInstructions = preset
      ? [
          `Generation preset: ${preset.title}.`,
          preset.description ? `Preset description: ${preset.description}` : "",
          preset.textPolicy ? `Text policy: ${preset.textPolicy}` : "",
          preset.referencePolicy
            ? `Reference policy: ${preset.referencePolicy}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
    const references = await selectReferences({
      libraryId: args.libraryId,
      collectionId: resolvedCollectionId,
      categories: resolvedCategories,
      referenceAssetIds: args.referenceAssetIds,
      sourceAssetId: args.sourceAssetId,
      subjectAssetId: args.subjectAssetId,
      intent: args.intent,
      limit:
        args.intent !== "restyle" &&
        preset?.referencePolicy === "explicit" &&
        !args.referenceAssetIds?.length
          ? 0
          : DEFAULT_GENERATION_REFERENCE_LIMIT,
    });
    const compiledPrompt = compilePrompt({
      libraryTitle: library.title,
      styleBrief,
      customInstructions: [library.customInstructions, presetInstructions]
        .filter((item) => item?.trim())
        .join("\n\n"),
      prompt: promptForRun,
      referenceCount: references.length,
      includeLogo: args.includeLogo,
      category,
      intent: args.intent,
      styleStrength: args.styleStrength,
    });
    const runId = nanoid();
    const now = nowIso();
    // Capture identity at insert time so the org-admin audit log can filter
    // by owner / org without re-resolving who triggered the run later.
    const ownerEmail = getRequestUserEmail() ?? null;
    const orgId = getRequestOrgId() ?? null;
    const referenceSelection = {
      mode: args.referenceAssetIds?.length
        ? "explicit"
        : references.some((ref) => ref.selectionReason === "anchor")
          ? "anchored-deterministic"
          : "deterministic",
      limit: args.referenceAssetIds?.length
        ? args.referenceAssetIds.length
        : references.length,
      requestedAssetIds: args.referenceAssetIds ?? [],
      selectedAssetIds: references.map((ref) => ref.id),
      anchorAssetIds: references
        .filter((ref) => ref.selectionReason === "anchor")
        .map((ref) => ref.id),
      sourceAssetId: args.sourceAssetId,
      subjectAssetId: args.subjectAssetId,
      selectionReasons: Object.fromEntries(
        references.map((ref) => [ref.id, ref.selectionReason ?? "scored"]),
      ),
    };
    const settingsUsed = {
      model: resolvedModel,
      tier: resolvedTier ?? null,
      intent: args.intent,
      styleStrength: args.styleStrength,
      aspectRatio: resolvedAspectRatio,
      imageSize: resolvedImageSize,
      groundingMode: args.groundingMode,
      includeLogo: args.includeLogo,
      categories: resolvedCategories ?? [],
      collectionId: resolvedCollectionId ?? null,
      presetId: preset?.id ?? null,
      sessionId: session?.id ?? null,
      customInstructions: library.customInstructions ?? "",
    };
    const baseMetadata = {
      slotId: args.slotId,
      sourceAssetId: args.sourceAssetId,
      subjectAssetId: args.subjectAssetId,
      intent: args.intent,
      styleStrength: args.styleStrength,
      tier: resolvedTier,
      includeLogo: args.includeLogo,
      categories: resolvedCategories ?? [],
      presetId: preset?.id,
      sessionId: session?.id,
      referenceSelection,
      settingsUsed,
    };
    await db.insert(schema.assetGenerationRuns).values({
      id: runId,
      libraryId: args.libraryId,
      collectionId: resolvedCollectionId ?? null,
      presetId: preset?.id ?? null,
      sessionId: session?.id ?? null,
      prompt: args.prompt,
      compiledPrompt,
      model: resolvedModel,
      aspectRatio: resolvedAspectRatio,
      imageSize: resolvedImageSize,
      groundingMode: args.groundingMode,
      referenceAssetIds: stringifyJson(references.map((ref) => ref.id)),
      status: "pending",
      source: args.source,
      callerAppId: args.callerAppId ?? null,
      ownerEmail,
      orgId,
      metadata: stringifyJson(baseMetadata),
      createdAt: now,
    });

    const slotId = args.slotId ?? runId;
    await upsertVariantSlot({
      runId,
      libraryId: args.libraryId,
      collectionId: resolvedCollectionId ?? null,
      presetId: preset?.id ?? null,
      sessionId: session?.id ?? null,
      prompt: args.prompt,
      slotId,
      status: "pending",
    });

    try {
      const generated = await generateWithManagedImageProvider({
        prompt: promptForRun,
        compiledPrompt,
        references,
        model: resolvedModel,
        aspectRatio: resolvedAspectRatio,
        imageSize: resolvedImageSize,
        groundingMode: args.groundingMode,
        intent: args.intent,
        styleStrength: args.styleStrength,
        runId,
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        source: args.source,
        callerAppId: args.callerAppId,
      });
      await deleteAppState("image-generation-setup").catch(() => {});
      let image = generated.image;
      let mimeType = generated.mimeType;
      if (args.includeLogo && library.canonicalLogoAssetId) {
        const [logo] = await db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.id, library.canonicalLogoAssetId))
          .limit(1);
        if (logo) {
          image = await compositeLogo({
            image,
            logo: await getObject(logo.objectKey),
          });
          mimeType = "image/png";
        }
      }
      if (await wasSlotDismissed(args.libraryId, slotId)) {
        await db
          .update(schema.assetGenerationRuns)
          .set({
            status: "completed",
            completedAt: nowIso(),
            metadata: stringifyJson({
              ...baseMetadata,
              dismissed: true,
              slotId,
              referenceSelection,
              settingsUsed,
              provider: generated.provider,
              providerGenerationId: generated.providerGenerationId,
              creditsCharged: generated.creditsCharged,
            }),
          })
          .where(eq(schema.assetGenerationRuns.id, runId));
        return {
          runId,
          dismissed: true,
          artifactType: "image",
          Artifacts: [],
        };
      }
      const asset = await createAssetFromBuffer({
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        buffer: image,
        mimeType,
        role: "generated",
        status: "candidate",
        prompt: args.prompt,
        model: generated.model,
        aspectRatio: resolvedAspectRatio,
        imageSize: resolvedImageSize,
        generationRunId: runId,
        metadata: {
          provider: generated.provider,
          compiledPrompt,
          referenceAssetIds: references.map((ref) => ref.id),
          sourceAssetId: args.sourceAssetId,
          subjectAssetId: args.subjectAssetId,
          intent: args.intent,
          styleStrength: args.styleStrength,
          tier: resolvedTier,
          includeLogo: args.includeLogo,
          presetId: preset?.id,
          sessionId: session?.id,
          generated: true,
          sourceUrl: generated.sourceUrl,
          providerGenerationId: generated.providerGenerationId,
          creditsCharged: generated.creditsCharged,
        },
        category,
      });
      if (session) {
        const itemCreatedAt = nowIso();
        await db.insert(schema.assetGenerationSessionItems).values({
          id: nanoid(),
          sessionId: session.id,
          assetId: asset.id,
          generationRunId: runId,
          role: args.activateSessionAsset ? "active" : "candidate",
          note: null,
          sortOrder: 100,
          createdAt: itemCreatedAt,
        });
        if (args.activateSessionAsset) {
          await db
            .update(schema.assetGenerationSessions)
            .set({ activeAssetId: asset.id, updatedAt: itemCreatedAt })
            .where(eq(schema.assetGenerationSessions.id, session.id));
        }
      }
      await db
        .update(schema.assetGenerationRuns)
        .set({
          status: "completed",
          completedAt: nowIso(),
          metadata: stringifyJson({
            ...baseMetadata,
            assetId: asset.id,
            outputAssetIds: [asset.id],
            slotId,
            sourceAssetId: args.sourceAssetId,
            subjectAssetId: args.subjectAssetId,
            intent: args.intent,
            styleStrength: args.styleStrength,
            tier: resolvedTier,
            includeLogo: args.includeLogo,
            categories: resolvedCategories ?? [],
            referenceSelection,
            settingsUsed,
            provider: generated.provider,
            providerGenerationId: generated.providerGenerationId,
            creditsCharged: generated.creditsCharged,
          }),
        })
        .where(eq(schema.assetGenerationRuns.id, runId));
      const serialized = serializeAsset(asset);
      await upsertVariantSlot({
        runId,
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        presetId: preset?.id ?? null,
        sessionId: session?.id ?? null,
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
      if (isImageGenerationSetupError(err)) {
        await writeAppState("image-generation-setup", {
          status: "needs-setup",
          message,
          at: nowIso(),
        }).catch(() => {});
      }
      await db
        .update(schema.assetGenerationRuns)
        .set({ status: "failed", error: message, completedAt: nowIso() })
        .where(eq(schema.assetGenerationRuns.id, runId));
      if (await wasSlotDismissed(args.libraryId, slotId)) throw err;
      await upsertVariantSlot({
        runId,
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        presetId: preset?.id ?? null,
        sessionId: session?.id ?? null,
        prompt: args.prompt,
        slotId,
        status: "failed",
        error: message,
      });
      throw err;
    }
  },
});

async function wasSlotDismissed(
  libraryId: string,
  slotId: string,
): Promise<boolean> {
  const raw = (await readAppState("asset-variants")) as unknown | null;
  const legacyRaw =
    raw ??
    ((await readAppState("image-variants").catch(() => null)) as
      | unknown
      | null);
  const state = (legacyRaw ?? null) as AssetVariantState | null;
  if (!state) return true;
  if (state.libraryId !== libraryId) return false;
  return !state.slots.some((s) => s.slotId === slotId);
}

async function upsertVariantSlot(input: {
  runId: string;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  sessionId?: string | null;
  prompt: string;
  slotId: string;
  status: "pending" | "ready" | "failed";
  assetId?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}) {
  const current = (await readAppState("asset-variants")) as unknown | null;
  const legacyCurrent =
    current ??
    ((await readAppState("image-variants").catch(() => null)) as
      | unknown
      | null);
  const previous = (legacyCurrent ?? null) as AssetVariantState | null;
  const state: AssetVariantState =
    previous?.libraryId === input.libraryId &&
    (previous.sessionId ?? null) === (input.sessionId ?? null)
      ? previous
      : {
          runId: input.runId,
          libraryId: input.libraryId,
          collectionId: input.collectionId,
          presetId: input.presetId ?? null,
          sessionId: input.sessionId ?? null,
          prompt: input.prompt,
          slots: [],
          updatedAt: nowIso(),
        };
  state.runId = input.runId;
  state.collectionId = input.collectionId ?? null;
  state.presetId = input.presetId ?? null;
  state.sessionId = input.sessionId ?? null;
  state.prompt = input.prompt;
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
    "asset-variants",
    state as unknown as Record<string, unknown>,
  );
  await deleteAppState("image-variants").catch(() => {});
}
