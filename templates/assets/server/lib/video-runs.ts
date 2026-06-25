import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "./assets.js";
import { nowIso, parseJson, stringifyJson } from "./json.js";
import { pollGeminiVideoGeneration } from "./video-generation.js";

type VideoRunDb = Pick<ReturnType<typeof getDb>, "select" | "update">;

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

async function markRunCompletedWithAsset(
  db: VideoRunDb,
  run: typeof schema.assetGenerationRuns.$inferSelect,
  metadata: Record<string, unknown>,
  asset: typeof schema.assets.$inferSelect,
  provider?: {
    providerGenerationId?: string | null;
    sourceUrl?: string | null;
    operationName?: string | null;
  },
) {
  const nextMetadata = {
    ...metadata,
    provider: "gemini",
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
    completedAt,
    metadata: stringifyJson(nextMetadata),
  };
  await db
    .update(schema.assetGenerationRuns)
    .set({
      status: "completed",
      completedAt,
      metadata: nextRun.metadata,
    })
    .where(eq(schema.assetGenerationRuns.id, run.id));
  return nextRun;
}

export async function completeVideoGenerationRun(
  run: typeof schema.assetGenerationRuns.$inferSelect,
): Promise<
  | {
      status: "processing";
      run: typeof schema.assetGenerationRuns.$inferSelect;
    }
  | {
      status: "completed";
      run: typeof schema.assetGenerationRuns.$inferSelect;
      asset: typeof schema.assets.$inferSelect;
    }
> {
  const metadata = parseJson<Record<string, unknown>>(run.metadata, {});
  const existingAsset = await findAssetForRun(getDb(), run.id);
  if (existingAsset) {
    const nextRun = await markRunCompletedWithAsset(
      getDb(),
      run,
      metadata,
      existingAsset,
    );
    return { status: "completed", run: nextRun, asset: existingAsset };
  }

  const operationName =
    typeof metadata.operationName === "string" ? metadata.operationName : null;
  if (!operationName) {
    throw new Error("Video generation run has no provider operation name.");
  }

  try {
    const polled = await pollGeminiVideoGeneration(operationName);
    if (polled.status === "processing") {
      const nextMetadata = {
        ...metadata,
        providerStatus: "processing",
        lastPolledAt: nowIso(),
      };
      const nextRun = {
        ...run,
        status: "processing",
        metadata: stringifyJson(nextMetadata),
      };
      await getDb()
        .update(schema.assetGenerationRuns)
        .set({
          status: "processing",
          metadata: nextRun.metadata,
        })
        .where(eq(schema.assetGenerationRuns.id, run.id));
      return { status: "processing", run: nextRun };
    }

    try {
      return await getDb().transaction(async (tx) => {
        const existing = await findAssetForRun(tx, run.id);
        if (existing) {
          const nextRun = await markRunCompletedWithAsset(
            tx,
            run,
            metadata,
            existing,
            {
              providerGenerationId: polled.video.providerGenerationId,
              sourceUrl: polled.video.sourceUrl,
              operationName,
            },
          );
          return {
            status: "completed" as const,
            run: nextRun,
            asset: existing,
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
            provider: "gemini",
            mediaType: "video",
            compiledPrompt: run.compiledPrompt,
            providerGenerationId: polled.video.providerGenerationId,
            sourceUrl: polled.video.sourceUrl,
            operationName,
          },
          category: category as any,
        });
        const nextRun = await markRunCompletedWithAsset(
          tx,
          run,
          metadata,
          asset,
          {
            providerGenerationId: polled.video.providerGenerationId,
            sourceUrl: polled.video.sourceUrl,
            operationName,
          },
        );
        return { status: "completed" as const, run: nextRun, asset };
      });
    } catch (err) {
      const existing = await findAssetForRun(getDb(), run.id);
      if (existing) {
        const nextRun = await markRunCompletedWithAsset(
          getDb(),
          run,
          metadata,
          existing,
          {
            providerGenerationId: polled.video.providerGenerationId,
            sourceUrl: polled.video.sourceUrl,
            operationName,
          },
        );
        return { status: "completed", run: nextRun, asset: existing };
      }
      throw err;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Video generation failed.";
    await getDb()
      .update(schema.assetGenerationRuns)
      .set({
        status: "failed",
        error: message,
        completedAt: nowIso(),
      })
      .where(eq(schema.assetGenerationRuns.id, run.id));
    throw err;
  }
}
