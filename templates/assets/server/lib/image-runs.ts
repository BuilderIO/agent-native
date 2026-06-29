import { eq, inArray } from "drizzle-orm";

import {
  upsertVariantSlot,
  wasVariantSlotDismissed,
} from "../../actions/variant-slots.js";
import type {
  GenerationIntent,
  ImageCategory,
  StyleStrength,
} from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "./assets.js";
import {
  generateWithManagedImageProviderOnce,
  type GenerateProviderOutput,
  type ReferenceForGeneration,
} from "./generation.js";
import { compositeLogo } from "./image-processing.js";
import { absoluteUrl, nowIso, parseJson, stringifyJson } from "./json.js";
import { getObject } from "./storage.js";

const INLINE_WAIT_ENV = Number(process.env.ASSETS_IMAGE_INLINE_WAIT_MS);
const REFRESH_WAIT_ENV = Number(process.env.ASSETS_IMAGE_REFRESH_WAIT_MS);

export const IMAGE_GENERATION_INLINE_FAST_PATH_MS = Number.isFinite(
  INLINE_WAIT_ENV,
)
  ? INLINE_WAIT_ENV
  : process.env.NODE_ENV === "test"
    ? 25
    : 30_000;

export const IMAGE_GENERATION_REFRESH_ATTEMPT_MS = Number.isFinite(
  REFRESH_WAIT_ENV,
)
  ? REFRESH_WAIT_ENV
  : process.env.NODE_ENV === "test"
    ? 25
    : 8_000;
const MANUAL_IMAGE_FALLBACK_STALE_MS = 2 * 60 * 1000;
const MANUAL_IMAGE_FALLBACK_STALE_ERROR =
  "Manual image generation was interrupted before a preview was created. Start a new generation to retry.";

type ImageRun = typeof schema.assetGenerationRuns.$inferSelect;
type ImageAsset = typeof schema.assets.$inferSelect;
type ImageRunDb = Pick<ReturnType<typeof getDb>, "select" | "update">;

export type FinalizeImageRunResult =
  | {
      status: "processing";
      run: ImageRun;
    }
  | {
      status: "completed";
      run: ImageRun;
      asset: ImageAsset;
    }
  | {
      status: "dismissed";
      run: ImageRun;
    };

async function findAssetForRun(
  db: ImageRunDb,
  runId: string,
): Promise<ImageAsset | undefined> {
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.generationRunId, runId))
    .limit(1);
  return asset;
}

async function markRunProcessing(
  db: ImageRunDb,
  run: ImageRun,
  metadata: Record<string, unknown>,
): Promise<ImageRun> {
  const nextMetadata = {
    ...metadata,
    mediaType: "image",
    providerStatus: "processing",
    lastPolledAt: nowIso(),
  };
  const nextRun = {
    ...run,
    status: "processing",
    metadata: stringifyJson(nextMetadata),
  };
  await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "processing",
      metadata: nextRun.metadata,
    })
    .where(eq(schema.assetGenerationRuns.id, run.id));
  return nextRun;
}

async function markRunCompletedWithAsset(
  db: ImageRunDb,
  run: ImageRun,
  metadata: Record<string, unknown>,
  asset: ImageAsset,
  generated?: GenerateProviderOutput,
): Promise<ImageRun> {
  const nextMetadata = {
    ...metadata,
    mediaType: "image",
    providerStatus: "completed",
    assetId: asset.id,
    outputAssetIds: [asset.id],
    ...(generated?.provider ? { provider: generated.provider } : {}),
    ...(generated?.sourceUrl ? { sourceUrl: generated.sourceUrl } : {}),
    ...(generated?.providerGenerationId
      ? { providerGenerationId: generated.providerGenerationId }
      : {}),
    ...(generated?.creditsCharged !== undefined
      ? { creditsCharged: generated.creditsCharged }
      : {}),
  };
  const completedAt = nowIso();
  const nextRun = {
    ...run,
    status: "completed",
    completedAt,
    error: null,
    metadata: stringifyJson(nextMetadata),
  };
  await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "completed",
      completedAt,
      error: null,
      metadata: nextRun.metadata,
    })
    .where(eq(schema.assetGenerationRuns.id, run.id));
  return nextRun;
}

async function markRunDismissed(
  db: ImageRunDb,
  run: ImageRun,
  metadata: Record<string, unknown>,
  generated: GenerateProviderOutput,
): Promise<ImageRun> {
  const completedAt = nowIso();
  const nextRun = {
    ...run,
    status: "completed",
    completedAt,
    error: null,
    metadata: stringifyJson({
      ...metadata,
      mediaType: "image",
      providerStatus: "completed",
      dismissed: true,
      provider: generated.provider,
      providerGenerationId: generated.providerGenerationId,
      creditsCharged: generated.creditsCharged,
    }),
  };
  await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "completed",
      completedAt,
      error: null,
      metadata: nextRun.metadata,
    })
    .where(eq(schema.assetGenerationRuns.id, run.id));
  return nextRun;
}

async function syncImageVariantSlot(
  run: ImageRun,
  status: "ready" | "failed",
  options: {
    asset?: ImageAsset;
    error?: string | null;
  } = {},
) {
  const metadata = parseJson<Record<string, unknown>>(run.metadata, {});
  const slotId =
    typeof metadata.slotId === "string" && metadata.slotId
      ? metadata.slotId
      : run.id;
  const batchId =
    typeof metadata.variantBatchId === "string" && metadata.variantBatchId
      ? metadata.variantBatchId
      : null;
  const threadId =
    typeof metadata.threadId === "string" && metadata.threadId
      ? metadata.threadId
      : null;
  const variantScopeId =
    typeof metadata.variantScopeId === "string" && metadata.variantScopeId
      ? metadata.variantScopeId
      : null;
  const urls = options.asset ? imageAssetUrls(options.asset) : null;

  await upsertVariantSlot({
    runId: run.id,
    batchId,
    libraryId: run.libraryId,
    collectionId: run.collectionId ?? null,
    presetId: run.presetId ?? null,
    sessionId: run.sessionId ?? null,
    threadId,
    variantScopeId,
    prompt: run.prompt,
    slotId,
    status,
    assetId: options.asset?.id,
    previewUrl: urls?.previewUrl,
    thumbnailUrl: urls?.thumbnailUrl,
    error: options.error ?? undefined,
  });
}

function isDirectMediaKey(key: string | null | undefined): key is string {
  return Boolean(
    key &&
    (key.startsWith("http://") ||
      key.startsWith("https://") ||
      key.startsWith("/library-presets/") ||
      key.startsWith("library-presets/")),
  );
}

function directMediaUrl(key: string | null | undefined): string | null {
  if (!isDirectMediaKey(key)) return null;
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  return absoluteUrl(key.startsWith("/") ? key : `/${key}`);
}

function imageAssetUrls(asset: ImageAsset) {
  const previewUrl =
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(`/api/assets/${asset.id}/content`);
  const thumbnailUrl =
    directMediaUrl(asset.thumbnailObjectKey) ??
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(
      `/api/assets/${asset.id}/content${
        asset.thumbnailObjectKey ? "?variant=thumb" : ""
      }`,
    );
  return { previewUrl, thumbnailUrl };
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value ? value : undefined;
}

function metadataBoolean(
  metadata: Record<string, unknown>,
  key: string,
): boolean {
  return metadata[key] === true;
}

function metadataStringArray(
  metadata: Record<string, unknown>,
  key: string,
): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function generationIntent(value: unknown): GenerationIntent | undefined {
  return value === "generate" || value === "restyle" || value === "edit"
    ? value
    : undefined;
}

function styleStrength(value: unknown): StyleStrength | undefined {
  return value === "subtle" || value === "balanced" || value === "strong"
    ? value
    : undefined;
}

function imageCategory(value: unknown): ImageCategory | undefined {
  return typeof value === "string" ? (value as ImageCategory) : undefined;
}

async function loadReferencesForRun(
  run: ImageRun,
): Promise<ReferenceForGeneration[]> {
  const referenceAssetIds = parseJson<string[]>(run.referenceAssetIds, []);
  if (!referenceAssetIds.length) return [];
  const rows = await getDb()
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.id, referenceAssetIds));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const references: ReferenceForGeneration[] = [];
  for (const id of referenceAssetIds) {
    const asset = byId.get(id);
    if (!asset || !asset.mimeType.startsWith("image/")) continue;
    const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
    references.push({
      id: asset.id,
      role: asset.role,
      category:
        typeof metadata.category === "string" ? metadata.category : undefined,
      mimeType: asset.mimeType,
      data: (await getObject(asset.objectKey)).toString("base64"),
    });
  }
  return references;
}

async function maybeCompositeLogo(input: {
  run: ImageRun;
  metadata: Record<string, unknown>;
  generated: GenerateProviderOutput;
}): Promise<{ image: Buffer; mimeType: string }> {
  if (!metadataBoolean(input.metadata, "includeLogo")) {
    return {
      image: input.generated.image,
      mimeType: input.generated.mimeType,
    };
  }
  const [library] = await getDb()
    .select({
      canonicalLogoAssetId: schema.assetLibraries.canonicalLogoAssetId,
    })
    .from(schema.assetLibraries)
    .where(eq(schema.assetLibraries.id, input.run.libraryId))
    .limit(1);
  if (!library?.canonicalLogoAssetId) {
    return {
      image: input.generated.image,
      mimeType: input.generated.mimeType,
    };
  }
  const [logo] = await getDb()
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, library.canonicalLogoAssetId))
    .limit(1);
  if (!logo) {
    return {
      image: input.generated.image,
      mimeType: input.generated.mimeType,
    };
  }
  return {
    image: await compositeLogo({
      image: input.generated.image,
      logo: await getObject(logo.objectKey),
    }),
    mimeType: "image/png",
  };
}

async function createAssetForRun(
  db: Pick<ReturnType<typeof getDb>, "insert">,
  run: ImageRun,
  metadata: Record<string, unknown>,
  generated: GenerateProviderOutput,
  image: Buffer,
  mimeType: string,
): Promise<ImageAsset> {
  const referenceAssetIds = parseJson<string[]>(run.referenceAssetIds, []);
  const categories = metadataStringArray(metadata, "categories");
  const asset = await createAssetFromBuffer({
    id: `image_${run.id}`,
    libraryId: run.libraryId,
    collectionId: run.collectionId ?? null,
    buffer: image,
    mimeType,
    role: "generated",
    status: "candidate",
    prompt: run.prompt,
    model: generated.model,
    aspectRatio: run.aspectRatio,
    imageSize: run.imageSize,
    generationRunId: run.id,
    sourceUrl: generated.sourceUrl,
    db,
    metadata: {
      provider: generated.provider,
      compiledPrompt: run.compiledPrompt,
      referenceAssetIds,
      sourceAssetId: metadataString(metadata, "sourceAssetId"),
      subjectAssetId: metadataString(metadata, "subjectAssetId"),
      intent: generationIntent(metadata.intent),
      styleStrength: styleStrength(metadata.styleStrength),
      tier: metadata.tier,
      includeLogo: metadataBoolean(metadata, "includeLogo"),
      presetId: run.presetId ?? metadataString(metadata, "presetId"),
      sessionId: run.sessionId ?? metadataString(metadata, "sessionId"),
      generated: true,
      sourceUrl: generated.sourceUrl,
      providerGenerationId: generated.providerGenerationId,
      creditsCharged: generated.creditsCharged,
    },
    category: imageCategory(categories[0]),
  });

  return asset;
}

async function attachAssetToSessionForRun(
  db: Pick<ReturnType<typeof getDb>, "insert" | "select" | "update">,
  run: ImageRun,
  metadata: Record<string, unknown>,
  asset: ImageAsset,
) {
  const sessionId = run.sessionId ?? metadataString(metadata, "sessionId");
  if (!sessionId) return;

  let activateSessionAsset = metadata.activateSessionAsset !== false;
  if (!activateSessionAsset) {
    const [session] = await db
      .select({ activeAssetId: schema.assetGenerationSessions.activeAssetId })
      .from(schema.assetGenerationSessions)
      .where(eq(schema.assetGenerationSessions.id, sessionId))
      .limit(1);
    activateSessionAsset = !session?.activeAssetId;
  }
  const itemCreatedAt = nowIso();
  try {
    await db.insert(schema.assetGenerationSessionItems).values({
      id: `${run.id}_item`,
      sessionId,
      assetId: asset.id,
      generationRunId: run.id,
      role: activateSessionAsset ? "active" : "candidate",
      note: null,
      sortOrder: 100,
      createdAt: itemCreatedAt,
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }
  if (activateSessionAsset) {
    await db
      .update(schema.assetGenerationSessions)
      .set({ activeAssetId: asset.id, updatedAt: itemCreatedAt })
      .where(eq(schema.assetGenerationSessions.id, sessionId));
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string };
  return (
    anyErr.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    anyErr.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    /unique constraint|duplicate|primary key/i.test(anyErr.message ?? "")
  );
}

export async function finalizeImageRun(
  run: ImageRun,
  options: { providerAttemptTimeoutMs?: number } = {},
): Promise<FinalizeImageRunResult> {
  const metadata = parseJson<Record<string, unknown>>(run.metadata, {});
  const existingAsset = await findAssetForRun(getDb(), run.id);
  if (existingAsset) {
    const nextRun = await markRunCompletedWithAsset(
      getDb(),
      run,
      metadata,
      existingAsset,
    );
    await syncImageVariantSlot(nextRun, "ready", { asset: existingAsset });
    return { status: "completed", run: nextRun, asset: existingAsset };
  }
  const manualFallbackStartedAt = metadataString(
    metadata,
    "manualFallbackStartedAt",
  );
  if (manualFallbackStartedAt) {
    const startedAt = Date.parse(manualFallbackStartedAt);
    const elapsedMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    if (elapsedMs < MANUAL_IMAGE_FALLBACK_STALE_MS) {
      const nextRun = await markRunProcessing(getDb(), run, metadata);
      return { status: "processing", run: nextRun };
    }
    throw new Error(MANUAL_IMAGE_FALLBACK_STALE_ERROR);
  }

  const references = await loadReferencesForRun(run);
  const generated = await generateWithManagedImageProviderOnce({
    prompt: run.prompt,
    compiledPrompt: run.compiledPrompt,
    references,
    model: run.model as any,
    aspectRatio: run.aspectRatio as any,
    imageSize: run.imageSize as any,
    groundingMode: run.groundingMode as any,
    intent: generationIntent(metadata.intent),
    styleStrength: styleStrength(metadata.styleStrength),
    runId: run.id,
    libraryId: run.libraryId,
    collectionId: run.collectionId ?? null,
    source: run.source as any,
    callerAppId: run.callerAppId ?? undefined,
    requestTimeoutMs: options.providerAttemptTimeoutMs,
    onManualFallbackStart: async () => {
      if (metadataString(metadata, "manualFallbackStartedAt")) return;
      metadata.provider = "manual";
      metadata.manualFallbackStartedAt = nowIso();
      await markRunProcessing(getDb(), run, metadata);
    },
  });
  if (generated.status === "processing") {
    const nextRun = await markRunProcessing(getDb(), run, metadata);
    return { status: "processing", run: nextRun };
  }

  const slotId = metadataString(metadata, "slotId") ?? run.id;
  const dismissibleSlot = metadata.dismissible !== false && Boolean(slotId);
  if (
    dismissibleSlot &&
    (await wasVariantSlotDismissed(run.libraryId, slotId, {
      threadId: metadataString(metadata, "threadId") ?? null,
      variantScopeId: metadataString(metadata, "variantScopeId") ?? null,
    }))
  ) {
    const dismissedRun = await markRunDismissed(
      getDb(),
      run,
      metadata,
      generated.output,
    );
    return { status: "dismissed", run: dismissedRun };
  }

  const { image, mimeType } = await maybeCompositeLogo({
    run,
    metadata,
    generated: generated.output,
  });

  let asset: ImageAsset;
  try {
    asset = await createAssetForRun(
      getDb(),
      run,
      metadata,
      generated.output,
      image,
      mimeType,
    );
  } catch (err) {
    const existing = await findAssetForRun(getDb(), run.id);
    if (!existing || !isUniqueConstraintError(err)) throw err;
    asset = existing;
  }

  try {
    const completed = await getDb().transaction(async (tx) => {
      const existing = await findAssetForRun(tx, run.id);
      const outputAsset = existing ?? asset;
      await attachAssetToSessionForRun(tx, run, metadata, outputAsset);
      const nextRun = await markRunCompletedWithAsset(
        tx,
        run,
        metadata,
        outputAsset,
        generated.output,
      );
      return { run: nextRun, asset: outputAsset };
    });
    await syncImageVariantSlot(completed.run, "ready", {
      asset: completed.asset,
    });
    return {
      status: "completed",
      run: completed.run,
      asset: completed.asset,
    };
  } catch (err) {
    const existing = await findAssetForRun(getDb(), run.id);
    if (existing) {
      const nextRun = await markRunCompletedWithAsset(
        getDb(),
        run,
        metadata,
        existing,
        generated.output,
      );
      await syncImageVariantSlot(nextRun, "ready", { asset: existing });
      return { status: "completed", run: nextRun, asset: existing };
    }
    throw err;
  }
}

export async function finalizeImageRunWithinBudget(
  run: ImageRun,
  waitMs: number,
): Promise<FinalizeImageRunResult> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const completion = finalizeImageRun(run, {
    providerAttemptTimeoutMs: waitMs,
  }).catch((err) => {
    if (timedOut) return { status: "processing" as const, run };
    throw err;
  });
  const timeout = new Promise<FinalizeImageRunResult>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve({ status: "processing", run });
    }, waitMs);
  });
  try {
    return await Promise.race([completion, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function markImageRunFailed(input: {
  run: ImageRun;
  message: string;
}): Promise<ImageRun> {
  const completedAt = nowIso();
  const failedRun = {
    ...input.run,
    status: "failed",
    error: input.message,
    completedAt,
  };
  await getDb()
    .update(schema.assetGenerationRuns)
    .set({
      status: "failed",
      error: input.message,
      completedAt,
    })
    .where(eq(schema.assetGenerationRuns.id, input.run.id));
  await syncImageVariantSlot(failedRun, "failed", {
    error: input.message,
  });
  return failedRun;
}
