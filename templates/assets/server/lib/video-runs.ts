import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "./assets.js";
import { notifyGenerationRunFinished } from "./generation-run-notifications.js";
import { nowIso, parseJson, stringifyJson } from "./json.js";
import {
  pollBuilderVideoGeneration,
  pollGeminiVideoGeneration,
  RetryableVideoGenerationError,
} from "./video-generation.js";

type VideoRunDb = Pick<ReturnType<typeof getDb>, "select" | "update">;

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

export async function failVideoGenerationRun(
  runId: string,
  error: unknown,
): Promise<void> {
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
      ),
    )
    .returning();
  if (failedRun) await notifyGenerationRunFinished(failedRun, "failed");
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
            ...(run.orgId ? { orgId: run.orgId } : {}),
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
    const current = await readCurrentVideoRunResult(getDb(), run.id);
    if (current.status !== "processing") return current;
    throw err;
  }
}
