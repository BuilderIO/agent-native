import { randomUUID } from "node:crypto";

import {
  extractDominantColors,
  fingerprintMedia,
} from "@agent-native/core/ingestion";
import { eq } from "drizzle-orm";

import { availableEmbeddingFamilies } from "../embeddings/providers.js";
import {
  appendMediaEnrichmentVersion,
  getActiveEmbeddingSet,
  getCreativeContextItem,
  recordEmbeddingMetadata,
} from "../store/index.js";
import { getCreativeContext } from "./context.js";
import { readCreativeContextMedia } from "./media.js";

export async function projectCreativeContextMedia(mediaId: string) {
  const { getDb, schema, projections } = getCreativeContext();
  if (!projections?.media) return { mediaId, projected: false as const };
  const rows = await getDb()
    .select({
      itemId: schema.contextMedia.itemId,
      itemVersionId: schema.contextMedia.itemVersionId,
    })
    .from(schema.contextMedia)
    .where(eq(schema.contextMedia.id, mediaId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Creative context media was not found.");
  const detail = await getCreativeContextItem(row.itemId, row.itemVersionId);
  const media = detail?.media.find((entry) => entry.id === mediaId);
  if (!detail || !media) {
    throw new Error("Creative context media is not accessible.");
  }
  await projections.media.project({
    sourceId: detail.item.sourceId,
    itemId: detail.item.id,
    itemVersionId: detail.version.id,
    media,
    sourceType: "brand-import",
    dedupeKey: `${media.id}:${detail.version.id}`,
  });
  return { mediaId, projected: true as const };
}

export async function enrichCreativeContextMedia(input: {
  mediaId: string;
  paletteLimit?: number;
}) {
  const loaded = await readCreativeContextMedia({ mediaId: input.mediaId });
  if (
    loaded.mimeType !== "image/png" &&
    loaded.mimeType !== "image/jpeg" &&
    loaded.mimeType !== "image/webp" &&
    loaded.mimeType !== "image/gif"
  ) {
    throw new Error(
      "Creative context media enrichment supports PNG, JPEG, WebP, or GIF images.",
    );
  }
  const { vectorAdapter, enrichment } = getCreativeContext();
  const fingerprint = fingerprintMedia(loaded.data, loaded.mimeType);
  const palette = await extractDominantColors(
    loaded.data,
    input.paletteLimit ?? 6,
  ).catch(() => []);
  const [caption, ocrText] = await Promise.all([
    enrichment?.captionImage?.({
      data: loaded.data,
      mimeType: loaded.mimeType,
      itemId: loaded.itemId,
      itemVersionId: loaded.itemVersionId,
      mediaId: input.mediaId,
    }) ?? Promise.resolve(null),
    enrichment?.ocrImage?.({
      data: loaded.data,
      mimeType: loaded.mimeType,
      itemId: loaded.itemId,
      itemVersionId: loaded.itemVersionId,
      mediaId: input.mediaId,
    }) ?? Promise.resolve(null),
  ]);
  const nextCaption = caption ?? loaded.media?.caption ?? null;
  const nextCaptionStatus = enrichment?.captionImage
    ? caption
      ? ("complete" as const)
      : ("failed" as const)
    : ("pending" as const);
  const nextOcrText = ocrText ?? loaded.media?.ocrText ?? null;
  const snapshot = await appendMediaEnrichmentVersion({
    mediaId: input.mediaId,
    palette,
    contentHash: fingerprint.sha256,
    caption: nextCaption,
    captionStatus: nextCaptionStatus,
    ocrText: nextOcrText,
  });

  const families = await availableEmbeddingFamilies();
  const set = await getActiveEmbeddingSet();
  const family = set
    ? (families.find(
        (candidate) =>
          candidate.id === set!.family &&
          candidate.model === set!.model &&
          candidate.version === set!.version,
      ) ?? null)
    : null;
  let embeddingId: string | null = null;
  const imageMimeSupported =
    !family?.supportedImageMimeTypes ||
    family.supportedImageMimeTypes.includes(loaded.mimeType);
  if (set && family && vectorAdapter && imageMimeSupported) {
    const [vector] = await family.embed(
      [
        {
          text: [caption, ocrText].filter(Boolean).join("\n") || undefined,
          images: [
            {
              mimeType: loaded.mimeType,
              base64: Buffer.from(loaded.data).toString("base64"),
            },
          ],
        },
      ],
      "document",
    );
    if (vector) {
      embeddingId = `ccem_${randomUUID()}`;
      const stored = await vectorAdapter.upsert({
        embeddingId,
        embeddingSetId: set.id,
        vector,
      });
      await recordEmbeddingMetadata({
        embeddingSetId: set.id,
        itemId: snapshot.itemId,
        itemVersionId: snapshot.itemVersionId,
        targetType: "media",
        targetId: snapshot.mediaId,
        vectorKey: stored.vectorKey,
        dimensions: vector.length,
        checksum: fingerprint.sha256,
      });
    }
  }
  await projectCreativeContextMedia(snapshot.mediaId);
  return {
    mediaId: snapshot.mediaId,
    itemId: snapshot.itemId,
    itemVersionId: snapshot.itemVersionId,
    versionAppended: snapshot.appended,
    palette,
    caption: nextCaption,
    ocrText: nextOcrText,
    contentHash: fingerprint.sha256,
    embeddingId,
    embeddingFamily: family?.id ?? null,
    embeddingSkippedReason:
      set && family && !imageMimeSupported
        ? `Active embedding family ${family.id} does not accept ${loaded.mimeType}.`
        : null,
  };
}
