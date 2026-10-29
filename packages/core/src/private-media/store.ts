/**
 * Private media: files uploaded into a private resource (an image pasted into
 * a Content page, for example) that must have the same access as that
 * resource.
 *
 * The bytes go to the private-blob store, so they never get a public URL.
 * This table keeps only metadata and the opaque blob handle. It does not
 * decide who may read a file: the app that owns the resource proves access
 * (its own reference table plus `resolveAccess`) and only then calls
 * `openPrivateMediaForAuthorizedReader`. The uploader may always read their
 * own uploads, which is how an image renders before its page is saved.
 */
import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { createGetDb } from "../db/create-get-db.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import {
  deletePrivateBlob,
  getPrivateBlobReadUrl,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "../private-blob/index.js";
import { privateMedia } from "./schema.js";

/**
 * Large enough for full-screen screenshots, small enough that a proxied read
 * stays well under the serverless response limit when storage can't hand out
 * a direct link.
 */
export const MAX_PRIVATE_MEDIA_BYTES = 10 * 1024 * 1024;

export const PRIVATE_MEDIA_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;

export type PrivateMediaImageType = (typeof PRIVATE_MEDIA_IMAGE_TYPES)[number];

/**
 * Sent with every SVG response. `sandbox` stops scripts if someone opens the
 * file directly; `<img>` never runs them anyway.
 */
export const PRIVATE_MEDIA_SVG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox";

const MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const privateMediaStore = defineStore({
  id: "private_media",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        await ensureTableExists(
          "private_media",
          `CREATE TABLE IF NOT EXISTS private_media (
            id TEXT PRIMARY KEY,
            owner_email TEXT NOT NULL,
            org_id TEXT,
            mime_type TEXT NOT NULL,
            filename TEXT,
            size BIGINT NOT NULL,
            sha256 TEXT NOT NULL,
            blob_handle_json TEXT NOT NULL,
            created_at BIGINT NOT NULL
          )`,
        );
        await ensureIndexExists(
          "private_media_owner_org_created_idx",
          `CREATE INDEX IF NOT EXISTS private_media_owner_org_created_idx
            ON private_media (owner_email, org_id, created_at)`,
        );
      },
    },
  ],
});

const getDb = createGetDb({ privateMedia });

export interface PrivateMedia {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  mimeType: PrivateMediaImageType;
  filename: string | null;
  size: number;
  createdAt: number;
}

export type PrivateMediaOpenResult =
  | { kind: "redirect"; media: PrivateMedia; url: string }
  | { kind: "bytes"; media: PrivateMedia; data: Uint8Array };

/** Raised when no private storage can take the bytes. */
export class PrivateMediaStorageUnavailableError extends Error {
  constructor() {
    super(
      "No private storage is connected. Connect Builder.io or add S3-compatible storage in Settings → File uploads.",
    );
    this.name = "PrivateMediaStorageUnavailableError";
  }
}

/** Raised for files this store refuses: wrong type, empty or too large. */
export class PrivateMediaValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 413 | 415,
  ) {
    super(message);
    this.name = "PrivateMediaValidationError";
  }
}

type PrivateMediaRow = typeof privateMedia.$inferSelect;

export function isPrivateMediaId(id: unknown): id is string {
  return typeof id === "string" && MEDIA_ID.test(id);
}

export function isPrivateMediaImageType(
  mimeType: unknown,
): mimeType is PrivateMediaImageType {
  return (
    typeof mimeType === "string" &&
    (PRIVATE_MEDIA_IMAGE_TYPES as readonly string[]).includes(mimeType)
  );
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Private media owner is required");
  return normalized;
}

function metadata(row: PrivateMediaRow): PrivateMedia {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    mimeType: row.mimeType as PrivateMediaImageType,
    filename: row.filename,
    size: row.size,
    createdAt: row.createdAt,
  };
}

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  return (
    data.length >= offset + bytes.length &&
    bytes.every((byte, index) => data[offset + index] === byte)
  );
}

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("latin1");
}

function isSvgDocument(data: Uint8Array): boolean {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(data);
    // coercion-ok: bytes that aren't valid UTF-8 aren't an SVG document, which is the answer.
  } catch {
    return false;
  }
  if (XMLValidator.validate(source) !== true) return false;
  const nodes = new XMLParser({
    ignoreAttributes: true,
    preserveOrder: true,
    processEntities: false,
  }).parse(source) as Array<Record<string, unknown>>;
  const elements = nodes.filter(
    (node) =>
      !Object.keys(node).some(
        (key) => key.startsWith("?") || key === "#comment",
      ),
  );
  const root = elements.length === 1 ? elements.at(0) : undefined;
  return root !== undefined && Object.hasOwn(root, "svg");
}

/** An `ftyp` box is a few dozen bytes; this bounds a corrupt one's size field. */
const MAX_FTYP_BYTES = 4096;

/**
 * Whether the file's leading `ftyp` box, which AVIF, HEIC and HEIF files open
 * with, names one of `wanted` as its major or a compatible brand.
 */
function hasBrand(data: Uint8Array, wanted: readonly string[]): boolean {
  if (data.length < 16 || ascii(data, 4, 8) !== "ftyp") return false;
  const boxSize = new DataView(data.buffer, data.byteOffset).getUint32(0);
  const end = Math.min(boxSize, data.length, MAX_FTYP_BYTES);
  const brands = [ascii(data, 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(data, offset, offset + 4));
  }
  return brands.some((brand) => wanted.includes(brand));
}

/** The image type the bytes actually are, which must match the declared one. */
function sniffImageType(
  data: Uint8Array,
  declared: PrivateMediaImageType,
): boolean {
  switch (declared) {
    case "image/png":
      return startsWith(data, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return ascii(data, 0, 6) === "GIF87a" || ascii(data, 0, 6) === "GIF89a";
    case "image/webp":
      return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
    case "image/svg+xml":
      return isSvgDocument(data);
    case "image/avif":
      return hasBrand(data, ["avif", "avis"]);
    case "image/heic":
      return hasBrand(data, ["heic", "heix", "heim", "heis", "hevc", "hevx"]);
    case "image/heif":
      return hasBrand(data, ["mif1", "msf1", "heic", "heix"]);
    case "image/bmp":
      return ascii(data, 0, 2) === "BM";
    case "image/tiff":
      return (
        startsWith(data, [0x49, 0x49, 0x2a, 0x00]) ||
        startsWith(data, [0x4d, 0x4d, 0x00, 0x2a])
      );
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return startsWith(data, [0x00, 0x00, 0x01, 0x00]);
  }
}

export function validatePrivateMediaImage(
  data: Uint8Array,
  mimeType: string,
): PrivateMediaImageType {
  const declared = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isPrivateMediaImageType(declared)) {
    throw new PrivateMediaValidationError(
      "Only PNG, JPEG, GIF, WebP, SVG, AVIF, HEIC, BMP, TIFF and ICO images can be uploaded.",
      415,
    );
  }
  if (data.byteLength === 0) {
    throw new PrivateMediaValidationError("The image is empty.", 400);
  }
  if (data.byteLength > MAX_PRIVATE_MEDIA_BYTES) {
    throw new PrivateMediaValidationError(
      `Images can be up to ${MAX_PRIVATE_MEDIA_BYTES / 1024 / 1024} MB.`,
      413,
    );
  }
  if (!sniffImageType(data, declared)) {
    throw new PrivateMediaValidationError(
      "The file's contents don't match its image type.",
      415,
    );
  }
  return declared;
}

function isPrivateBlobHandle(value: unknown): value is PrivateBlobHandle {
  if (typeof value !== "object" || value === null) return false;
  const handle = value as Record<string, unknown>;
  return (
    typeof handle.id === "string" &&
    typeof handle.provider === "string" &&
    handle.opaque === true
  );
}

function parseHandle(row: PrivateMediaRow): PrivateBlobHandle {
  const handle: unknown = JSON.parse(row.blobHandleJson);
  if (!isPrivateBlobHandle(handle)) {
    throw new Error("Private media has an invalid private blob handle");
  }
  return handle;
}

async function findRow(id: string): Promise<PrivateMediaRow | null> {
  if (!isPrivateMediaId(id)) return null;
  await privateMediaStore.ready();
  const rows = await getDb()
    .select()
    .from(privateMedia)
    .where(eq(privateMedia.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Validates an image and stores it privately. The caller has already checked
 * that the uploader may edit the resource it goes into.
 */
export async function putPrivateMedia(input: {
  ownerEmail: string;
  orgId?: string | null;
  data: Uint8Array;
  mimeType: string;
  filename?: string;
}): Promise<PrivateMedia> {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const mimeType = validatePrivateMediaImage(input.data, input.mimeType);
  await privateMediaStore.ready();
  const id = randomUUID();
  const handle = await putPrivateBlob({
    data: input.data,
    filename: `media-${id}`,
    mimeType,
    ownerEmail,
  });
  if (!handle) throw new PrivateMediaStorageUnavailableError();

  const row: typeof privateMedia.$inferInsert = {
    id,
    ownerEmail,
    orgId: input.orgId ?? null,
    mimeType,
    filename: input.filename?.trim().slice(0, 255) || null,
    size: input.data.byteLength,
    sha256: createHash("sha256").update(input.data).digest("hex"),
    blobHandleJson: JSON.stringify(handle),
    createdAt: Date.now(),
  };
  try {
    await getDb().insert(privateMedia).values(row);
  } catch (error) {
    try {
      const deletion = await deletePrivateBlob(handle);
      if (!deletion.deleted)
        throw new Error(deletion.reason ?? "blob provider refused deletion");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Private media upload failed and blob cleanup failed",
      );
    }
    throw error;
  }
  return metadata(row as PrivateMediaRow);
}

export async function getPrivateMedia(
  id: string,
): Promise<PrivateMedia | null> {
  const row = await findRow(id);
  return row ? metadata(row) : null;
}

/**
 * Removes an image and its stored bytes once the caller has decided nobody
 * needs it. The record goes last, so a failed blob deletion leaves the image
 * whole and the deletion can be retried. False when there was no such image.
 */
export async function deletePrivateMedia(id: string): Promise<boolean> {
  const row = await findRow(id);
  if (!row) return false;
  const deletion = await deletePrivateBlob(parseHandle(row));
  if (!deletion.deleted)
    throw new Error(deletion.reason ?? "blob provider refused deletion");
  await getDb().delete(privateMedia).where(eq(privateMedia.id, id));
  return true;
}

/** True when `ownerEmail` uploaded this file. */
export async function ownsPrivateMedia(
  id: string,
  ownerEmail: string | null | undefined,
): Promise<boolean> {
  if (!ownerEmail?.trim()) return false;
  const row = await findRow(id);
  return !!row && row.ownerEmail === normalizeEmail(ownerEmail);
}

/**
 * Opens a file for a reader the caller has already authorized. Storage that
 * can hand out a short-lived direct link answers with a redirect, so the
 * bytes skip the app server; otherwise the bytes are read, checked against
 * the upload's hash, and returned.
 *
 * A link keeps working until it expires, even if the reader loses access in
 * the meantime, so it lasts a minute by default: long enough for a browser to
 * follow the redirect, short enough that revoking access takes effect soon.
 */
export async function openPrivateMediaForAuthorizedReader(
  id: string,
  options: { redirectSeconds?: number } = {},
): Promise<PrivateMediaOpenResult | null> {
  const row = await findRow(id);
  if (!row) return null;
  const media = metadata(row);
  const handle = parseHandle(row);
  const link = await getPrivateBlobReadUrl(handle, {
    expiresInSeconds: options.redirectSeconds ?? 60,
    contentType: media.mimeType,
  });
  if (link) return { kind: "redirect", media, url: link.url };
  const read = await readPrivateBlob(handle);
  const hash = createHash("sha256").update(read.data).digest("hex");
  if (hash !== row.sha256 || read.data.byteLength !== row.size) {
    throw new Error("Private media failed integrity verification");
  }
  return { kind: "bytes", media, data: read.data };
}
