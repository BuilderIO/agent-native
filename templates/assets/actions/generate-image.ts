import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createAssetFromBuffer } from "../server/lib/assets.js";
import { applyPromptTemplate } from "../server/lib/generation-presets.js";
import {
  compilePrompt,
  DEFAULT_GENERATION_REFERENCE_LIMIT,
  generateWithManagedImageProvider,
  isImageGenerationSetupError,
  resolveImageModelForRequest,
  selectReferences,
  type ReferenceForGeneration,
} from "../server/lib/generation.js";
import {
  applyPresetSkeleton,
  compositeLogo,
  maskFromManualMaskAlpha,
  maskFromPlateAlpha,
} from "../server/lib/image-processing.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import {
  clampCutoutAspectRatio,
  normalizePresetSkeletonSpec,
  skeletonUsesCanonicalLogo,
} from "../server/lib/preset-skeleton.js";
import { getObject } from "../server/lib/storage.js";
import {
  ASPECT_RATIOS,
  GENERATION_INTENTS,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_QUALITY_TIERS,
  IMAGE_SIZES,
  STYLE_STRENGTHS,
  supportedAspectRatiosForModel,
  type AspectRatio,
  type ImageCategory,
  type ImageQualityTier,
  type PresetSkeletonSpec,
  type StyleBrief,
} from "../shared/api.js";
import {
  requireGenerationSessionInLibrary,
  serializeAsset,
} from "./_helpers.js";
import { readImageModelDefault } from "./_image-model-default.js";
import { withToolActivity } from "./_tool-activity.js";
import { upsertVariantSlot, wasVariantSlotDismissed } from "./variant-slots.js";

const IMAGE_GENERATION_TOOL_TIMEOUT_MS = 12 * 60_000;

export default defineAction({
  description:
    "Generate one brand-consistent image from a brand kit/library. This is synchronous for images and returns the final asset with preview/download/embed URLs. Use @brand-kit mentions as libraryId and @preset mentions as presetId when present. Use generate-image-batch for multiple independent slots; do not poll image runs after this action returns.",
  schema: z.object({
    libraryId: z
      .string()
      .optional()
      .describe(
        "Brand kit/library ID. Pass the refId from a brand-kit @mention, or choose a kit from view-screen/list-libraries.",
      ),
    collectionId: z.string().optional(),
    presetId: z
      .string()
      .optional()
      .describe(
        "Generation preset ID (from a @preset mention or list-generation-presets). A preset already defines aspectRatio, imageSize, model, tier, and category. When you set presetId, OMIT those args so the preset's values are used; only pass one of them when the user explicitly asks for a value that differs from the preset.",
      ),
    sessionId: z.string().optional(),
    prompt: z.string().min(1),
    embeddedText: z
      .string()
      .optional()
      .describe(
        "Exact words to render inside the image, spelled exactly. When set, the image is allowed to contain this text; when omitted, the image avoids embedded text.",
      ),
    textPlacement: z
      .string()
      .optional()
      .describe(
        "Where/how the embedded text should appear, e.g. 'centered headline', 'lower-left label'.",
      ),
    aspectRatio: z
      .enum(ASPECT_RATIOS)
      .optional()
      .describe(
        "Image aspect ratio. When a presetId is set, omit this — the preset's aspect ratio is used. Pass a value only when there is no preset, or when the user explicitly asks for a ratio different from the preset's. Note: OpenAI image models support only 1:1, 2:3, and 3:2; gpt-image-1 is used for transparent cutout skeleton subjects, while other ratios (16:9, 9:16, 4:5, 21:9, …) require a Gemini model.",
      ),
    imageSize: z
      .enum(IMAGE_SIZES)
      .optional()
      .describe(
        "Output resolution tier. When a presetId is set, omit this — the preset's size is used unless the user explicitly requests a different one.",
      ),
    model: z
      .enum(IMAGE_MODELS)
      .optional()
      .describe(
        "Image model. Omit to use the user's picker default. Gemini models accept any aspectRatio; gpt-image-2 is the normal opaque OpenAI default, while gpt-image-1 is reserved for transparent cutout skeletons. OpenAI image models support ONLY 1:1, 2:3, and 3:2 — do not pair them with other ratios, choose a Gemini model (e.g. gemini-3-pro-image) for those instead.",
      ),
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
    includeLogo: z.coerce
      .boolean()
      .optional()
      .describe(
        "Composite the library's pixel-perfect canonical logo onto the finished image. When omitted, the selected preset's logo setting is used; pass an explicit value to override it. No-op if the library has no canonical logo.",
      ),
    slotId: z.string().optional(),
    variantBatchId: z.string().optional(),
    variantScopeId: z
      .string()
      .optional()
      .describe(
        "Internal UI state scope for live candidate slots. Usually omitted; embedded picker UIs pass a browser-tab scope.",
      ),
    dismissible: z.coerce
      .boolean()
      .default(true)
      .describe(
        "When false, always create the finished asset even if live variant slot UI state is cleared before the provider returns. Picker batch candidates use this so every requested option is returned.",
      ),
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
  timeoutMs: IMAGE_GENERATION_TOOL_TIMEOUT_MS,
  run: async (input, context?: ActionRunContext) => {
    const imageModelDefault = await readImageModelDefault();
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
    const presetSettings = parseJson<{
      tier?: ImageQualityTier;
      includeLogo?: boolean;
      skeletonSpec?: unknown;
    }>(preset?.settings, {});
    const skeletonSpec = normalizePresetSkeletonSpec(
      presetSettings.skeletonSpec,
    );
    const isSkeletonCutout = skeletonSpec?.contentMode === "cutout";
    const outputAspectRatio = (args.aspectRatio ??
      preset?.aspectRatio ??
      collection?.defaultAspectRatio ??
      "16:9") as AspectRatio;
    const resolvedImageSize = (args.imageSize ??
      preset?.imageSize ??
      collection?.defaultImageSize ??
      "2K") as (typeof IMAGE_SIZES)[number];
    const resolvedTier = args.tier ?? presetSettings.tier;
    const requestedIncludeLogo =
      args.includeLogo ?? presetSettings.includeLogo ?? false;
    const resolvedIncludeLogo =
      requestedIncludeLogo && !skeletonUsesCanonicalLogo(skeletonSpec);
    const category = (args.categories?.[0] ??
      preset?.category ??
      collection?.category) as ImageCategory | undefined;
    const selectedModel = resolveImageModelForRequest({
      explicitModel: args.model,
      imageModelDefault,
      explicitTier: args.tier,
      resolvedTier,
      category,
      presetModel: preset?.model as (typeof IMAGE_MODELS)[number] | undefined,
      embeddedText: args.embeddedText,
    }) as (typeof IMAGE_MODELS)[number];
    if (
      isSkeletonCutout &&
      args.model &&
      args.model !== "gpt-image-1" &&
      args.model !== "gpt-image-2"
    ) {
      throw new Error(
        "Cutout skeleton presets require gpt-image-1 for transparent output or gpt-image-2 for mask inpainting. Remove the explicit model override or choose one of those models.",
      );
    }
    const resolvedModel = (
      isSkeletonCutout && selectedModel !== "gpt-image-2"
        ? "gpt-image-1"
        : selectedModel
    ) as (typeof IMAGE_MODELS)[number];
    if (isSkeletonCutout && selectedModel !== resolvedModel) {
      logSkeletonGeneration("model_overridden", {
        presetId: preset?.id,
        selectedModel,
        model: resolvedModel,
      });
    }
    const resolvedCategories =
      args.categories ??
      (preset?.category ? ([preset.category] as any) : undefined);
    const skeletonReferenceExclusionIds =
      skeletonCompositeAssetIds(skeletonSpec);
    const skeletonAssets = skeletonSpec
      ? await loadSkeletonAssets({
          spec: skeletonSpec,
          libraryId: args.libraryId,
          canonicalLogoAssetId: library.canonicalLogoAssetId,
          appendCanonicalLogo:
            resolvedIncludeLogo &&
            !(isSkeletonCutout && resolvedModel === "gpt-image-2"),
        })
      : null;
    const useSkeletonInpaint =
      isSkeletonCutout &&
      Boolean(skeletonAssets?.backgroundAsset) &&
      resolvedModel === "gpt-image-2";
    const resolvedAspectRatio =
      isSkeletonCutout && !useSkeletonInpaint
        ? clampCutoutAspectRatio({
            aspectRatio: outputAspectRatio,
            supported: supportedAspectRatiosForModel("gpt-image-1"),
          })
        : outputAspectRatio;
    if (
      isSkeletonCutout &&
      !useSkeletonInpaint &&
      outputAspectRatio !== resolvedAspectRatio
    ) {
      logSkeletonGeneration("aspect_ratio_clamped", {
        presetId: preset?.id,
        outputAspectRatio,
        subjectAspectRatio: resolvedAspectRatio,
      });
    }
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
    let references: ReferenceForGeneration[];
    if (useSkeletonInpaint) {
      references = await inpaintReferencesForSkeleton(skeletonAssets);
    } else {
      const backgroundPlateReference =
        backgroundPlateReferenceForSkeleton(skeletonAssets);
      const baseReferenceLimit =
        args.intent !== "restyle" &&
        preset?.referencePolicy === "explicit" &&
        !args.referenceAssetIds?.length
          ? 0
          : DEFAULT_GENERATION_REFERENCE_LIMIT;
      const referenceLimit =
        backgroundPlateReference && baseReferenceLimit > 0
          ? baseReferenceLimit + 1
          : baseReferenceLimit;
      references = await selectReferences({
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId,
        categories: resolvedCategories,
        referenceAssetIds: args.referenceAssetIds,
        excludeAssetIds: skeletonReferenceExclusionIds,
        sourceAssetId: args.sourceAssetId,
        subjectAssetId: args.subjectAssetId,
        intent: args.intent,
        limit: referenceLimit,
      });
      if (backgroundPlateReference) {
        references.unshift(backgroundPlateReference);
      }
    }
    const compiledPrompt = compilePrompt({
      libraryTitle: library.title,
      styleBrief,
      customInstructions: [library.customInstructions, presetInstructions]
        .filter((item) => item?.trim())
        .join("\n\n"),
      prompt: promptForRun,
      embeddedText: args.embeddedText,
      textPlacement: args.textPlacement,
      referenceCount: references.length,
      includeLogo: resolvedIncludeLogo,
      skeletonContentMode: skeletonSpec?.contentMode ?? null,
      hasBackgroundPlate: Boolean(
        isSkeletonCutout &&
        !useSkeletonInpaint &&
        skeletonAssets?.backgroundAsset,
      ),
      skeletonInpaint: useSkeletonInpaint,
      aspectRatio: resolvedAspectRatio,
      imageSize: resolvedImageSize,
      category,
      intent: args.intent,
      styleStrength: args.styleStrength,
    });
    const runId = nanoid();
    const now = nowIso();
    const slotId = args.slotId ?? runId;
    const variantScopeId = args.variantScopeId ?? context?.threadId ?? null;
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
      includeLogo: resolvedIncludeLogo,
      requestedIncludeLogo,
      skeletonSpec: skeletonSpec ?? null,
      outputAspectRatio,
      subjectAspectRatio: resolvedAspectRatio,
      categories: resolvedCategories ?? [],
      collectionId: resolvedCollectionId ?? null,
      presetId: preset?.id ?? null,
      sessionId: session?.id ?? null,
      embeddedText: args.embeddedText ?? null,
      textPlacement: args.textPlacement ?? null,
      customInstructions: library.customInstructions ?? "",
    };
    const dismissibleSlot = args.dismissible !== false && Boolean(slotId);
    const baseMetadata = {
      slotId,
      variantBatchId: args.variantBatchId ?? null,
      threadId: context?.threadId ?? null,
      variantScopeId,
      dismissible: dismissibleSlot,
      sourceAssetId: args.sourceAssetId,
      subjectAssetId: args.subjectAssetId,
      embeddedText: args.embeddedText,
      textPlacement: args.textPlacement,
      intent: args.intent,
      styleStrength: args.styleStrength,
      tier: resolvedTier,
      includeLogo: resolvedIncludeLogo,
      requestedIncludeLogo,
      skeletonSpec: skeletonSpec ?? null,
      outputAspectRatio,
      subjectAspectRatio: resolvedAspectRatio,
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
      aspectRatio: outputAspectRatio,
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

    await upsertVariantSlot({
      runId,
      batchId: args.variantBatchId ?? null,
      libraryId: args.libraryId,
      collectionId: resolvedCollectionId ?? null,
      presetId: preset?.id ?? null,
      sessionId: session?.id ?? null,
      threadId: context?.threadId ?? null,
      variantScopeId,
      prompt: args.prompt,
      slotId,
      status: "pending",
    });

    try {
      const generated = await withToolActivity(
        context,
        {
          label: "Generating image.",
          ongoingLabel: "Still generating image.",
          // Intentionally no explicit `tool`: withToolActivity falls back to
          // context.actionName, which is the ACTUAL dispatched tool. When this
          // action is invoked directly that is "generate-image"; when it runs as
          // a sub-step of generate-image-batch / rerun-generation-run it is the
          // parent tool, so the activity event matches the real tool_start card
          // instead of spawning an orphan "generate-image" activity card.
        },
        () =>
          generateWithManagedImageProvider({
            prompt: promptForRun,
            compiledPrompt,
            references,
            model: resolvedModel,
            mode: useSkeletonInpaint ? "edit" : undefined,
            aspectRatio: resolvedAspectRatio,
            imageSize: resolvedImageSize,
            background:
              isSkeletonCutout && !useSkeletonInpaint
                ? "transparent"
                : undefined,
            groundingMode: args.groundingMode,
            intent: args.intent,
            styleStrength: args.styleStrength,
            runId,
            libraryId: args.libraryId,
            collectionId: resolvedCollectionId ?? null,
            source: args.source,
            callerAppId: args.callerAppId,
          }),
      );
      await deleteAppState("image-generation-setup").catch(() => {});
      let image = generated.image;
      let mimeType = generated.mimeType;
      if (skeletonAssets && !useSkeletonInpaint) {
        image = await applyPresetSkeleton({
          subject: image,
          spec: skeletonAssets.spec,
          canvasAspectRatio: outputAspectRatio,
          backgroundAsset: skeletonAssets.backgroundAsset,
          canonicalLogo: skeletonAssets.canonicalLogo,
          foregroundAssets: skeletonAssets.foregroundAssets,
        });
        mimeType = "image/png";
      } else if (resolvedIncludeLogo && library.canonicalLogoAssetId) {
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
      if (
        dismissibleSlot &&
        (await wasVariantSlotDismissed(args.libraryId, slotId, {
          threadId: context?.threadId ?? null,
          variantScopeId,
        }))
      ) {
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
      const asset = await withToolActivity(
        context,
        {
          label: "Saving generated image.",
          ongoingLabel: "Still saving generated image.",
          // See above: omit `tool` so the activity is tagged with the real
          // dispatched tool (context.actionName) rather than a hardcoded
          // "generate-image" that orphans under batch/rerun.
        },
        () =>
          createAssetFromBuffer({
            libraryId: args.libraryId,
            collectionId: resolvedCollectionId ?? null,
            buffer: image,
            mimeType,
            role: "generated",
            status: "candidate",
            prompt: args.prompt,
            model: generated.model,
            aspectRatio: outputAspectRatio,
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
              includeLogo: resolvedIncludeLogo,
              requestedIncludeLogo,
              skeletonSpec: skeletonSpec ?? null,
              outputAspectRatio,
              subjectAspectRatio: resolvedAspectRatio,
              presetId: preset?.id,
              sessionId: session?.id,
              generated: true,
              sourceUrl: generated.sourceUrl,
              providerGenerationId: generated.providerGenerationId,
              creditsCharged: generated.creditsCharged,
            },
            category,
          }),
      );
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
            includeLogo: resolvedIncludeLogo,
            requestedIncludeLogo,
            skeletonSpec: skeletonSpec ?? null,
            outputAspectRatio,
            subjectAspectRatio: resolvedAspectRatio,
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
        batchId: args.variantBatchId ?? null,
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        presetId: preset?.id ?? null,
        sessionId: session?.id ?? null,
        threadId: context?.threadId ?? null,
        variantScopeId,
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
      if (
        dismissibleSlot &&
        (await wasVariantSlotDismissed(args.libraryId, slotId, {
          threadId: context?.threadId ?? null,
          variantScopeId,
        }))
      ) {
        throw err;
      }
      await upsertVariantSlot({
        runId,
        batchId: args.variantBatchId ?? null,
        libraryId: args.libraryId,
        collectionId: resolvedCollectionId ?? null,
        presetId: preset?.id ?? null,
        sessionId: session?.id ?? null,
        threadId: context?.threadId ?? null,
        variantScopeId,
        prompt: args.prompt,
        slotId,
        status: "failed",
        error: message,
      });
      throw err;
    }
  },
});

function skeletonCompositeAssetIds(
  spec: PresetSkeletonSpec | null,
): string[] | undefined {
  if (!spec) return undefined;
  const ids = new Set<string>();
  if (spec.background.type === "asset") ids.add(spec.background.assetId);
  if (spec.mask?.type === "asset") ids.add(spec.mask.assetId);
  for (const layer of spec.foreground ?? []) {
    if (layer.source !== "canonicalLogo") ids.add(layer.source.assetId);
  }
  return ids.size ? [...ids] : undefined;
}

function backgroundPlateReferenceForSkeleton(
  skeletonAssets: LoadedSkeletonAssets | null,
): ReferenceForGeneration | null {
  if (
    !skeletonAssets?.backgroundAsset ||
    !skeletonAssets.backgroundAssetId ||
    !skeletonAssets.backgroundMimeType
  ) {
    return null;
  }
  return {
    id: skeletonAssets.backgroundAssetId,
    role: "background_reference",
    category: "skeleton",
    mimeType: skeletonAssets.backgroundMimeType,
    data: skeletonAssets.backgroundAsset.toString("base64"),
    selectionReason: "explicit",
  };
}

async function inpaintReferencesForSkeleton(
  skeletonAssets: LoadedSkeletonAssets | null,
): Promise<ReferenceForGeneration[]> {
  if (
    !skeletonAssets?.backgroundAsset ||
    !skeletonAssets.backgroundAssetId ||
    !skeletonAssets.backgroundMimeType
  ) {
    throw new Error("Skeleton inpainting requires a background plate image.");
  }
  const mask = skeletonAssets.maskAsset
    ? await maskFromManualMaskAlpha({
        mask: skeletonAssets.maskAsset,
        plate: skeletonAssets.backgroundAsset,
      })
    : await maskFromPlateAlpha(skeletonAssets.backgroundAsset);
  return [
    {
      id: skeletonAssets.backgroundAssetId,
      role: "edit_target",
      category: "skeleton",
      mimeType: skeletonAssets.backgroundMimeType,
      data: skeletonAssets.backgroundAsset.toString("base64"),
      selectionReason: "explicit",
    },
    {
      id:
        skeletonAssets.maskAssetId ??
        `${skeletonAssets.backgroundAssetId}:mask`,
      role: "mask",
      category: "skeleton",
      mimeType: "image/png",
      data: mask.toString("base64"),
      selectionReason: "explicit",
    },
  ];
}

type LoadedSkeletonAssets = {
  spec: PresetSkeletonSpec;
  backgroundAssetId?: string;
  backgroundMimeType?: string;
  backgroundAsset?: Buffer;
  maskAssetId?: string;
  maskAsset?: Buffer;
  canonicalLogo?: Buffer;
  foregroundAssets: Record<string, Buffer>;
};

async function loadSkeletonAssets(input: {
  spec: PresetSkeletonSpec;
  libraryId: string;
  canonicalLogoAssetId?: string | null;
  appendCanonicalLogo: boolean;
}): Promise<LoadedSkeletonAssets> {
  const db = getDb();
  const spec = appendCanonicalLogoToSkeleton(
    input.spec,
    input.appendCanonicalLogo,
  );
  const assetIds = new Set<string>();
  if (spec.background.type === "asset") assetIds.add(spec.background.assetId);
  if (spec.mask?.type === "asset") assetIds.add(spec.mask.assetId);
  for (const layer of spec.foreground ?? []) {
    if (layer.source !== "canonicalLogo") assetIds.add(layer.source.assetId);
  }
  if (input.canonicalLogoAssetId) assetIds.add(input.canonicalLogoAssetId);

  const buffers = new Map<string, Buffer>();
  const mimeTypes = new Map<string, string>();
  for (const assetId of assetIds) {
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId))
      .limit(1);
    if (!asset) {
      if (assetId === input.canonicalLogoAssetId) continue;
      throw new Error("Skeleton asset not found.");
    }
    if (asset.libraryId !== input.libraryId) {
      throw new Error("Skeleton assets must belong to the selected brand kit.");
    }
    if (!asset.mimeType.startsWith("image/")) {
      throw new Error("Skeleton assets must be images.");
    }
    buffers.set(assetId, await getObject(asset.objectKey));
    mimeTypes.set(assetId, asset.mimeType);
  }

  const foregroundAssets: Record<string, Buffer> = {};
  for (const layer of spec.foreground ?? []) {
    if (layer.source !== "canonicalLogo") {
      const buffer = buffers.get(layer.source.assetId);
      if (buffer) foregroundAssets[layer.source.assetId] = buffer;
    }
  }

  return {
    spec,
    backgroundAssetId:
      spec.background.type === "asset" ? spec.background.assetId : undefined,
    backgroundMimeType:
      spec.background.type === "asset"
        ? mimeTypes.get(spec.background.assetId)
        : undefined,
    backgroundAsset:
      spec.background.type === "asset"
        ? buffers.get(spec.background.assetId)
        : undefined,
    maskAssetId: spec.mask?.type === "asset" ? spec.mask.assetId : undefined,
    maskAsset:
      spec.mask?.type === "asset" ? buffers.get(spec.mask.assetId) : undefined,
    canonicalLogo: input.canonicalLogoAssetId
      ? buffers.get(input.canonicalLogoAssetId)
      : undefined,
    foregroundAssets,
  };
}

function appendCanonicalLogoToSkeleton(
  spec: PresetSkeletonSpec,
  appendCanonicalLogo: boolean,
): PresetSkeletonSpec {
  if (!appendCanonicalLogo || skeletonUsesCanonicalLogo(spec)) return spec;
  return {
    ...spec,
    foreground: [
      ...(spec.foreground ?? []),
      { source: "canonicalLogo", x: 0.805, y: 0.06, w: 0.16 },
    ],
  };
}

function logSkeletonGeneration(
  event: string,
  fields: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "test") return;
  const detail = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(
    `[assets] preset-skeleton ${event}${detail ? ` ${detail}` : ""}`,
  );
}
