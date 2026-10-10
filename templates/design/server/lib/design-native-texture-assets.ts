import { createHash } from "node:crypto";

import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { imageSize } from "image-size";

import { getDb, schema } from "../db/index.js";
import {
  NativeTextureProviderError,
  readDesignNativeTextureProvider,
} from "./design-native-texture-provider";
import { NativeExportAssetError } from "./native-export-assets";
import {
  NativeTextureSourceReferenceError,
  collectNativeTextureSourceReferences,
} from "./native-texture-source-references";

export const MAX_DESIGN_NATIVE_TEXTURE_BYTES = 1_000_000;
const PREFIX = "/api/design-native-texture/";
const MIME_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type DesignNativeTextureMime = keyof typeof MIME_EXTENSION;

export class DesignNativeTextureAssetError extends Error {
  constructor(
    readonly code:
      | "invalid-reference"
      | "not-found"
      | "forbidden"
      | "limit"
      | "unavailable"
      | "unreadable"
      | "mismatch"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "DesignNativeTextureAssetError";
  }
}

export function verifiedNativeTextureSourceReferences(
  fileType: string,
  content: string,
): string[] {
  try {
    return collectNativeTextureSourceReferences(fileType, content);
  } catch (error) {
    if (error instanceof NativeTextureSourceReferenceError)
      throw new DesignNativeTextureAssetError(error.code, error.message);
    if (error instanceof NativeExportAssetError)
      throw new DesignNativeTextureAssetError(error.code, error.message);
    throw error;
  }
}

export function designNativeTextureMime(
  value: string,
): DesignNativeTextureMime | null {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSION, value)
    ? (value as DesignNativeTextureMime)
    : null;
}

export function designNativeTexturePath(
  id: string,
  mimeType: DesignNativeTextureMime,
): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new DesignNativeTextureAssetError(
      "invalid-reference",
      "Native texture id is invalid.",
    );
  return `${PREFIX}${id}.${MIME_EXTENSION[mimeType]}`;
}

export function parseDesignNativeTexturePath(
  value: string,
): { id: string; mimeType: DesignNativeTextureMime } | null {
  const match =
    /^\/api\/design-native-texture\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(png|jpg|webp)$/.exec(
      value,
    );
  if (!match) return null;
  const mimeType = (
    Object.keys(MIME_EXTENSION) as DesignNativeTextureMime[]
  ).find((candidate) => MIME_EXTENSION[candidate] === match[2]);
  return mimeType ? { id: match[1]!, mimeType } : null;
}

export function validateDesignNativeTextureBytes(
  mimeType: DesignNativeTextureMime,
  bytes: Uint8Array,
): string {
  if (!bytes.byteLength || bytes.byteLength > MAX_DESIGN_NATIVE_TEXTURE_BYTES)
    throw new DesignNativeTextureAssetError(
      "limit",
      "Native texture exceeds its 1 MB upload limit.",
    );
  const png =
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR";
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  const webp =
    bytes.length >= 16 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (
    !(mimeType === "image/png" ? png : mimeType === "image/jpeg" ? jpeg : webp)
  )
    throw new DesignNativeTextureAssetError(
      "unsupported",
      "Native texture bytes do not match a supported raster image.",
    );
  let dimensions;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw new DesignNativeTextureAssetError(
      "unsupported",
      "Native texture raster cannot be decoded.",
    );
  }
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width * dimensions.height > 8_388_608
  )
    throw new DesignNativeTextureAssetError(
      "limit",
      "Native texture dimensions exceed the GPU input limit.",
    );
  return createHash("sha256").update(bytes).digest("hex");
}

type StoredNativeTexture = typeof schema.designNativeTextureAssets.$inferSelect;
type StoredSharedTexture =
  typeof schema.designNativeTextureObjects.$inferSelect;
export type BoundFile = {
  designId: string;
  fileId: string;
  fileType: string;
  content: string;
};
export type BoundCandidate = Pick<BoundFile, "designId" | "fileId">;
const MAX_BINDINGS_PER_OBJECT = 256;
const MAX_BOUND_SOURCE_BYTES = 4_000_000;
export interface DesignNativeTextureReadDependencies {
  lookupAsset(id: string): Promise<StoredNativeTexture | null>;
  lookupSharedObject?(id: string): Promise<StoredSharedTexture | null>;
  boundCandidates?(id: string, limit: number): Promise<BoundCandidate[]>;
  readMatchingBoundFile?(
    candidates: readonly BoundCandidate[],
    path: string,
  ): Promise<BoundFile | null>;
  canReadDesign(designId: string): Promise<boolean>;
  fileInDesign(fileId: string, designId: string): Promise<boolean>;
  readProvider(
    url: string,
    ownerEmail: string,
    maxBytes: number,
  ): ReturnType<typeof readDesignNativeTextureProvider>;
}

const productionDependencies: DesignNativeTextureReadDependencies = {
  async lookupSharedObject(id) {
    const [asset] = await getDb()
      .select()
      .from(schema.designNativeTextureObjects)
      .where(eq(schema.designNativeTextureObjects.id, id))
      .limit(1);
    return asset ?? null;
  },
  async boundCandidates(id, limit) {
    return getDb()
      .select({
        designId: schema.designNativeTextureBindings.designId,
        fileId: schema.designNativeTextureBindings.fileId,
      })
      .from(schema.designNativeTextureBindings)
      .where(eq(schema.designNativeTextureBindings.assetId, id))
      .limit(limit);
  },
  readMatchingBoundFile(candidates, path) {
    return findReadableNativeTextureBoundFile(candidates, path);
  },
  async lookupAsset(id) {
    const [asset] = await getDb()
      .select()
      .from(schema.designNativeTextureAssets)
      .where(eq(schema.designNativeTextureAssets.id, id))
      .limit(1);
    return asset ?? null;
  },
  async canReadDesign(designId) {
    return Boolean(await resolveAccess("design", designId));
  },
  async fileInDesign(fileId, designId) {
    const [file] = await getDb()
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, fileId),
          eq(schema.designFiles.designId, designId),
        ),
      )
      .limit(1);
    return Boolean(file);
  },
  readProvider(url, ownerEmail, maxBytes) {
    return readDesignNativeTextureProvider(url, ownerEmail, maxBytes);
  },
};

export async function findReadableNativeTextureBoundFile(
  candidates: readonly BoundCandidate[],
  path: string,
): Promise<BoundFile | null> {
  if (!candidates.length) return null;
  if (candidates.length > MAX_BINDINGS_PER_OBJECT)
    throw new DesignNativeTextureAssetError(
      "limit",
      "Native texture has too many bound files.",
    );
  const db = getDb();
  const designIds = [...new Set(candidates.map((item) => item.designId))];
  const readableDesigns = await db
    .select({ id: schema.designs.id })
    .from(schema.designs)
    .where(
      and(
        inArray(schema.designs.id, designIds),
        accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
          includePublic: true,
        }),
      ),
    )
    .limit(designIds.length);
  const readableIds = new Set(readableDesigns.map((row) => row.id));
  const allowed = candidates.filter((item) => readableIds.has(item.designId));
  if (!allowed.length) return null;
  const allowedPairs = or(
    ...allowed.map((item) =>
      and(
        eq(schema.designFiles.id, item.fileId),
        eq(schema.designFiles.designId, item.designId),
      ),
    ),
  );
  const matchedFiles = await db
    .select({
      designId: schema.designFiles.designId,
      fileId: schema.designFiles.id,
      byteLength: sql<number>`octet_length(${schema.designFiles.content})`,
    })
    .from(schema.designFiles)
    .where(and(allowedPairs, like(schema.designFiles.content, `%${path}%`)))
    .orderBy(schema.designFiles.id)
    .limit(allowed.length);
  let remainingBytes = MAX_BOUND_SOURCE_BYTES;
  let candidateFailure: DesignNativeTextureAssetError | null = null;
  for (const matched of matchedFiles) {
    if (
      !allowed.some(
        (item) =>
          item.fileId === matched.fileId && item.designId === matched.designId,
      )
    )
      throw new DesignNativeTextureAssetError(
        "forbidden",
        "Native texture source binding changed during access check.",
      );
    if (
      !Number.isSafeInteger(matched.byteLength) ||
      matched.byteLength < 0 ||
      matched.byteLength > remainingBytes
    ) {
      candidateFailure = new DesignNativeTextureAssetError(
        "limit",
        "Native texture source exceeds the aggregate parser-read budget.",
      );
      continue;
    }
    const [file] = await db
      .select({
        designId: schema.designFiles.designId,
        fileId: schema.designFiles.id,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, matched.fileId),
          eq(schema.designFiles.designId, matched.designId),
          like(schema.designFiles.content, `%${path}%`),
          sql`octet_length(${schema.designFiles.content}) <= ${remainingBytes}`,
        ),
      )
      .limit(1);
    if (!file) {
      candidateFailure ??= new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture source changed during the bounded read.",
      );
      continue;
    }
    const actualBytes = Buffer.byteLength(file.content, "utf8");
    if (actualBytes > remainingBytes)
      throw new DesignNativeTextureAssetError(
        "limit",
        "Native texture source exceeded the aggregate parser-read budget.",
      );
    remainingBytes -= actualBytes;
    if (actualBytes !== matched.byteLength) {
      candidateFailure ??= new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture source changed during the bounded read.",
      );
      continue;
    }
    try {
      if (
        verifiedNativeTextureSourceReferences(
          file.fileType,
          file.content,
        ).includes(path)
      )
        return file;
    } catch (error) {
      if (!(error instanceof DesignNativeTextureAssetError)) throw error;
      candidateFailure ??= error;
    }
  }
  if (candidateFailure) throw candidateFailure;
  return null;
}

export async function readDesignNativeTextureAsset(
  path: string,
  maxBytes: number,
  dependencies: DesignNativeTextureReadDependencies = productionDependencies,
): Promise<{ mimeType: DesignNativeTextureMime; bytes: Uint8Array }> {
  const parsed = parseDesignNativeTexturePath(path);
  if (!parsed)
    throw new DesignNativeTextureAssetError(
      "invalid-reference",
      "Native texture reference is malformed.",
    );
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_DESIGN_NATIVE_TEXTURE_BYTES
  )
    throw new DesignNativeTextureAssetError(
      "limit",
      "Native texture read limit is invalid.",
    );
  const shared = await dependencies.lookupSharedObject?.(parsed.id);
  if (shared) {
    if (shared.mimeType !== parsed.mimeType)
      throw new DesignNativeTextureAssetError(
        "invalid-reference",
        "Native texture extension does not match its stored type.",
      );
    if (!dependencies.boundCandidates || !dependencies.readMatchingBoundFile)
      throw new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture bindings cannot be verified.",
      );
    const bound = await dependencies.boundCandidates(
      parsed.id,
      MAX_BINDINGS_PER_OBJECT + 1,
    );
    if (bound.length > MAX_BINDINGS_PER_OBJECT)
      throw new DesignNativeTextureAssetError(
        "limit",
        "Native texture binding lookup exceeds its bounded limit.",
      );
    const readable = await dependencies.readMatchingBoundFile(bound, path);
    if (
      !readable ||
      !verifiedNativeTextureSourceReferences(
        readable.fileType,
        readable.content,
      ).includes(path)
    )
      throw new DesignNativeTextureAssetError(
        "forbidden",
        "Native texture has no readable live source binding.",
      );
    if (shared.byteLength > maxBytes)
      throw new DesignNativeTextureAssetError(
        "limit",
        "Native texture exceeds this operation's byte limit.",
      );
    return readAndVerifyNativeTexture(
      shared,
      parsed.mimeType,
      maxBytes,
      dependencies,
    );
  }
  const asset = await dependencies.lookupAsset(parsed.id);
  if (!asset)
    throw new DesignNativeTextureAssetError(
      "not-found",
      "Native texture asset is unavailable.",
    );
  if (asset.mimeType !== parsed.mimeType)
    throw new DesignNativeTextureAssetError(
      "invalid-reference",
      "Native texture extension does not match its stored type.",
    );
  if (!(await dependencies.canReadDesign(asset.designId)))
    throw new DesignNativeTextureAssetError(
      "forbidden",
      "Native texture access is unavailable.",
    );
  if (!(await dependencies.fileInDesign(asset.fileId, asset.designId)))
    throw new DesignNativeTextureAssetError(
      "not-found",
      "Native texture's Design file is unavailable.",
    );
  if (asset.byteLength > maxBytes)
    throw new DesignNativeTextureAssetError(
      "limit",
      "Native texture exceeds this operation's byte limit.",
    );
  return readAndVerifyNativeTexture(
    asset,
    parsed.mimeType,
    maxBytes,
    dependencies,
  );
}

async function readAndVerifyNativeTexture(
  asset: Pick<
    StoredNativeTexture,
    "providerUrl" | "uploaderEmail" | "mimeType" | "byteLength" | "sha256"
  >,
  expectedMimeType: DesignNativeTextureMime,
  maxBytes: number,
  dependencies: DesignNativeTextureReadDependencies,
): Promise<{ mimeType: DesignNativeTextureMime; bytes: Uint8Array }> {
  let uploaded;
  try {
    uploaded = await dependencies.readProvider(
      asset.providerUrl,
      asset.uploaderEmail,
      maxBytes,
    );
  } catch (error) {
    if (!(error instanceof NativeTextureProviderError)) throw error;
    throw new DesignNativeTextureAssetError(error.code, error.message);
  }
  if (
    uploaded.mimeType !== expectedMimeType ||
    uploaded.data.byteLength !== asset.byteLength ||
    validateDesignNativeTextureBytes(
      asset.mimeType as DesignNativeTextureMime,
      uploaded.data,
    ) !== asset.sha256
  )
    throw new DesignNativeTextureAssetError(
      "mismatch",
      "Uploaded texture bytes changed after registration.",
    );
  return {
    mimeType: expectedMimeType,
    bytes: uploaded.data,
  };
}
