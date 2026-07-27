import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getQuery,
  readMultipartFormData,
  setHeader,
  setResponseStatus,
} from "h3";
import { nanoid } from "nanoid";
import pLimit from "p-limit";

import { serializeAsset } from "../../actions/_helpers.js";
import { IMAGE_CATEGORIES, MAX_ASSET_UPLOAD_FILES } from "../../shared/api.js";
import type { ImageCategory, ImageRole } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer, mediaTypeFromMime } from "../lib/assets.js";
import { nowIso, parseJson, stringifyJson } from "../lib/json.js";
import { getObject } from "../lib/storage.js";
import {
  filterDuplicateAssetUploads,
  hashAssetBuffer,
} from "../lib/upload-dedupe.js";
import {
  hasAllowedSignature,
  IMAGE_MIME_TYPES,
  maxUploadBytesForMediaType,
  VIDEO_MIME_TYPES,
} from "../lib/upload-validation.js";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
};

const UPLOAD_CONCURRENCY = 3;

/**
 * Decode a multipart text field as UTF-8.
 *
 * Nitro / h3 returns each part's `data` as a `Uint8Array`. Calling `.toString()`
 * directly on a `Uint8Array` inherits `Array.prototype.toString`, so a libraryId
 * like "TXHoc9..." becomes "84,88,72,..." (the bytes joined with commas), and
 * downstream code (e.g. `assertAccess("asset-library", id, ...)`) gets a
 * nonsense id and throws "No access". Wrap with `Buffer.from` so UTF-8 decoding
 * runs regardless of whether `data` is a Buffer or a Uint8Array.
 */
function readField(
  parts: Array<{ name?: string; data?: Uint8Array | Buffer }> | undefined,
  name: string,
): string | null {
  const data = parts?.find((part) => part.name === name)?.data;
  if (!data) return null;
  return Buffer.from(data).toString("utf-8");
}

function cleanMime(type: string | undefined, filename: string | undefined) {
  const raw = type?.split(";")[0].trim().toLowerCase();
  if (raw && (IMAGE_MIME_TYPES.has(raw) || VIDEO_MIME_TYPES.has(raw)))
    return raw;
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function categoryFromForm(value: unknown): ImageCategory {
  const raw = typeof value === "string" ? value : "style-only";
  return (IMAGE_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as ImageCategory)
    : "style-only";
}

function intentFromForm(value: unknown): "subject" | null {
  return value === "subject" ? "subject" : null;
}

function roleFromUpload(
  category: ImageCategory,
  intent: "subject" | null,
): ImageRole {
  if (intent === "subject") return "subject_reference";
  if (category === "logo") return "logo_reference";
  if (category === "product") return "product_reference";
  if (category === "diagram") return "diagram_reference";
  if (category === "video") return "video_reference";
  return "style_reference";
}

function defaultUploadTitle(
  mediaType: "image" | "video",
  intent: "subject" | null,
): string {
  if (intent === "subject") {
    return mediaType === "video" ? "Content video" : "Content image";
  }
  return mediaType === "video" ? "Reference video" : "Reference image";
}

async function assertCollectionBelongsToLibrary(
  collectionId: string,
  libraryId: string,
) {
  const [collection] = await getDb()
    .select({
      id: schema.assetCollections.id,
      libraryId: schema.assetCollections.libraryId,
    })
    .from(schema.assetCollections)
    .where(eq(schema.assetCollections.id, collectionId))
    .limit(1);
  if (!collection || collection.libraryId !== libraryId) {
    throw createError({
      statusCode: 400,
      statusMessage: "collectionId does not belong to this library",
    });
  }
}

async function assertFolderBelongsToLibrary(
  folderId: string,
  libraryId: string,
) {
  const [folder] = await getDb()
    .select({
      id: schema.assetFolders.id,
      libraryId: schema.assetFolders.libraryId,
    })
    .from(schema.assetFolders)
    .where(eq(schema.assetFolders.id, folderId))
    .limit(1);
  if (!folder || folder.libraryId !== libraryId) {
    throw createError({
      statusCode: 400,
      statusMessage: "folderId does not belong to this library",
    });
  }
}

async function withUserContext(event: any, fn: () => Promise<unknown>) {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId ?? undefined },
    fn,
  );
}

export const uploadAssets = defineEventHandler(async (event) =>
  withUserContext(event, async () => {
    const parts = await readMultipartFormData(event);
    const libraryId = readField(parts, "libraryId");
    if (!libraryId) {
      setResponseStatus(event, 400);
      return { error: "libraryId is required" };
    }
    await assertAccess("asset-library", libraryId, "editor");
    const collectionId = readField(parts, "collectionId") || null;
    const folderId = readField(parts, "folderId") || null;
    if (collectionId) {
      await assertCollectionBelongsToLibrary(collectionId, libraryId);
    }
    if (folderId) {
      await assertFolderBelongsToLibrary(folderId, libraryId);
    }
    const rawCategory = readField(parts, "category");
    const intent = intentFromForm(readField(parts, "intent"));
    const category =
      intent === "subject" ? "other" : categoryFromForm(rawCategory);
    const role = roleFromUpload(category, intent);
    const title = readField(parts, "title") || null;
    const files =
      parts?.filter((part) => part.name === "files" && part.data) ?? [];
    if (!files.length) {
      setResponseStatus(event, 400);
      return { error: "No files uploaded" };
    }
    if (files.length > MAX_ASSET_UPLOAD_FILES) {
      setResponseStatus(event, 413);
      return { error: `Too many files (max ${MAX_ASSET_UPLOAD_FILES})` };
    }
    const preparedFiles = [];
    for (const part of files) {
      const mimeType = cleanMime(part.type, part.filename);
      const mediaType = mediaTypeFromMime(mimeType);
      const maxBytes = maxUploadBytesForMediaType(mediaType);
      if (part.data.byteLength > maxBytes) {
        setResponseStatus(event, 413);
        return {
          error:
            mediaType === "video"
              ? "File too large (max 250 MB per video)"
              : "File too large (max 25 MB per image)",
        };
      }
      if (!hasAllowedSignature(mimeType, part.data)) {
        setResponseStatus(event, 400);
        return {
          error:
            "Only PNG, JPEG, WebP, AVIF, MP4, MOV, M4V, and WebM assets are supported.",
        };
      }
      const buffer = Buffer.from(part.data);
      const contentHash = hashAssetBuffer(buffer);
      const filename = part.filename || null;
      preparedFiles.push({
        altText: filename,
        buffer,
        contentHash,
        filename,
        mimeType,
        mediaType,
        title: title || filename || defaultUploadTitle(mediaType, intent),
        metadata: {
          contentHash,
          ...(intent === "subject" ? { intent: "subject" } : {}),
          originalName: filename,
          uploadId: nanoid(),
        },
      });
    }

    const existingReferenceAssets = await getDb()
      .select({
        id: schema.assets.id,
        title: schema.assets.title,
        mediaType: schema.assets.mediaType,
        mimeType: schema.assets.mimeType,
        sizeBytes: schema.assets.sizeBytes,
        metadata: schema.assets.metadata,
        objectKey: schema.assets.objectKey,
      })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.libraryId, libraryId),
          eq(schema.assets.status, "reference"),
          eq(schema.assets.role, role),
        ),
      );
    const deduped = await filterDuplicateAssetUploads({
      files: preparedFiles,
      existingAssets: existingReferenceAssets,
      readExistingAssetBuffer: (asset) => getObject(asset.objectKey),
    });

    if (!deduped.files.length) {
      return {
        count: 0,
        assets: [],
        skippedDuplicates: deduped.skippedDuplicates,
      };
    }

    const limit = pLimit(UPLOAD_CONCURRENCY);
    const uploadResults = await Promise.allSettled(
      deduped.files.map((file) =>
        limit(async () => ({
          file,
          asset: await createAssetFromBuffer({
            libraryId,
            collectionId,
            folderId,
            buffer: file.buffer,
            mimeType: file.mimeType,
            mediaType: file.mediaType,
            role,
            status: "reference",
            title: file.title,
            altText: file.altText,
            metadata: file.metadata,
            category,
          }),
        })),
      ),
    );
    const assets = uploadResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.asset] : [],
    );
    const serializedAssets = assets.map((asset) => serializeAsset(asset));
    const errors = uploadResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              filename: deduped.files[index]?.filename ?? null,
              message:
                result.reason instanceof Error
                  ? result.reason.message
                  : "Upload failed",
            },
          ]
        : [],
    );
    if (!assets.length && errors.length) {
      setResponseStatus(event, 500);
      return {
        error: errors[0]?.message ?? "Upload failed",
        count: 0,
        assets: serializedAssets,
        skippedDuplicates: deduped.skippedDuplicates,
        errors,
      };
    }
    return {
      count: assets.length,
      assets: serializedAssets,
      skippedDuplicates: deduped.skippedDuplicates,
      errors,
    };
  }),
);

export const streamAsset = defineEventHandler(async (event) =>
  withUserContext(event, async () => {
    const assetId = event.context.params?.assetId;
    if (!assetId)
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    const [asset] = await getDb()
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId))
      .limit(1);
    if (!asset)
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    await assertAccess("asset-library", asset.libraryId, "viewer");
    const query = getQuery(event);
    let useThumb = Boolean(
      query.variant === "thumb" && asset.thumbnailObjectKey,
    );
    let body: Buffer;
    try {
      body = await getObject(
        useThumb ? asset.thumbnailObjectKey! : asset.objectKey,
      );
    } catch (error) {
      if (!useThumb) throw error;
      useThumb = false;
      body = await getObject(asset.objectKey);
    }
    setHeader(event, "content-type", useThumb ? "image/webp" : asset.mimeType);
    setHeader(event, "cache-control", "private, max-age=300");
    if (query.download === "1") {
      const ext =
        asset.mimeType === "image/jpeg"
          ? "jpg"
          : asset.mimeType === "image/webp"
            ? "webp"
            : asset.mimeType === "image/avif"
              ? "avif"
              : asset.mimeType === "video/webm"
                ? "webm"
                : asset.mimeType === "video/quicktime"
                  ? "mov"
                  : asset.mimeType === "video/x-m4v"
                    ? "m4v"
                    : asset.mimeType.startsWith("video/")
                      ? "mp4"
                      : "png";
      setHeader(
        event,
        "content-disposition",
        `attachment; filename="${asset.title || asset.id}.${ext}"`,
      );
    }
    return body;
  }),
);

export async function markAssetSaved(
  assetId: string,
  folderId?: string | null,
) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("Asset not found.");
  await assertAccess("asset-library", asset.libraryId, "editor");
  if (folderId !== undefined && folderId !== null) {
    await assertFolderBelongsToLibrary(folderId, asset.libraryId);
  }
  const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
  metadata.savedAt = nowIso();
  const updates: Record<string, unknown> = {
    status: "saved",
    metadata: stringifyJson(metadata),
    updatedAt: nowIso(),
  };
  if (folderId !== undefined) updates.folderId = folderId;
  await db
    .update(schema.assets)
    .set(updates)
    .where(eq(schema.assets.id, assetId));
}
