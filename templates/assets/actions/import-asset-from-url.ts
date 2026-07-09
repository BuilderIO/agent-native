import { defineAction } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createAssetFromBuffer } from "../server/lib/assets.js";
import {
  hasAllowedSignature,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "../server/lib/upload-validation.js";
import { serializeAsset } from "./_helpers.js";

const IMPORTABLE_REFERENCE_ROLES = [
  "style_reference",
  "subject_reference",
  "product_reference",
  "background_reference",
  "logo_reference",
  "diagram_reference",
] as const;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function normalizedImageMimeType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
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
    throw new Error("collectionId does not belong to this library.");
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
    throw new Error("folderId does not belong to this library.");
  }
}

function validateHttpsUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS image URLs can be imported.");
  }
}

async function readResponseBytes(response: Response): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Image too large (max 25 MB).");
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error("Image too large (max 25 MB).");
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_UPLOAD_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Image too large (max 25 MB).");
    }
    chunks.push(value);
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

async function fetchImageBytes(url: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      { maxRedirects: MAX_REDIRECTS },
    );
  } catch {
    throw new Error("Could not fetch that URL.");
  }

  if (!response.ok) {
    throw new Error(`Could not fetch that URL (${response.status}).`);
  }

  const mimeType = normalizedImageMimeType(
    response.headers.get("content-type"),
  );
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Only PNG, JPEG, WebP, and AVIF images are supported.");
  }

  const buffer = await readResponseBytes(response);
  if (!hasAllowedSignature(mimeType, buffer)) {
    throw new Error(
      "The fetched bytes do not match the advertised image type.",
    );
  }

  return { buffer, mimeType };
}

export default defineAction({
  description:
    "Import an external image URL into a library as a reference asset (style, subject, product, background, logo, or diagram reference). Use for ingesting brand imagery found on the web — e.g. a blog hero or logo — so it can be pinned to preset reference boards or set as the canonical logo.",
  schema: z.object({
    libraryId: z.string(),
    url: z.string().url(),
    role: z.enum(IMPORTABLE_REFERENCE_ROLES).default("style_reference"),
    collectionId: z.string().nullable().optional(),
    folderId: z.string().nullable().optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
  }),
  run: async ({
    libraryId,
    url,
    role,
    collectionId,
    folderId,
    title,
    description,
  }) => {
    await assertAccess("asset-library", libraryId, "editor");
    validateHttpsUrl(url);
    if (collectionId) {
      await assertCollectionBelongsToLibrary(collectionId, libraryId);
    }
    if (folderId) {
      await assertFolderBelongsToLibrary(folderId, libraryId);
    }

    const { buffer, mimeType } = await fetchImageBytes(url);
    const asset = await createAssetFromBuffer({
      libraryId,
      collectionId: collectionId ?? null,
      folderId: folderId ?? null,
      buffer,
      mimeType,
      mediaType: "image",
      role,
      status: "reference",
      title: title ?? null,
      description: description ?? null,
      sourceUrl: url,
      metadata: { importedFrom: url },
    });

    return serializeAsset(asset);
  },
});
