import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { absoluteUrl, parseJson } from "../server/lib/json.js";
import type {
  AssetLineageSummary,
  GenerationSessionItemSummary,
  GenerationPresetSummary,
  GenerationSessionSummary,
  ImageAssetMetadata,
  StyleBrief,
} from "../shared/api.js";

export async function requireLibrary(id: string) {
  const access = await resolveAccess("asset-library", id);
  if (!access) throw new Error("Asset library not found or not accessible.");
  return access.resource;
}

export async function requireGenerationSessionInLibrary(
  sessionId: string,
  libraryId: string,
) {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.assetGenerationSessions)
    .where(eq(schema.assetGenerationSessions.id, sessionId))
    .limit(1);
  if (!session) throw new Error("Generation session not found.");
  if (session.libraryId !== libraryId) {
    throw new Error("Generation session does not belong to this library.");
  }
  return session;
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

export function assetUrls(asset: {
  id: string;
  thumbnailObjectKey?: string | null;
  objectKey: string;
}) {
  const previewUrl =
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(`/api/assets/${asset.id}/content`);
  const thumbnailUrl =
    directMediaUrl(asset.thumbnailObjectKey) ??
    directMediaUrl(asset.objectKey) ??
    absoluteUrl(
      `/api/assets/${asset.id}/content${asset.thumbnailObjectKey ? "?variant=thumb" : ""}`,
    );

  return {
    url: absoluteUrl(`/asset/${asset.id}`),
    urlPath: `/asset/${asset.id}`,
    legacyUrl: absoluteUrl(`/image/${asset.id}`),
    legacyUrlPath: `/image/${asset.id}`,
    downloadUrl: absoluteUrl(`/api/assets/${asset.id}/content?download=1`),
    previewUrl,
    thumbnailUrl,
    embedPath: `/asset/${asset.id}/embed`,
    embedUrl: absoluteUrl(`/asset/${asset.id}/embed`),
  };
}

export function serializeLibrary(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    customInstructions: row.customInstructions ?? "",
    styleBrief: parseJson<StyleBrief>(row.styleBrief, {}),
    settings: parseJson<Record<string, unknown>>(row.settings, {}),
    canonicalLogoAssetId: row.canonicalLogoAssetId,
    coverAssetId: row.coverAssetId,
    visibility: row.visibility,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeGenerationRun(row: any) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  const referenceAssetIds = parseJson<string[]>(row.referenceAssetIds, []);
  const outputAssetIds = Array.isArray(metadata.outputAssetIds)
    ? metadata.outputAssetIds.filter(
        (id): id is string => typeof id === "string",
      )
    : typeof metadata.assetId === "string"
      ? [metadata.assetId]
      : [];
  return {
    ...row,
    presetId: row.presetId ?? metadata.presetId ?? null,
    sessionId: row.sessionId ?? metadata.sessionId ?? null,
    originalPrompt: row.prompt,
    userPrompt: row.prompt,
    referenceAssetIds,
    metadata,
    mediaType: row.mediaType ?? metadata.mediaType ?? "image",
    durationSeconds: row.durationSeconds ?? metadata.durationSeconds ?? null,
    resolution: row.resolution ?? metadata.resolution ?? null,
    settingsUsed: metadata.settingsUsed ?? {
      model: row.model,
      aspectRatio: row.aspectRatio,
      imageSize: row.imageSize,
      groundingMode: row.groundingMode,
    },
    referenceSelection: metadata.referenceSelection ?? {
      mode: "legacy",
      selectedAssetIds: referenceAssetIds,
    },
    output: {
      assetId: typeof metadata.assetId === "string" ? metadata.assetId : null,
      assetIds: outputAssetIds,
      provider:
        typeof metadata.provider === "string" ? metadata.provider : null,
      providerGenerationId:
        typeof metadata.providerGenerationId === "string"
          ? metadata.providerGenerationId
          : null,
      creditsCharged: metadata.creditsCharged ?? null,
    },
  };
}

export function serializeGenerationPreset(row: any): GenerationPresetSummary {
  return {
    id: row.id,
    libraryId: row.libraryId,
    collectionId: row.collectionId ?? null,
    title: row.title,
    description: row.description ?? null,
    category: row.category,
    mediaType: row.mediaType ?? "image",
    promptTemplate: row.promptTemplate ?? null,
    aspectRatio: row.aspectRatio,
    imageSize: row.imageSize,
    model: row.model,
    textPolicy: row.textPolicy ?? "",
    referencePolicy: row.referencePolicy ?? "auto",
    settings: parseJson<Record<string, unknown>>(row.settings, {}),
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeGenerationSession(row: any): GenerationSessionSummary {
  const items = Array.isArray(row.items)
    ? (row.items as GenerationSessionItemSummary[])
    : undefined;
  const variationCount =
    items?.filter((item) => item.lineage?.kind === "variation").length ?? 0;
  const assetCount = items?.filter((item) => item.assetId).length ?? 0;
  return {
    id: row.id,
    libraryId: row.libraryId,
    collectionId: row.collectionId ?? null,
    presetId: row.presetId ?? null,
    title: row.title,
    brief: row.brief ?? null,
    status: row.status ?? "open",
    activeAssetId: row.activeAssetId ?? null,
    feedbackSummary: row.feedbackSummary ?? "",
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(items
      ? {
          items,
          itemCount: items.length,
          assetCount,
          variationCount,
        }
      : {}),
  };
}

type AssetRowForLineage = {
  id: string;
  role?: string | null;
  generationRunId?: string | null;
  metadata?: string | null;
  createdAt?: string | null;
};

function assetSourceId(metadata: ImageAssetMetadata): string | null {
  if (typeof metadata.sourceAssetId === "string" && metadata.sourceAssetId) {
    return metadata.sourceAssetId;
  }
  return typeof metadata.subjectAssetId === "string" && metadata.subjectAssetId
    ? metadata.subjectAssetId
    : null;
}

function assetCreatedAtMs(row: AssetRowForLineage): number {
  if (!row.createdAt) return 0;
  const time = Date.parse(row.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function compareAssetsByCreation(
  left: { row: AssetRowForLineage },
  right: { row: AssetRowForLineage },
): number {
  return (
    assetCreatedAtMs(left.row) - assetCreatedAtMs(right.row) ||
    String(left.row.generationRunId ?? "").localeCompare(
      String(right.row.generationRunId ?? ""),
    ) ||
    left.row.id.localeCompare(right.row.id)
  );
}

function compactAssetId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 4)}...${id.slice(-4)}` : id;
}

export function buildAssetLineage(
  rows: AssetRowForLineage[],
): Map<string, AssetLineageSummary> {
  const generatedAssets = rows
    .map((row) => ({
      row,
      metadata: parseJson<ImageAssetMetadata>(row.metadata, {}),
    }))
    .filter(
      ({ row, metadata }) =>
        row.role === "generated" ||
        metadata.generated === true ||
        Boolean(row.generationRunId),
    )
    .sort(compareAssetsByCreation);
  const lineageByAssetId = new Map<string, AssetLineageSummary>();
  const variationCountsBySource = new Map<string, number>();
  let originalCount = 0;

  for (const item of generatedAssets) {
    const sourceAssetId = assetSourceId(item.metadata);
    if (sourceAssetId) {
      const serial = (variationCountsBySource.get(sourceAssetId) ?? 0) + 1;
      variationCountsBySource.set(sourceAssetId, serial);
      lineageByAssetId.set(item.row.id, {
        kind: "variation",
        serial,
        label: `Variation ${serial}`,
        sourceAssetId,
        sourceLabel:
          lineageByAssetId.get(sourceAssetId)?.label ??
          compactAssetId(sourceAssetId),
      });
      continue;
    }

    originalCount += 1;
    lineageByAssetId.set(item.row.id, {
      kind: "original",
      serial: originalCount,
      label: `Original ${originalCount}`,
      sourceAssetId: null,
      sourceLabel: null,
    });
  }

  return lineageByAssetId;
}

export function serializeAssets(rows: any[]) {
  const lineageByAssetId = buildAssetLineage(rows);
  return rows.map((row) =>
    serializeAsset(row, lineageByAssetId.get(row.id) ?? null),
  );
}

export function serializeGenerationSessionItems(
  items: any[],
  lineageByAssetId = new Map<string, AssetLineageSummary>(),
): GenerationSessionItemSummary[] {
  let assetCount = 0;
  let runCount = 0;
  return [...items]
    .sort(
      (left, right) =>
        Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) ||
        String(left.createdAt ?? "").localeCompare(
          String(right.createdAt ?? ""),
        ) ||
        String(left.id ?? "").localeCompare(String(right.id ?? "")),
    )
    .map((item) => {
      const lineage = item.assetId
        ? (lineageByAssetId.get(item.assetId) ?? null)
        : null;
      if (item.assetId) assetCount += 1;
      if (!item.assetId && item.generationRunId) runCount += 1;
      return {
        id: item.id,
        assetId: item.assetId ?? null,
        generationRunId: item.generationRunId ?? null,
        role: item.role ?? "candidate",
        sortOrder: Number(item.sortOrder ?? 0),
        createdAt: item.createdAt,
        label:
          lineage?.label ??
          (item.assetId
            ? item.role === "active" && assetCount === 1
              ? "Original"
              : `Candidate ${assetCount}`
            : `Run ${runCount}`),
        lineage,
      };
    });
}

export function serializeAsset(
  row: any,
  lineageOrIndex: AssetLineageSummary | null | number = null,
) {
  const lineage =
    typeof lineageOrIndex === "number" ? null : (lineageOrIndex ?? null);
  const metadata = parseJson<ImageAssetMetadata>(row.metadata, {});
  return {
    id: row.id,
    libraryId: row.libraryId,
    collectionId: row.collectionId,
    folderId: row.folderId ?? null,
    mediaType:
      row.mediaType ?? (row.mimeType?.startsWith("video/") ? "video" : "image"),
    role: row.role,
    status: row.status,
    title: row.title,
    description: row.description ?? metadata.description ?? null,
    altText: row.altText,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspectRatio,
    imageSize: row.imageSize,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds ?? null,
    sizeBytes: row.sizeBytes,
    sourceUrl: row.sourceUrl,
    generationRunId: row.generationRunId,
    metadata,
    lineage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...assetUrls(row),
  };
}

export async function getAssetOrThrow(id: string) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, id))
    .limit(1);
  if (!asset) throw new Error("Asset not found.");
  await requireLibrary(asset.libraryId);
  return asset;
}
