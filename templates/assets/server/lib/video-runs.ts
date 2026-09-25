import { and, eq, ne } from "drizzle-orm";

import type {
  VideoAspectRatio,
  VideoDuration,
  VideoModel,
  VideoResolution,
} from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "./assets.js";
import { notifyGenerationRunFinished } from "./generation-run-notifications.js";
import { nowIso, parseJson, stringifyJson } from "./json.js";
import { getObject } from "./storage.js";
import {
  prepareVideoGenerationProvider,
  pollBuilderVideoGeneration,
  pollGeminiVideoGeneration,
  RetryableVideoGenerationError,
  startVideoGeneration,
  UnconfirmedVideoGenerationStartError,
} from "./video-generation.js";

type VideoRunDb = Pick<ReturnType<typeof getDb>, "select" | "update">;

// Builder start can occupy three 45-second attempts; don't recover a fresh marker mid-request.
const VIDEO_START_RECOVERY_DELAY_MS = 3 * 60 * 1000;

type VideoRunResult =
  | {
      status: "processing";
      run: typeof schema.assetGenerationRuns.$inferSelect;
      completionClaimed: false;
    }
  | {
      status: "failed";
      run: typeof schema.assetGenerationRuns.$inferSelect;
      completionClaimed: false;
    }
  | {
      status: "completed";
      run: typeof schema.assetGenerationRuns.$inferSelect;
      asset: typeof schema.assets.$inferSelect;
      completionClaimed: boolean;
    };

function videoStartIsRecent(metadata: Record<string, unknown>): boolean {
  if (typeof metadata.startAttemptedAt !== "string") return false;
  const attemptedAt = Date.parse(metadata.startAttemptedAt);
  return (
    Number.isFinite(attemptedAt) &&
    Date.now() - attemptedAt < VIDEO_START_RECOVERY_DELAY_MS
  );
}

async function findAssetForRun(
  db: VideoRunDb,
  runId: string,
): Promise<typeof schema.assets.$inferSelect | undefined> {
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.generationRunId, runId))
    .limit(1);
  return asset;
}

async function findRunById(
  db: VideoRunDb,
  runId: string,
): Promise<typeof schema.assetGenerationRuns.$inferSelect | undefined> {
  const [run] = await db
    .select()
    .from(schema.assetGenerationRuns)
    .where(eq(schema.assetGenerationRuns.id, runId))
    .limit(1);
  return run;
}

async function readCurrentVideoRunResult(
  db: VideoRunDb,
  runId: string,
): Promise<VideoRunResult> {
  const run = await findRunById(db, runId);
  if (!run) throw new Error("Video generation run disappeared.");
  if (run.status === "failed") {
    return { status: "failed", run, completionClaimed: false };
  }
  if (run.status === "completed") {
    const asset = await findAssetForRun(db, runId);
    if (!asset) throw new Error("Completed video generation has no asset.");
    return { status: "completed", run, asset, completionClaimed: false };
  }
  return { status: "processing", run, completionClaimed: false };
}

async function retryVideoGenerationStart(
  db: VideoRunDb,
  run: typeof schema.assetGenerationRuns.$inferSelect,
  metadata: Record<string, unknown>,
): Promise<VideoRunResult> {
  const settings = metadata.settingsUsed;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Video generation run has no saved start settings.");
  }
  const settingsUsed = settings as Record<string, unknown>;
  if (
    typeof settingsUsed.enhancePrompt !== "boolean" ||
    typeof settingsUsed.generateAudio !== "boolean" ||
    (settingsUsed.negativePrompt !== null &&
      typeof settingsUsed.negativePrompt !== "string")
  ) {
    throw new Error("Video generation run has invalid saved start settings.");
  }

  const providerStatus = metadata.providerStatus;
  const savedProvider =
    metadata.provider === "builder" || metadata.provider === "gemini"
      ? metadata.provider
      : undefined;
  if (providerStatus === "starting" && savedProvider !== "builder") {
    throw new UnconfirmedVideoGenerationStartError(
      "A previous video start may have reached its provider, but its operation ID was not saved. It was not retried to avoid a duplicate generation.",
    );
  }
  if (providerStatus === "retryable" && !savedProvider) {
    throw new Error("Video generation run has invalid retry state.");
  }
  if (
    providerStatus !== "selecting" &&
    providerStatus !== "starting" &&
    providerStatus !== "retryable"
  ) {
    throw new Error("Video generation run has invalid start state.");
  }

  const referenceAssetIds: unknown = JSON.parse(run.referenceAssetIds);
  if (
    !Array.isArray(referenceAssetIds) ||
    !referenceAssetIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Video generation run has invalid reference asset IDs.");
  }

  const referenceAssets = await Promise.all(
    referenceAssetIds.map(async (id: string) => {
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, id))
        .limit(1);
      if (
        !asset ||
        asset.libraryId !== run.libraryId ||
        !asset.mimeType.startsWith("image/")
      ) {
        throw new Error("A saved video reference asset is unavailable.");
      }
      return {
        id: asset.id,
        mimeType: asset.mimeType,
        data: (await getObject(asset.objectKey)).toString("base64"),
        role: asset.role,
      };
    }),
  );
  const sourceAssetId =
    typeof metadata.sourceAssetId === "string" ? metadata.sourceAssetId : null;
  const sourceImage = sourceAssetId
    ? referenceAssets.find((asset) => asset.id === sourceAssetId)
    : null;
  if (sourceAssetId && !sourceImage) {
    throw new Error("The saved video source image is unavailable.");
  }

  const identity = { userEmail: run.ownerEmail, orgId: run.orgId };
  const preparedProvider = await prepareVideoGenerationProvider(
    identity,
    savedProvider,
  );
  const startingMetadata = stringifyJson({
    ...metadata,
    provider: preparedProvider.provider,
    providerStatus: "starting",
    startAttemptedAt: nowIso(),
  });
  const [startingRun] = await db
    .update(schema.assetGenerationRuns)
    .set({ status: "processing", error: null, metadata: startingMetadata })
    .where(
      and(
        eq(schema.assetGenerationRuns.id, run.id),
        eq(schema.assetGenerationRuns.status, run.status),
        eq(schema.assetGenerationRuns.metadata, run.metadata),
      ),
    )
    .returning();
  if (!startingRun) return readCurrentVideoRunResult(db, run.id);

  let operation: Awaited<ReturnType<typeof startVideoGeneration>>;
  try {
    operation = await startVideoGeneration(
      {
        runId: run.id,
        libraryId: run.libraryId,
        callerAppId: run.callerAppId ?? undefined,
        model: run.model as VideoModel,
        compiledPrompt: run.compiledPrompt,
        aspectRatio: run.aspectRatio as VideoAspectRatio,
        durationSeconds: run.durationSeconds as VideoDuration,
        resolution: (run.resolution ?? run.imageSize) as VideoResolution,
        sourceImage,
        referenceImages: sourceImage ? [] : referenceAssets,
        negativePrompt: settingsUsed.negativePrompt as string | null,
        enhancePrompt: settingsUsed.enhancePrompt,
        generateAudio: settingsUsed.generateAudio,
      },
      preparedProvider,
    );
  } catch (error) {
    if (error instanceof RetryableVideoGenerationError) {
      const provider = error.provider ?? preparedProvider.provider;
      const retryMetadata = stringifyJson({
        ...metadata,
        provider,
        providerStatus: "retryable",
        startAttemptedAt: nowIso(),
      });
      const [retryingRun] = await db
        .update(schema.assetGenerationRuns)
        .set({
          status: "processing",
          error: error.message,
          metadata: retryMetadata,
        })
        .where(
          and(
            eq(schema.assetGenerationRuns.id, run.id),
            eq(schema.assetGenerationRuns.status, "processing"),
            eq(schema.assetGenerationRuns.metadata, startingMetadata),
          ),
        )
        .returning();
      return retryingRun
        ? { status: "processing", run: retryingRun, completionClaimed: false }
        : readCurrentVideoRunResult(db, run.id);
    }
    const failed = await failVideoGenerationRun(
      run.id,
      error,
      startingMetadata,
    );
    if (!failed) return readCurrentVideoRunResult(db, run.id);
    throw error;
  }
  const nextMetadata = {
    ...metadata,
    ...(operation.provider === "builder"
      ? { generationId: operation.generationId }
      : { operationName: operation.operationName }),
    provider: operation.provider,
    providerStatus: "processing",
    startedAt: nowIso(),
  };
  const [startedRun] = await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "processing",
      error: null,
      metadata: stringifyJson(nextMetadata),
    })
    .where(
      and(
        eq(schema.assetGenerationRuns.id, run.id),
        eq(schema.assetGenerationRuns.status, "processing"),
        eq(schema.assetGenerationRuns.metadata, startingMetadata),
      ),
    )
    .returning();
  return startedRun
    ? { status: "processing", run: startedRun, completionClaimed: false }
    : readCurrentVideoRunResult(db, run.id);
}

export async function failVideoGenerationRun(
  runId: string,
  error: unknown,
  expectedMetadata?: string,
): Promise<boolean> {
  const message =
    error instanceof Error ? error.message : "Video generation failed.";
  const completedAt = nowIso();
  const [failedRun] = await getDb()
    .update(schema.assetGenerationRuns)
    .set({ status: "failed", error: message, completedAt })
    .where(
      and(
        eq(schema.assetGenerationRuns.id, runId),
        ne(schema.assetGenerationRuns.status, "completed"),
        ne(schema.assetGenerationRuns.status, "failed"),
        ...(expectedMetadata === undefined
          ? []
          : [eq(schema.assetGenerationRuns.metadata, expectedMetadata)]),
      ),
    )
    .returning();
  if (failedRun) await notifyGenerationRunFinished(failedRun, "failed");
  return Boolean(failedRun);
}

async function markRunCompletedWithAsset(
  db: VideoRunDb,
  run: typeof schema.assetGenerationRuns.$inferSelect,
  metadata: Record<string, unknown>,
  asset: typeof schema.assets.$inferSelect,
  provider?: {
    provider?: "builder" | "gemini";
    providerGenerationId?: string | null;
    sourceUrl?: string | null;
    operationName?: string | null;
  },
) {
  const resolvedProvider =
    provider?.provider ??
    (metadata.provider === "builder" ? "builder" : "gemini");
  const nextMetadata = {
    ...metadata,
    provider: resolvedProvider,
    mediaType: "video",
    assetId: asset.id,
    outputAssetIds: [asset.id],
    ...(provider?.providerGenerationId
      ? { providerGenerationId: provider.providerGenerationId }
      : {}),
    ...(provider?.sourceUrl ? { sourceUrl: provider.sourceUrl } : {}),
    ...(provider?.operationName
      ? { operationName: provider.operationName }
      : {}),
  };
  const completedAt = nowIso();
  const nextRun = {
    ...run,
    status: "completed",
    error: null,
    completedAt,
    metadata: stringifyJson(nextMetadata),
  };
  const [completedRun] = await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "completed",
      error: null,
      completedAt,
      metadata: nextRun.metadata,
    })
    .where(
      and(
        eq(schema.assetGenerationRuns.id, run.id),
        eq(schema.assetGenerationRuns.status, "processing"),
      ),
    )
    .returning();
  if (!completedRun) {
    return {
      run: (await findRunById(db, run.id)) ?? run,
      completionClaimed: false,
    };
  }
  await notifyGenerationRunFinished(completedRun, "completed");
  return { run: completedRun, completionClaimed: true };
}

export async function completeVideoGenerationRun(
  run: typeof schema.assetGenerationRuns.$inferSelect,
): Promise<VideoRunResult> {
  if (run.status === "completed" || run.status === "failed") {
    return readCurrentVideoRunResult(getDb(), run.id);
  }
  const metadata = parseJson<Record<string, unknown>>(run.metadata, {});
  const provider = metadata.provider === "builder" ? "builder" : "gemini";
  const existingAsset = await findAssetForRun(getDb(), run.id);
  if (existingAsset) {
    const completed = await markRunCompletedWithAsset(
      getDb(),
      run,
      metadata,
      existingAsset,
      { provider },
    );
    if (completed.run.status !== "completed") {
      return readCurrentVideoRunResult(getDb(), run.id);
    }
    return {
      status: "completed",
      run: completed.run,
      asset: existingAsset,
      completionClaimed: completed.completionClaimed,
    };
  }

  const operationName =
    typeof metadata.operationName === "string" ? metadata.operationName : null;
  const generationId =
    typeof metadata.generationId === "string" ? metadata.generationId : null;
  if (metadata.providerStatus === "starting" && videoStartIsRecent(metadata)) {
    return readCurrentVideoRunResult(getDb(), run.id);
  }
  if (
    metadata.providerStatus === "selecting" ||
    metadata.providerStatus === "starting" ||
    metadata.providerStatus === "retryable"
  ) {
    try {
      return await retryVideoGenerationStart(getDb(), run, metadata);
    } catch (error) {
      if (!(error instanceof RetryableVideoGenerationError)) {
        const failed = await failVideoGenerationRun(
          run.id,
          error,
          run.metadata,
        );
        if (!failed) return readCurrentVideoRunResult(getDb(), run.id);
        throw error;
      }
      const provider =
        error instanceof RetryableVideoGenerationError
          ? (error.provider ??
            (metadata.provider === "builder" || metadata.provider === "gemini"
              ? metadata.provider
              : undefined))
          : undefined;
      const retryMetadata = provider
        ? stringifyJson({
            ...metadata,
            provider,
            providerStatus: provider === "gemini" ? "retryable" : "starting",
          })
        : stringifyJson(metadata);
      const [retryingRun] = await getDb()
        .update(schema.assetGenerationRuns)
        .set({
          status: "processing",
          error: error.message,
          metadata: retryMetadata,
        })
        .where(
          and(
            eq(schema.assetGenerationRuns.id, run.id),
            eq(schema.assetGenerationRuns.status, run.status),
            eq(schema.assetGenerationRuns.metadata, run.metadata),
          ),
        )
        .returning();
      return retryingRun
        ? { status: "processing", run: retryingRun, completionClaimed: false }
        : readCurrentVideoRunResult(getDb(), run.id);
    }
  }
  if (
    (provider === "builder" && !generationId) ||
    (provider === "gemini" && !operationName)
  ) {
    const error = new Error(
      "Video generation run has no provider generation ID.",
    );
    await failVideoGenerationRun(run.id, error);
    throw error;
  }

  let polled: Awaited<ReturnType<typeof pollBuilderVideoGeneration>>;
  try {
    polled =
      provider === "builder"
        ? await pollBuilderVideoGeneration(generationId!, {
            userEmail: run.ownerEmail,
            orgId: run.orgId,
          })
        : await pollGeminiVideoGeneration(operationName!);
  } catch (error) {
    if (error instanceof RetryableVideoGenerationError) {
      const [retryingRun] = await getDb()
        .update(schema.assetGenerationRuns)
        .set({ status: "processing", error: error.message })
        .where(
          and(
            eq(schema.assetGenerationRuns.id, run.id),
            eq(schema.assetGenerationRuns.status, "processing"),
          ),
        )
        .returning();
      if (!retryingRun) {
        return readCurrentVideoRunResult(getDb(), run.id);
      }
      return {
        status: "processing",
        run: retryingRun,
        completionClaimed: false,
      };
    }
    await failVideoGenerationRun(run.id, error);
    throw error;
  }

  if (polled.status === "processing") {
    const nextMetadata = {
      ...metadata,
      providerStatus: "processing",
      lastPolledAt: nowIso(),
    };
    const nextRun = {
      ...run,
      status: "processing",
      error: null,
      metadata: stringifyJson(nextMetadata),
    };
    const [processingRun] = await getDb()
      .update(schema.assetGenerationRuns)
      .set({
        status: "processing",
        error: null,
        metadata: nextRun.metadata,
      })
      .where(
        and(
          eq(schema.assetGenerationRuns.id, run.id),
          eq(schema.assetGenerationRuns.status, "processing"),
        ),
      )
      .returning();
    return processingRun
      ? { status: "processing", run: processingRun, completionClaimed: false }
      : readCurrentVideoRunResult(getDb(), run.id);
  }

  try {
    return await getDb().transaction(async (tx) => {
      const existing = await findAssetForRun(tx, run.id);
      if (existing) {
        const completed = await markRunCompletedWithAsset(
          tx,
          run,
          metadata,
          existing,
          {
            provider: polled.video.provider,
            providerGenerationId: polled.video.providerGenerationId,
            sourceUrl: polled.video.sourceUrl,
            operationName,
          },
        );
        if (completed.run.status !== "completed") {
          return readCurrentVideoRunResult(tx, run.id);
        }
        return {
          status: "completed" as const,
          run: completed.run,
          asset: existing,
          completionClaimed: completed.completionClaimed,
        };
      }

      const folderId =
        typeof metadata.folderId === "string" ? metadata.folderId : null;
      const category =
        typeof metadata.category === "string" ? metadata.category : "video";
      const asset = await createAssetFromBuffer({
        id: `video_${run.id}`,
        libraryId: run.libraryId,
        collectionId: run.collectionId,
        folderId,
        buffer: polled.video.buffer,
        mimeType: polled.video.mimeType,
        mediaType: "video",
        role: "generated",
        status: "candidate",
        title:
          typeof metadata.title === "string"
            ? metadata.title
            : "Generated video",
        description:
          typeof metadata.description === "string"
            ? metadata.description
            : null,
        altText:
          typeof metadata.description === "string"
            ? metadata.description
            : null,
        prompt: run.prompt,
        model: run.model,
        aspectRatio: run.aspectRatio,
        imageSize: run.resolution ?? run.imageSize,
        durationSeconds: run.durationSeconds,
        generationRunId: run.id,
        sourceUrl: polled.video.sourceUrl,
        db: tx,
        metadata: {
          ...metadata,
          provider: polled.video.provider,
          mediaType: "video",
          compiledPrompt: run.compiledPrompt,
          providerGenerationId: polled.video.providerGenerationId,
          sourceUrl: polled.video.sourceUrl,
          ...(operationName ? { operationName } : {}),
        },
        category: category as any,
      });
      const completed = await markRunCompletedWithAsset(
        tx,
        run,
        metadata,
        asset,
        {
          provider: polled.video.provider,
          providerGenerationId: polled.video.providerGenerationId,
          sourceUrl: polled.video.sourceUrl,
          operationName,
        },
      );
      if (!completed.completionClaimed) {
        throw new Error("Video generation run finished before completion.");
      }
      return {
        status: "completed" as const,
        run: completed.run,
        asset,
        completionClaimed: completed.completionClaimed,
      };
    });
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    const current = await readCurrentVideoRunResult(getDb(), run.id);
    if (current.status !== "processing") return current;
    const [retryingRun] = await getDb()
      .update(schema.assetGenerationRuns)
      .set({ error: err.message })
      .where(
        and(
          eq(schema.assetGenerationRuns.id, run.id),
          eq(schema.assetGenerationRuns.status, "processing"),
        ),
      )
      .returning();
    return retryingRun
      ? { status: "processing", run: retryingRun, completionClaimed: false }
      : readCurrentVideoRunResult(getDb(), run.id);
  }
}
