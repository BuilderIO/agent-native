import * as crypto from "node:crypto";
import * as zlib from "node:zlib";

import { Decompress as ZstdDecompress } from "fzstd";
import {
  ByteBuffer,
  compileSchemaJS,
  decodeBinarySchema,
  type Schema,
} from "kiwi-schema";

import {
  MAX_FIG_DECOMPRESSED_BYTES,
  MAX_FIG_FILE_BYTES,
} from "./fig-file-limits.js";

/** Route and decoder caps are intentionally conservative: `.fig` is untrusted input. */
const MAX_DECOMPRESSED_CHUNK_BYTES = 48 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;
const MAX_KIWI_CHUNKS = 4_096;
const MAX_ZIP_ENTRIES = 2_048;
const MAX_ZIP_NAME_BYTES = 512;
const MAX_COMPRESSION_RATIO = 1_000;
const MAX_DECODED_OBJECTS = 250_000;
const MAX_DECODE_DEPTH = 256;
const MAX_COLLECTION_LENGTH = 250_000;
const MAX_COLLECTION_ITEMS = 1_000_000;
const MAX_DECODE_READS = 64 * 1024 * 1024;
const MAX_SANITIZED_BINARY_BYTES = 32 * 1024 * 1024;
const MAX_DECODED_STRING_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_STRING_BYTES = 32 * 1024 * 1024;
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
  if (buf.length > MAX_DECOMPRESSED_CHUNK_BYTES) {
    throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
  }
  return buf;
}

/**
 * Reject Zstandard frames that advertise a window or content size above our
 * cap before the decoder allocates that window. The Figma container uses a
 * single standard Zstd frame per chunk.
 */
function assertSafeZstdFrameHeader(buf: Buffer): void {
  if (buf.length < 6) throw new Error("Truncated Zstandard .fig chunk.");
  const descriptor = buf[4]!;
  if ((descriptor & 0x08) !== 0) {
    throw new Error("Invalid reserved bit in Zstandard .fig chunk.");
  }
  const singleSegment = (descriptor & 0x20) !== 0;
  const contentSizeFlag = descriptor >>> 6;
  const dictionaryIdFlag = descriptor & 0x03;
  let offset = 5;
  let windowSize: number | undefined;
  if (!singleSegment) {
    const windowDescriptor = buf[offset++];
    if (windowDescriptor === undefined) {
      throw new Error("Truncated Zstandard window descriptor.");
    }
    const exponent = windowDescriptor >>> 3;
    const mantissa = windowDescriptor & 0x07;
    const windowBase = 2 ** (10 + exponent);
    windowSize = windowBase + (windowBase / 8) * mantissa;
  }
  const dictionaryIdBytes = [0, 1, 2, 4][dictionaryIdFlag]!;
  offset += dictionaryIdBytes;
  const contentSizeBytes =
    contentSizeFlag === 0
      ? singleSegment
        ? 1
        : 0
      : contentSizeFlag === 1
        ? 2
        : contentSizeFlag === 2
          ? 4
          : 8;
  if (offset + contentSizeBytes > buf.length) {
    throw new Error("Truncated Zstandard frame header.");
  }
  let contentSize: number | undefined;
  if (contentSizeBytes > 0) {
    let value = 0n;
    for (let index = 0; index < contentSizeBytes; index += 1) {
      value |= BigInt(buf[offset + index]!) << BigInt(index * 8);
    }
    if (contentSizeBytes === 2) value += 256n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Zstandard .fig chunk declares an unsafe size.");
    }
    contentSize = Number(value);
  }
  const declaredSize = contentSize ?? windowSize;
  if (
    declaredSize !== undefined &&
    declaredSize > MAX_DECOMPRESSED_CHUNK_BYTES
  ) {
    throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
  }
}

function decompressZstdChunk(buf: Buffer): Buffer {
  assertSafeZstdFrameHeader(buf);
  const parts: Buffer[] = [];
  let total = 0;
  const decoder = new ZstdDecompress((part) => {
    total += part.byteLength;
    if (total > MAX_DECOMPRESSED_CHUNK_BYTES) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    parts.push(Buffer.from(part));
  });
  decoder.push(buf, true);
  return Buffer.concat(parts, total);
}

function decompressChunk(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC)) {
    return decompressZstdChunk(buf);
  }
  try {
    return zlib.inflateRawSync(buf, {
      maxOutputLength: MAX_DECOMPRESSED_CHUNK_BYTES,
    });
  } catch (e) {
    if (e instanceof RangeError || /too large|max output/i.test(String(e))) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    /* fall through for format/data errors */
  }
  try {
    return zlib.inflateSync(buf, {
      maxOutputLength: MAX_DECOMPRESSED_CHUNK_BYTES,
    });
  } catch (e) {
    if (e instanceof RangeError || /too large|max output/i.test(String(e))) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    /* fall through */
  }
  return checkDecompressedSize(Buffer.from(buf));
}

export function decodeKiwiContainer(file: Buffer): DecodedFigKiwi {
  if (file.length > MAX_FIG_FILE_BYTES) {
    throw new Error(".fig file is too large (max 50 MB).");
  }
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
  let decompressedBytes = 0;
  while (offset < file.length) {
    if (chunks.length >= MAX_KIWI_CHUNKS) {
      throw new Error(".fig file has too many binary chunks.");
    }
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
    const decompressed = decompressChunk(compressed);
    decompressedBytes += decompressed.length;
    if (decompressedBytes > MAX_FIG_DECOMPRESSED_BYTES) {
      throw new Error("Decompressed .fig data is too large (max 96 MB).");
    }
    chunks.push(decompressed);
  }
  if (chunks.length < 2) {
    throw new Error(
      `Expected at least 2 chunks (schema + document), got ${chunks.length}`,
    );
  }
  if (chunks[0]!.length > MAX_SCHEMA_BYTES) {
    throw new Error(".fig schema is too large (max 4 MB).");
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

  if (eocdOffset + 22 > file.length) {
    throw new Error("Truncated zip EOCD record.");
  }
  const diskNumber = file.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = file.readUInt16LE(eocdOffset + 6);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error("Multi-disk .fig zip archives are not supported.");
  }
  const totalEntries = file.readUInt16LE(eocdOffset + 10);
  if (totalEntries === 0xffff || totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(".fig zip has too many entries (max 2048).");
  }
  const cdSize = file.readUInt32LE(eocdOffset + 12);
  const cdOffset = file.readUInt32LE(eocdOffset + 16);
  if (
    cdOffset === 0xffffffff ||
    cdSize === 0xffffffff ||
    cdOffset + cdSize > eocdOffset
  ) {
    throw new Error("Invalid or Zip64 .fig central directory.");
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  let totalUncompressedBytes = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > file.length) {
      throw new Error(`Truncated central directory entry at offset ${p}`);
    }
    if (file.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`Bad central directory entry signature at ${p}`);
    }
    const flags = file.readUInt16LE(p + 8);
    const compressionMethod = file.readUInt16LE(p + 10);
    const compressedSize = file.readUInt32LE(p + 20);
    const uncompressedSize = file.readUInt32LE(p + 24);
    const nameLen = file.readUInt16LE(p + 28);
    const extraLen = file.readUInt16LE(p + 30);
    const commentLen = file.readUInt16LE(p + 32);
    const localHeaderOffset = file.readUInt32LE(p + 42);
    if ((flags & 0x01) !== 0) {
      throw new Error("Encrypted .fig zip entries are not supported.");
    }
    if (nameLen > MAX_ZIP_NAME_BYTES) {
      throw new Error(".fig zip entry name is too long.");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("Zip64 .fig entries are not supported.");
    }
    if (p + 46 + nameLen + extraLen + commentLen > file.length) {
      throw new Error(`Truncated central directory entry at offset ${p}`);
    }
    const name = file.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (
      name.includes("\0") ||
      name.startsWith("/") ||
      name.startsWith("\\") ||
      /(^|[\\/])\.\.([\\/]|$)/.test(name)
    ) {
      throw new Error("Unsafe path in .fig zip entry.");
    }
    if (uncompressedSize > MAX_DECOMPRESSED_CHUNK_BYTES) {
      throw new Error("Decompressed .fig zip entry is too large (max 48 MB).");
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      (compressedSize === 0 ||
        uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw new Error("Suspicious .fig zip compression ratio.");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_FIG_DECOMPRESSED_BYTES) {
      throw new Error("Decompressed .fig data is too large (max 96 MB).");
    }

    const lh = localHeaderOffset;
    if (lh + 30 > file.length) {
      throw new Error(`Local header offset ${lh} out of bounds`);
    }
    if (file.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error(`Bad local file header signature at ${lh}`);
    }
    const localFlags = file.readUInt16LE(lh + 6);
    const localCompressionMethod = file.readUInt16LE(lh + 8);
    if (
      (localFlags & 0x01) !== 0 ||
      localCompressionMethod !== compressionMethod
    ) {
      throw new Error(`Inconsistent local header for "${name}".`);
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
      if (compressedSize !== uncompressedSize) {
        throw new Error(`Invalid stored size for "${name}".`);
      }
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      try {
        data = zlib.inflateRawSync(compressed, {
          maxOutputLength: MAX_DECOMPRESSED_CHUNK_BYTES,
        });
      } catch (error) {
        if (/buffer|length|output|large|max/i.test(String(error))) {
          throw new Error(
            "Decompressed .fig zip entry is too large (max 48 MB).",
          );
        }
        throw new Error(`Invalid compressed data for "${name}".`);
      }
    } else {
      throw new Error(
        `Unsupported zip compression method ${compressionMethod} for entry "${name}"`,
      );
    }
    if (data.length !== uncompressedSize) {
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

// Recursively convert non-JSON-serializable values (Uint8Array -> hex string,
// bigint -> string) without round-tripping through a single JSON string, which
// would throw "Invalid string length" for large documents (V8 caps strings at
// ~512MB).
interface ObjectBudget {
  objects: number;
  items: number;
  binaryBytes: number;
  stringBytes: number;
  active: WeakSet<object>;
}

function sanitizeForJson(
  value: unknown,
  budget: ObjectBudget,
  depth = 0,
): unknown {
  if (depth > MAX_DECODE_DEPTH) {
    throw new Error("Decoded .fig document is nested too deeply.");
  }
  if (value instanceof Uint8Array) {
    budget.binaryBytes += value.byteLength;
    if (budget.binaryBytes > MAX_SANITIZED_BINARY_BYTES) {
      throw new Error("Decoded .fig document contains too much binary data.");
    }
    return Buffer.from(value).toString("hex");
  }
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > MAX_DECODED_STRING_BYTES ||
      budget.stringBytes > MAX_TOTAL_STRING_BYTES
    ) {
      throw new Error("Decoded .fig document contains too much string data.");
    }
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    budget.objects += 1;
    budget.items += value.length;
    if (
      budget.objects > MAX_DECODED_OBJECTS ||
      value.length > MAX_COLLECTION_LENGTH ||
      budget.items > MAX_COLLECTION_ITEMS
    ) {
      throw new Error("Decoded .fig document exceeds collection limits.");
    }
    if (budget.active.has(value)) {
      throw new Error("Decoded .fig document contains a cycle.");
    }
    budget.active.add(value);
    try {
      return value.map((item) => sanitizeForJson(item, budget, depth + 1));
    } finally {
      budget.active.delete(value);
    }
  }
  if (value !== null && typeof value === "object") {
    budget.objects += 1;
    if (budget.objects > MAX_DECODED_OBJECTS) {
      throw new Error("Decoded .fig document contains too many objects.");
    }
    if (budget.active.has(value)) {
      throw new Error("Decoded .fig document contains a cycle.");
    }
    budget.active.add(value);
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value);
    budget.items += entries.length;
    if (budget.items > MAX_COLLECTION_ITEMS) {
      throw new Error("Decoded .fig document has too many object fields.");
    }
    try {
      for (const [k, v] of entries) {
        out[k] = sanitizeForJson(v, budget, depth + 1);
      }
    } finally {
      budget.active.delete(value);
    }
    return out;
  }
  return value;
}

/** Re-check decoded/direct-test documents before renderer traversal. */
export function assertSafeDecodedFigDocument(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let objects = 0;
  let items = 0;
  let binaryBytes = 0;
  let stringBytes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_DECODE_DEPTH) {
      throw new Error("Decoded .fig document is nested too deeply.");
    }
    if (current.value instanceof Uint8Array) {
      binaryBytes += current.value.byteLength;
      if (binaryBytes > MAX_SANITIZED_BINARY_BYTES) {
        throw new Error("Decoded .fig document contains too much binary data.");
      }
      continue;
    }
    if (typeof current.value === "string") {
      const bytes = Buffer.byteLength(current.value, "utf8");
      stringBytes += bytes;
      if (
        bytes > MAX_DECODED_STRING_BYTES ||
        stringBytes > MAX_TOTAL_STRING_BYTES
      ) {
        throw new Error("Decoded .fig document contains too much string data.");
      }
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) {
      throw new Error("Decoded .fig document contains repeated object cycles.");
    }
    seen.add(current.value);
    objects += 1;
    if (objects > MAX_DECODED_OBJECTS) {
      throw new Error("Decoded .fig document contains too many objects.");
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    if (children.length > MAX_COLLECTION_LENGTH) {
      throw new Error(
        "Decoded .fig document contains an oversized collection.",
      );
    }
    items += children.length;
    if (items > MAX_COLLECTION_ITEMS) {
      throw new Error("Decoded .fig document exceeds collection limits.");
    }
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

class BudgetByteBuffer extends ByteBuffer {
  private collectionItems = 0;
  private decodedObjects = 0;
  private decodeDepth = 0;
  private readCount = 0;

  override readByte(): number {
    this.readCount += 1;
    if (this.readCount > MAX_DECODE_READS) {
      throw new Error(".fig document exceeded its decode work budget.");
    }
    return super.readByte();
  }

  readCollectionLength(): number {
    const length = super.readVarUint();
    this.collectionItems += length;
    if (
      length > MAX_COLLECTION_LENGTH ||
      this.collectionItems > MAX_COLLECTION_ITEMS
    ) {
      throw new Error(".fig document declares an oversized collection.");
    }
    return length;
  }

  enterDecodedObject(): void {
    this.decodedObjects += 1;
    this.decodeDepth += 1;
    if (this.decodedObjects > MAX_DECODED_OBJECTS) {
      throw new Error(".fig document contains too many decoded objects.");
    }
    if (this.decodeDepth > MAX_DECODE_DEPTH) {
      throw new Error(".fig document is nested too deeply.");
    }
  }

  leaveDecodedObject(): void {
    this.decodeDepth -= 1;
  }
}

type CompiledDecoder = Record<string, unknown> & {
  ByteBuffer: typeof BudgetByteBuffer;
};

function compileBudgetedSchema(schema: Schema): CompiledDecoder {
  const generated = compileSchemaJS(schema);
  const collectionRead = "var length = bb.readVarUint();";
  const budgetedCollectionRead = "var length = bb.readCollectionLength();";
  const patched = generated.split(collectionRead).join(budgetedCollectionRead);
  const compiled: CompiledDecoder = { ByteBuffer: BudgetByteBuffer };
  new Function("exports", patched)(compiled);

  for (const key of Object.keys(compiled)) {
    if (!key.startsWith("decode")) continue;
    const original = compiled[key];
    if (typeof original !== "function") continue;
    compiled[key] = function budgetedDecode(
      this: CompiledDecoder,
      bb: BudgetByteBuffer,
    ) {
      if (!(bb instanceof BudgetByteBuffer)) {
        throw new Error("Unsafe .fig decoder buffer.");
      }
      bb.enterDecodedObject();
      try {
        return original.call(this, bb);
      } finally {
        bb.leaveDecodedObject();
      }
    };
  }
  return compiled;
}

// Returns null on any decode failure so callers can still surface the raw
// document buffer.
function decodeKiwiDocument(
  schemaBuf: Buffer,
  documentBuf: Buffer,
): unknown | null {
  let schema: Schema;
  try {
    assertSafeBinarySchemaShape(schemaBuf);
    schema = decodeBinarySchema(schemaBuf);
  } catch {
    return null;
  }
  // kiwi-schema compiles the schema with `new Function`, so never pass names
  // from an untrusted binary schema to it without strict identifier and size
  // validation. Real Figma schemas use ordinary identifiers and a `Message`
  // root; anything else is an unsupported/probably hostile variant.
  if (schema.definitions.length > 1_024) return null;
  const definitionNames = new Set(schema.definitions.map((d) => d.name));
  const safeIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const primitiveTypes = new Set([
    "bool",
    "byte",
    "int",
    "uint",
    "float",
    "string",
    "int64",
    "uint64",
  ]);
  let fieldCount = 0;
  for (const definition of schema.definitions) {
    if (!safeIdentifier.test(definition.name)) return null;
    if (!Array.isArray(definition.fields) || definition.fields.length > 1_024) {
      return null;
    }
    fieldCount += definition.fields.length;
    if (fieldCount > 20_000) return null;
    for (const field of definition.fields) {
      if (!safeIdentifier.test(field.name)) return null;
      if (
        field.type !== null &&
        !primitiveTypes.has(field.type) &&
        !definitionNames.has(field.type)
      ) {
        return null;
      }
    }
  }
  const rootMessage = schema.definitions.find(
    (definition) =>
      definition.name === "Message" && definition.kind === "MESSAGE",
  );
  if (!rootMessage) return null;

  let compiled: CompiledDecoder;
  try {
    compiled = compileBudgetedSchema(schema);
  } catch {
    return null;
  }
  const decodeKey = `decode${rootMessage.name}`;
  const decoder = compiled[decodeKey];
  if (typeof decoder !== "function") return null;

  try {
    const view = new Uint8Array(
      documentBuf.buffer,
      documentBuf.byteOffset,
      documentBuf.byteLength,
    );
    const bb = new BudgetByteBuffer(view);
    const document = decoder.call(compiled, bb);
    return sanitizeForJson(document, {
      objects: 0,
      items: 0,
      binaryBytes: 0,
      stringBytes: 0,
      active: new WeakSet(),
    });
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

function assertSafeBinarySchemaShape(schemaBuf: Buffer): void {
  const bb = new ByteBuffer(
    new Uint8Array(
      schemaBuf.buffer,
      schemaBuf.byteOffset,
      schemaBuf.byteLength,
    ),
  );
  const definitionCount = bb.readVarUint();
  if (definitionCount > 1_024) {
    throw new Error(".fig schema has too many definitions.");
  }
  let totalFields = 0;
  for (let index = 0; index < definitionCount; index += 1) {
    bb.readString();
    const kind = bb.readByte();
    if (kind > 2)
      throw new Error(".fig schema has an invalid definition kind.");
    const fields = bb.readVarUint();
    if (fields > 1_024) {
      throw new Error(".fig schema definition has too many fields.");
    }
    totalFields += fields;
    if (totalFields > 20_000) {
      throw new Error(".fig schema has too many fields.");
    }
    for (let fieldIndex = 0; fieldIndex < fields; fieldIndex += 1) {
      bb.readString();
      bb.readVarInt();
      bb.readByte();
      bb.readVarUint();
    }
  }
}

// Handles both modern fig-kiwi files and legacy zip-format archives.
// `document` is null if kiwi decoding failed.
export function decodeFig(file: Buffer): DecodedFig {
  if (file.length > MAX_FIG_FILE_BYTES) {
    throw new Error(".fig file is too large (max 50 MB).");
  }
  if (isZip(file)) {
    const entries = readZip(file);
    const canvasEntry = entries.find((e) => e.name === "canvas.fig");
    const imageEntries = entries.filter((e) => e.name.startsWith("images/"));

    let document: unknown = null;
    let version: number | undefined;
    let extraBlobs: Buffer[] = [];
    if (!canvasEntry) throw new Error(".fig zip is missing canvas.fig.");
    const inner = decodeKiwiContainer(canvasEntry.data);
    version = inner.version;
    extraBlobs = inner.blobs;
    document = decodeKiwiDocument(inner.schema, inner.document);

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
