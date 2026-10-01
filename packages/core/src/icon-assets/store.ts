import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { createGetDb } from "../db/create-get-db.js";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "../private-blob/index.js";
import { iconAssets } from "./schema.js";
import { sanitizeIconSvg } from "./svg.js";

export const MAX_ICON_ASSET_BYTES = 5 * 1024 * 1024;
const getDb = createGetDb({ iconAssets });

export interface IconAssetScope {
  ownerEmail: string;
  orgId?: string | null;
}

export interface IconAsset {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  mimeType: string;
  filename: string | null;
  alt: string | null;
  size: number;
  sha256: string;
  createdAt: number;
  updatedAt: number;
}

export interface IconAssetRead {
  asset: IconAsset;
  data: Uint8Array;
  mimeType: string;
}

type IconAssetRow = typeof iconAssets.$inferSelect;

function checkedScope(scope: IconAssetScope): IconAssetScope {
  const ownerEmail = scope.ownerEmail?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("Icon asset owner is required");
  if (
    scope.orgId !== undefined &&
    scope.orgId !== null &&
    !scope.orgId.trim()
  ) {
    throw new Error("Icon asset organization is invalid");
  }
  return { ownerEmail, orgId: scope.orgId ?? null };
}

function orgCondition(orgId: string | null | undefined) {
  return orgId ? eq(iconAssets.orgId, orgId) : isNull(iconAssets.orgId);
}

function metadata(row: IconAssetRow): IconAsset {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    mimeType: row.mimeType,
    filename: row.filename,
    alt: row.alt,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detectMime(
  data: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    data.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => data[index] === byte,
    )
  )
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}

function validatedBytes(data: Uint8Array, mimeType: string): Uint8Array {
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength === 0 ||
    data.byteLength > MAX_ICON_ASSET_BYTES
  ) {
    throw new Error("Icon image must be between 1 byte and 5 MiB");
  }
  if (mimeType === "image/svg+xml") {
    const safe = sanitizeIconSvg(data);
    if (safe.byteLength > MAX_ICON_ASSET_BYTES)
      throw new Error("SVG icon exceeds 5 MiB");
    return safe;
  }
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(mimeType) ||
    detectMime(data) !== mimeType
  ) {
    throw new Error(
      "Icon image type does not match PNG, JPEG, or WebP content",
    );
  }
  return data;
}

function parseHandle(row: IconAssetRow): PrivateBlobHandle {
  const handle = JSON.parse(row.blobHandleJson) as PrivateBlobHandle;
  if (
    !handle ||
    typeof handle.id !== "string" ||
    typeof handle.provider !== "string" ||
    handle.opaque !== true
  ) {
    throw new Error("Icon asset has an invalid private blob handle");
  }
  return handle;
}

async function readRow(row: IconAssetRow): Promise<IconAssetRead> {
  const read = await readPrivateBlob(parseHandle(row));
  const hash = createHash("sha256").update(read.data).digest("hex");
  if (hash !== row.sha256 || read.data.byteLength !== row.size) {
    throw new Error("Icon asset private blob failed integrity verification");
  }
  return { asset: metadata(row), data: read.data, mimeType: row.mimeType };
}

/** Uploads validated bytes and persists only the opaque private blob handle. */
export async function putIconAsset(
  input: IconAssetScope & {
    data: Uint8Array;
    mimeType: string;
    filename?: string;
    alt?: string;
  },
): Promise<IconAsset> {
  const scope = checkedScope(input);
  const data = validatedBytes(input.data, input.mimeType);
  const id = randomUUID();
  const filename = input.filename?.trim().slice(0, 255) || null;
  const alt = input.alt?.trim().slice(0, 500) || null;
  const handle = await putPrivateBlob({
    data,
    filename: `icon-${id}`,
    mimeType: input.mimeType,
    ownerEmail: scope.ownerEmail,
  });
  if (!handle)
    throw new Error(
      "Private icon storage is unavailable; configure a private blob provider",
    );

  try {
    const read = await readPrivateBlob(handle);
    if (!Buffer.from(read.data).equals(Buffer.from(data))) {
      throw new Error(
        "Private icon storage read-back did not match uploaded bytes",
      );
    }
    const now = Date.now();
    const row: typeof iconAssets.$inferInsert = {
      id,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId ?? null,
      mimeType: input.mimeType,
      filename,
      alt,
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      blobHandleJson: JSON.stringify(handle),
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(iconAssets).values(row);
    return metadata(row as IconAssetRow);
  } catch (error) {
    try {
      const deletion = await deletePrivateBlob(handle);
      if (!deletion.deleted)
        throw new Error(deletion.reason ?? "blob provider refused deletion");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Private icon upload failed and blob cleanup failed",
      );
    }
    throw error;
  }
}

export async function getIconAsset(
  id: string,
  caller: IconAssetScope,
): Promise<IconAsset | null> {
  const scope = checkedScope(caller);
  const [row] = await getDb()
    .select()
    .from(iconAssets)
    .where(
      and(
        eq(iconAssets.id, id),
        eq(iconAssets.ownerEmail, scope.ownerEmail),
        orgCondition(scope.orgId),
      ),
    )
    .limit(1);
  return row ? metadata(row) : null;
}

export async function readIconAsset(
  id: string,
  caller: IconAssetScope,
): Promise<IconAssetRead | null> {
  const scope = checkedScope(caller);
  const [row] = await getDb()
    .select()
    .from(iconAssets)
    .where(
      and(
        eq(iconAssets.id, id),
        eq(iconAssets.ownerEmail, scope.ownerEmail),
        orgCondition(scope.orgId),
      ),
    )
    .limit(1);
  return row ? readRow(row) : null;
}

/** Only call after proving the caller may read a live resource referencing this ID. */
export async function readIconAssetForAuthorizedReference(
  id: string,
  scope: { orgId?: string | null },
): Promise<IconAssetRead | null> {
  const [row] = await getDb()
    .select()
    .from(iconAssets)
    .where(and(eq(iconAssets.id, id), orgCondition(scope.orgId)))
    .limit(1);
  return row ? readRow(row) : null;
}

export async function listIconAssets(
  input: IconAssetScope & { limit?: number },
): Promise<IconAsset[]> {
  const scope = checkedScope(input);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Icon asset limit must be between 1 and 100");
  const rows = await getDb()
    .select({
      id: iconAssets.id,
      ownerEmail: iconAssets.ownerEmail,
      orgId: iconAssets.orgId,
      mimeType: iconAssets.mimeType,
      filename: iconAssets.filename,
      alt: iconAssets.alt,
      size: iconAssets.size,
      sha256: iconAssets.sha256,
      createdAt: iconAssets.createdAt,
      updatedAt: iconAssets.updatedAt,
    })
    .from(iconAssets)
    .where(
      and(
        eq(iconAssets.ownerEmail, scope.ownerEmail),
        orgCondition(scope.orgId),
      ),
    )
    .orderBy(desc(iconAssets.createdAt))
    .limit(limit);
  return rows;
}
