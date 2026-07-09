import { defineAction } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createAssetFromBuffer } from "../server/lib/assets.js";
import { getObject } from "../server/lib/storage.js";
import {
  filterDuplicateAssetUploads,
  hashAssetBuffer,
} from "../server/lib/upload-dedupe.js";
import {
  hasAllowedSignature,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "../server/lib/upload-validation.js";
import { IMAGE_CATEGORIES } from "../shared/api.js";
import type { ImageCategory } from "../shared/api.js";
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

// Mirrors the upload route's category↔role mapping so imported references
// appear in the same category-filtered views as uploaded equivalents.
const DEFAULT_CATEGORY_BY_ROLE: Record<
  (typeof IMPORTABLE_REFERENCE_ROLES)[number],
  ImageCategory
> = {
  style_reference: "style-only",
  subject_reference: "other",
  product_reference: "product",
  background_reference: "other",
  logo_reference: "logo",
  diagram_reference: "diagram",
};

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
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials cannot be imported.");
  }
}

// Query params that carry bearer credentials (S3/GCS presigning, Azure SAS,
// generic tokens). Provenance drops the query when one is present so signed
// URLs do not become durable asset metadata; the fetch still uses the full URL.
const CREDENTIAL_QUERY_PARAM_RE =
  /^(x-amz-|x-goog-)|^(sig|signature|token|access[-_]?token|auth|authorization|expires|policy|credential|apikey|api[-_]?key|key|secret|session|sv|se|sp|st|spr|sr|skoid)$/i;

function sanitizeProvenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  for (const param of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_PARAM_RE.test(param)) {
      parsed.search = "";
      break;
    }
  }
  return parsed.toString();
}

/** Release an unread response body so its connection is not held until GC. */
async function discardResponseBody(response: Response) {
  await response.body?.cancel().catch(() => {});
}

async function readResponseBytes(response: Response): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_IMAGE_UPLOAD_BYTES) {
    await discardResponseBody(response);
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
      { maxRedirects: MAX_REDIRECTS, httpsOnly: true },
    );
  } catch {
    throw new Error("Could not fetch that URL.");
  }

  if (!response.ok) {
    await discardResponseBody(response);
    throw new Error(`Could not fetch that URL (${response.status}).`);
  }

  const mimeType = normalizedImageMimeType(
    response.headers.get("content-type"),
  );
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    await discardResponseBody(response);
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

/**
 * Same dedupe scope as the upload route: reference assets in this library
 * with the same role. Returns the existing asset when the fetched bytes are
 * already stored, so repeat imports are idempotent instead of duplicating
 * the asset row and blob.
 */
async function findDuplicateReferenceAsset(input: {
  libraryId: string;
  role: (typeof IMPORTABLE_REFERENCE_ROLES)[number];
  buffer: Buffer;
  mimeType: string;
  contentHash: string;
  filename: string | null;
}): Promise<typeof schema.assets.$inferSelect | null> {
  const db = getDb();
  const existingReferenceAssets = await db
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
        eq(schema.assets.libraryId, input.libraryId),
        eq(schema.assets.status, "reference"),
        eq(schema.assets.role, input.role),
      ),
    );
  const { skippedDuplicates } = await filterDuplicateAssetUploads({
    files: [
      {
        altText: null,
        buffer: input.buffer,
        contentHash: input.contentHash,
        filename: input.filename,
        mediaType: "image",
        metadata: {},
        mimeType: input.mimeType,
        title: "",
      },
    ],
    existingAssets: existingReferenceAssets,
    readExistingAssetBuffer: (asset) => getObject(asset.objectKey),
  });
  const duplicate = skippedDuplicates.find(
    (skip) => skip.reason === "existing-asset" && skip.assetId,
  );
  if (!duplicate?.assetId) return null;
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, duplicate.assetId))
    .limit(1);
  return asset ?? null;
}

export default defineAction({
  description:
    "Import an external image URL into a library as a reference asset (style, subject, product, background, logo, or diagram reference). Use for ingesting brand imagery found on the web — e.g. a blog hero or logo — so it can be pinned to preset reference boards or set as the canonical logo.",
  schema: z.object({
    libraryId: z.string(),
    url: z.string().url(),
    role: z.enum(IMPORTABLE_REFERENCE_ROLES).default("style_reference"),
    category: z
      .enum(IMAGE_CATEGORIES)
      .optional()
      .describe(
        "Deliverable category for filtered views (e.g. hero, campaign). Defaults to the category matching the chosen role.",
      ),
    collectionId: z.string().nullable().optional(),
    folderId: z.string().nullable().optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
  }),
  run: async (args) => {
    const { libraryId, url, role, category, title, description } = args;
    // An empty-string id means "unassigned", never a real row — normalize to
    // null so it can't skip membership validation yet still land in the row.
    const collectionId = args.collectionId || null;
    const folderId = args.folderId || null;
    await assertAccess("asset-library", libraryId, "editor");
    validateHttpsUrl(url);
    if (collectionId) {
      await assertCollectionBelongsToLibrary(collectionId, libraryId);
    }
    if (folderId) {
      await assertFolderBelongsToLibrary(folderId, libraryId);
    }

    const { buffer, mimeType } = await fetchImageBytes(url);
    const contentHash = hashAssetBuffer(buffer);
    const duplicate = await findDuplicateReferenceAsset({
      libraryId,
      role,
      buffer,
      mimeType,
      contentHash,
      filename: new URL(url).pathname.split("/").pop() || null,
    });
    if (duplicate) {
      return { ...serializeAsset(duplicate), deduplicated: true };
    }

    const provenanceUrl = sanitizeProvenanceUrl(url);
    const asset = await createAssetFromBuffer({
      libraryId,
      collectionId,
      folderId,
      buffer,
      mimeType,
      mediaType: "image",
      role,
      category: category ?? DEFAULT_CATEGORY_BY_ROLE[role],
      status: "reference",
      title: title ?? null,
      description: description ?? null,
      sourceUrl: provenanceUrl,
      metadata: { contentHash, importedFrom: provenanceUrl },
    });

    return serializeAsset(asset);
  },
});
