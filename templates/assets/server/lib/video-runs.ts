import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "./assets.js";
import { nowIso, parseJson, stringifyJson } from "./json.js";
import { pollGeminiVideoGeneration } from "./video-generation.js";

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

    const folderId =
      typeof metadata.folderId === "string" ? metadata.folderId : null;
    const category =
      typeof metadata.category === "string" ? metadata.category : "video";
    const asset = await createAssetFromBuffer({
      libraryId: run.libraryId,
      collectionId: run.collectionId,
      folderId,
      buffer: polled.video.buffer,
      mimeType: polled.video.mimeType,
      mediaType: "video",
      role: "generated",
      status: "candidate",
      title:
        typeof metadata.title === "string" ? metadata.title : "Generated video",
      description:
        typeof metadata.description === "string" ? metadata.description : null,
      altText:
        typeof metadata.description === "string" ? metadata.description : null,
      prompt: run.prompt,
      model: run.model,
      aspectRatio: run.aspectRatio,
      imageSize: run.resolution ?? run.imageSize,
      durationSeconds: run.durationSeconds,
      generationRunId: run.id,
      sourceUrl: polled.video.sourceUrl,
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
    const nextMetadata = {
      ...metadata,
      provider: "gemini",
      mediaType: "video",
      assetId: asset.id,
      outputAssetIds: [asset.id],
      providerGenerationId: polled.video.providerGenerationId,
      sourceUrl: polled.video.sourceUrl,
      operationName,
    };
    const completedAt = nowIso();
    const nextRun = {
      ...run,
      status: "completed",
      completedAt,
      metadata: stringifyJson(nextMetadata),
    };
    await getDb()
      .update(schema.assetGenerationRuns)
      .set({
        status: "completed",
        completedAt,
        metadata: nextRun.metadata,
      })
      .where(eq(schema.assetGenerationRuns.id, run.id));
    return { status: "completed", run: nextRun, asset };
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
