import {
  createError,
  defineEventHandler,
  getQuery,
  readMultipartFormData,
  setHeader,
  setResponseStatus,
} from "h3";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "../lib/assets.js";
import { hasRasterImageSignature } from "../lib/image-processing.js";
import { getObject } from "../lib/storage.js";
import { nowIso, parseJson, stringifyJson } from "../lib/json.js";
import { IMAGE_CATEGORIES } from "../../shared/api.js";
import type { ImageCategory, ImageRole } from "../../shared/api.js";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

function cleanMime(type: string | undefined, filename: string | undefined) {
  const raw = type?.split(";")[0].trim().toLowerCase();
  if (raw && Object.values(MIME_BY_EXT).includes(raw)) return raw;
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function categoryFromForm(value: unknown): ImageCategory {
  const raw = typeof value === "string" ? value : "style-only";
  return (IMAGE_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as ImageCategory)
    : "style-only";
}

function roleFromCategory(category: ImageCategory): ImageRole {
  if (category === "logo") return "logo_reference";
  if (category === "product") return "product_reference";
  if (category === "diagram") return "diagram_reference";
  return "style_reference";
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
    const libraryId = parts
      ?.find((part) => part.name === "libraryId")
      ?.data?.toString();
    if (!libraryId) {
      setResponseStatus(event, 400);
      return { error: "libraryId is required" };
    }
    await assertAccess("image-library", libraryId, "editor");
    const collectionId =
      parts?.find((part) => part.name === "collectionId")?.data?.toString() ||
      null;
    const category = categoryFromForm(
      parts?.find((part) => part.name === "category")?.data?.toString(),
    );
    const title =
      parts?.find((part) => part.name === "title")?.data?.toString() || null;
    const files =
      parts?.filter((part) => part.name === "files" && part.data) ?? [];
    if (!files.length) {
      setResponseStatus(event, 400);
      return { error: "No files uploaded" };
    }
    if (files.length > 20) {
      setResponseStatus(event, 413);
      return { error: "Too many files (max 20)" };
    }
    const assets = [];
    for (const part of files) {
      if (part.data.byteLength > 25 * 1024 * 1024) {
        setResponseStatus(event, 413);
        return { error: "File too large (max 25 MB per image)" };
      }
      const mimeType = cleanMime(part.type, part.filename);
      if (!hasRasterImageSignature(mimeType, part.data)) {
        setResponseStatus(event, 400);
        return {
          error: "Only PNG, JPEG, WebP, and AVIF images are supported.",
        };
      }
      const asset = await createAssetFromBuffer({
        libraryId,
        collectionId,
        buffer: Buffer.from(part.data),
        mimeType,
        role: roleFromCategory(category),
        status: "reference",
        title: title || part.filename || "Reference image",
        metadata: {
          originalName: part.filename,
          uploadId: nanoid(),
        },
        category,
      });
      assets.push(asset);
    }
    return { count: assets.length, assets };
  }),
);

export const streamAsset = defineEventHandler(async (event) =>
  withUserContext(event, async () => {
    const assetId = event.context.params?.assetId;
    if (!assetId)
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    const [asset] = await getDb()
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.id, assetId))
      .limit(1);
    if (!asset)
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    await assertAccess("image-library", asset.libraryId, "viewer");
    const query = getQuery(event);
    const useThumb = query.variant === "thumb" && asset.thumbnailObjectKey;
    const key = useThumb ? asset.thumbnailObjectKey! : asset.objectKey;
    const body = await getObject(key);
    setHeader(event, "content-type", useThumb ? "image/webp" : asset.mimeType);
    setHeader(event, "cache-control", "private, max-age=300");
    if (query.download === "1") {
      setHeader(
        event,
        "content-disposition",
        `attachment; filename="${asset.title || asset.id}.png"`,
      );
    }
    return body;
  }),
);

export async function markAssetSaved(assetId: string) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("Image asset not found.");
  await assertAccess("image-library", asset.libraryId, "editor");
  const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
  metadata.savedAt = nowIso();
  await db
    .update(schema.imageAssets)
    .set({
      status: "saved",
      metadata: stringifyJson(metadata),
      updatedAt: nowIso(),
    })
    .where(eq(schema.imageAssets.id, assetId));
}
