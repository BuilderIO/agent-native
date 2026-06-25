/**
 * Binary decoder for Figma `.fig` files. Handles both modern fig-kiwi files
 * (a custom container of kiwi-schema chunks, optionally zstd/zlib compressed)
 * and the legacy zip-format archives. Returns the decoded document node tree,
 * extracted image blobs (SHA1-keyed, with magic-byte extensions), and a
 * best-effort thumbnail.
 *
 * Ported faithfully from the ai-services design-systems pipeline. It is a pure
 * function on a Buffer — no storage, queue, or job coupling.
 */

import * as crypto from "node:crypto";
import * as zlib from "node:zlib";

import { decompress as zstdDecompress } from "fzstd";
import {
  ByteBuffer,
  compileSchema,
  decodeBinarySchema,
  type Schema,
} from "kiwi-schema";
import * as pako from "pako";

const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB cap per chunk to prevent compression bombs
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const FIG_KIWI_MAGIC = Buffer.from("fig-kiwi", "utf8");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export interface DecodedFigKiwi {
  version: number;
  schema: Buffer;
  document: Buffer;
  blobs: Buffer[];
}

export interface DecodedFigImage {
  /** SHA1 of the blob bytes — matches what the document references. */
  hash: string;
  ext: string;
  bytes: Buffer;
}

export interface DecodedFig {
  format: "kiwi" | "zip";
  version?: number;
  document: unknown;
  images: DecodedFigImage[];
  thumbnail: Buffer | null;
}

function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function detectImageExt(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_MAGIC)) return "jpg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "GIF8") {
    return "gif";
  }
  return "bin";
}

function checkDecompressedSize(buf: Buffer): Buffer {
  if (buf.length > MAX_DECOMPRESSED_BYTES) {
    throw new Error(
      `Decompressed chunk exceeds size limit (${buf.length} > ${MAX_DECOMPRESSED_BYTES})`,
    );
  }
  return buf;
}

function decompressChunk(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC)) {
    try {
      return checkDecompressedSize(Buffer.from(zstdDecompress(buf)));
    } catch {
      /* fall through */
    }
  }
  try {
    return zlib.inflateRawSync(buf, {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
  } catch (e) {
    if (e instanceof RangeError) throw e; // output exceeded size cap; don't fall through
    /* fall through for format/data errors */
  }
  try {
    return zlib.inflateSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch (e) {
    if (e instanceof RangeError) throw e;
    /* fall through */
  }
  try {
    return checkDecompressedSize(Buffer.from(pako.inflateRaw(buf)));
  } catch {
    /* fall through */
  }
  try {
    return checkDecompressedSize(Buffer.from(pako.inflate(buf)));
  } catch {
    /* fall through */
  }
  return Buffer.from(buf);
}

export function decodeKiwiContainer(file: Buffer): DecodedFigKiwi {
  if (!file.subarray(0, 8).equals(FIG_KIWI_MAGIC)) {
    throw new Error("Not a fig-kiwi file (missing magic header)");
  }
  if (file.length < 12) {
    throw new Error(
      "Truncated kiwi header (file too short to contain version)",
    );
  }
  const version = file.readUInt32LE(8);
  let offset = 12;
  const chunks: Buffer[] = [];
  while (offset < file.length) {
    if (offset + 4 > file.length) {
      throw new Error(`Truncated chunk header at offset ${offset}`);
    }
    const length = file.readUInt32LE(offset);
    offset += 4;
    if (offset + length > file.length) {
      throw new Error(
        `Chunk extends past end of file (offset=${offset}, length=${length}, total=${file.length})`,
      );
    }
    const compressed = file.subarray(offset, offset + length);
    offset += length;
    chunks.push(decompressChunk(compressed));
  }
  if (chunks.length < 2) {
    throw new Error(
      `Expected at least 2 chunks (schema + document), got ${chunks.length}`,
    );
  }
  return {
    version,
    schema: chunks[0]!,
    document: chunks[1]!,
    blobs: chunks.slice(2),
  };
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Minimal zip reader: supports stored (method 0) and deflate (method 8)
 * entries, no encryption, no zip64. Sufficient for legacy `.fig` archives.
 */
function readZip(file: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  const maxScan = Math.min(file.length, 65557);
  let eocdOffset = -1;
  for (let i = file.length - 22; i >= file.length - maxScan && i >= 0; i--) {
    if (file.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Zip EOCD record not found");

  const totalEntries = file.readUInt16LE(eocdOffset + 10);
  const cdOffset = file.readUInt32LE(eocdOffset + 16);
  if (cdOffset > file.length) {
    throw new Error(`Central directory offset ${cdOffset} exceeds file length`);
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > file.length) {
      throw new Error(`Truncated central directory entry at offset ${p}`);
    }
    if (file.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`Bad central directory entry signature at ${p}`);
    }
    const compressionMethod = file.readUInt16LE(p + 10);
    const compressedSize = file.readUInt32LE(p + 20);
    const uncompressedSize = file.readUInt32LE(p + 24);
    const nameLen = file.readUInt16LE(p + 28);
    const extraLen = file.readUInt16LE(p + 30);
    const commentLen = file.readUInt16LE(p + 32);
    const localHeaderOffset = file.readUInt32LE(p + 42);
    const name = file.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    const lh = localHeaderOffset;
    if (lh + 30 > file.length) {
      throw new Error(`Local header offset ${lh} out of bounds`);
    }
    if (file.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error(`Bad local file header signature at ${lh}`);
    }
    const lhNameLen = file.readUInt16LE(lh + 26);
    const lhExtraLen = file.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + lhNameLen + lhExtraLen;
    if (dataStart + compressedSize > file.length) {
      throw new Error(`Compressed data for "${name}" extends past end of file`);
    }
    const compressed = file.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      data = zlib.inflateRawSync(compressed, {
        maxOutputLength: MAX_DECOMPRESSED_BYTES,
      });
    } else {
      throw new Error(
        `Unsupported zip compression method ${compressionMethod} for entry "${name}"`,
      );
    }
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new Error(
        `Size mismatch for "${name}": expected ${uncompressedSize}, got ${data.length}`,
      );
    }
    if (name.endsWith("/")) continue;
    entries.push({ name, data });
  }
  return entries;
}

function isZip(file: Buffer): boolean {
  return file.length >= 4 && file.subarray(0, 4).equals(ZIP_MAGIC);
}

// Recursively normalize a decoded kiwi document into plain, JSON-safe values.
// We walk the tree directly instead of `JSON.parse(JSON.stringify(...))`:
// real Figma files decode to hundreds of thousands of nodes, and serializing
// the whole tree to a single string blows V8's max-string-length limit
// (RangeError: Invalid string length). A direct walk has no such ceiling.
function normalizeDecoded(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const arr = new Array(value.length);
    for (let i = 0; i < value.length; i++) arr[i] = normalizeDecoded(value[i]);
    return arr;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = normalizeDecoded(v);
    }
    return out;
  }
  return value;
}

// Returns null on any decode failure so callers can still surface the raw
// document buffer.
function decodeKiwiDocument(
  schemaBuf: Buffer,
  documentBuf: Buffer,
): unknown | null {
  let schema: Schema;
  try {
    schema = decodeBinarySchema(schemaBuf);
  } catch {
    return null;
  }
  const rootMessage =
    schema.definitions.find((d) => d.name === "Message")?.name ??
    schema.definitions.find((d) => d.kind === "MESSAGE")?.name ??
    null;
  if (!rootMessage) return null;

  let compiled: Record<string, (bb: ByteBuffer) => unknown>;
  try {
    compiled = compileSchema(schema) as Record<
      string,
      (bb: ByteBuffer) => unknown
    >;
  } catch {
    return null;
  }
  const decodeKey = `decode${rootMessage}`;
  const decoder = compiled[decodeKey];
  if (typeof decoder !== "function") return null;

  try {
    const view = new Uint8Array(
      documentBuf.buffer,
      documentBuf.byteOffset,
      documentBuf.byteLength,
    );
    const bb = new ByteBuffer(view);
    const document = decoder.call(compiled, bb);
    return normalizeDecoded(document);
  } catch {
    return null;
  }
}

function collectImagesFromBlobs(blobs: Buffer[]): DecodedFigImage[] {
  const seen = new Map<string, DecodedFigImage>();
  for (const blob of blobs) {
    if (blob.length === 0) continue;
    const ext = detectImageExt(blob);
    if (ext === "bin") continue;
    const hash = sha1(blob);
    if (seen.has(hash)) continue;
    seen.set(hash, { hash, ext, bytes: blob });
  }
  return Array.from(seen.values());
}

function findThumbnail(documentBuf: Buffer, blobs: Buffer[]): Buffer | null {
  const pngBlobs = blobs
    .filter((b) => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC))
    .sort((a, b) => a.length - b.length);
  if (pngBlobs.length > 0) return pngBlobs[0]!;

  const idx = documentBuf.indexOf(PNG_MAGIC);
  if (idx >= 0) {
    const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const end = documentBuf.indexOf(iend, idx);
    if (end > idx) return documentBuf.subarray(idx, end + iend.length);
  }
  return null;
}

// Handles both modern fig-kiwi files and legacy zip-format archives.
// `document` is null if kiwi decoding failed.
export function decodeFig(file: Buffer): DecodedFig {
  if (isZip(file)) {
    const entries = readZip(file);
    const canvasEntry = entries.find((e) => e.name === "canvas.fig");
    const imageEntries = entries.filter((e) => e.name.startsWith("images/"));

    let document: unknown = null;
    let version: number | undefined;
    let extraBlobs: Buffer[] = [];
    if (canvasEntry) {
      try {
        const inner = decodeKiwiContainer(canvasEntry.data);
        version = inner.version;
        extraBlobs = inner.blobs;
        document = decodeKiwiDocument(inner.schema, inner.document);
      } catch {
        /* leave document null */
      }
    }

    const images: DecodedFigImage[] = [];
    const seen = new Set<string>();
    for (const e of imageEntries) {
      const ext = detectImageExt(e.data) || "bin";
      if (ext === "bin") continue;
      const hash = sha1(e.data);
      if (seen.has(hash)) continue;
      seen.add(hash);
      images.push({ hash, ext, bytes: e.data });
    }
    for (const img of collectImagesFromBlobs(extraBlobs)) {
      if (seen.has(img.hash)) continue;
      seen.add(img.hash);
      images.push(img);
    }

    const thumbnailEntry = entries.find((e) => e.name === "thumbnail.png");
    return {
      format: "zip",
      version,
      document,
      images,
      thumbnail: thumbnailEntry?.data ?? null,
    };
  }

  const decoded = decodeKiwiContainer(file);
  const document = decodeKiwiDocument(decoded.schema, decoded.document);
  const images = collectImagesFromBlobs(decoded.blobs);
  const thumbnail = findThumbnail(decoded.document, decoded.blobs);
  return {
    format: "kiwi",
    version: decoded.version,
    document,
    images,
    thumbnail,
  };
}

export function buildImageMap(images: DecodedFigImage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const img of images) {
    map.set(img.hash, `${img.hash}.${img.ext}`);
  }
  return map;
}
