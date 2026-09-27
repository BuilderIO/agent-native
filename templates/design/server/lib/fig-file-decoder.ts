import { Decompress as ZstdDecompress } from "fzstd";
import {
  ByteBuffer,
  compileSchemaJS,
  decodeBinarySchema,
  type Schema,
} from "kiwi-schema";

import {
  asciiBytes,
  bytesEqual,
  concatBytes,
  indexOfBytes,
  inflateCapped,
  readAscii,
  readU16LE,
  readU32LE,
  readUtf8,
  sha1Hex,
  utf8ByteLength,
} from "../../shared/fig-bytes.js";
import {
  MAX_FIG_DECOMPRESSED_BYTES,
  MAX_FIG_FILE_BYTES,
} from "./fig-file-limits.js";

const MAX_DECOMPRESSED_CHUNK_BYTES = 48 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;
const MAX_KIWI_CHUNKS = 4_096;
const MAX_ZIP_ENTRIES = 2_048;
const MAX_ZIP_NAME_BYTES = 512;
const MAX_COMPRESSION_RATIO = 1_000;
const MAX_DECODE_DEPTH = 256;
const MAX_DECODED_OBJECTS = 8_000_000;
const MAX_COLLECTION_LENGTH = 2_000_000;
const MAX_COLLECTION_ITEMS = 24_000_000;
const MAX_DECODE_READS = 64 * 1024 * 1024;
const MAX_DECODED_BINARY_BYTES = 32 * 1024 * 1024;
const MAX_DECODED_BINARY_FIELD_BYTES = 4 * 1024 * 1024;
const MAX_DECODED_STRING_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_STRING_BYTES = 32 * 1024 * 1024;
const decodedDocuments = new WeakSet<object>();
const ZSTD_MAGIC = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);
const FIG_KIWI_MAGIC = asciiBytes("fig-kiwi");
const FIGJAM_KIWI_MAGIC = asciiBytes("fig-jam.");
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);

export interface DecodedFigKiwi {
  version: number;
  schema: Uint8Array;
  document: Uint8Array;
  blobs: Uint8Array[];
}

export interface DecodedFigImage {
  hash: string;
  ext: string;
  bytes: Uint8Array;
}

export interface DecodedFig {
  format: "kiwi" | "zip";
  version?: number;
  document: unknown;
  decodeError?: string;
  images: DecodedFigImage[];
  thumbnail: Uint8Array | null;
}

export interface DecodeFigOptions {
  maxFileBytes?: number | null;
}

function maxFileBytes(options?: DecodeFigOptions): number | null {
  return options?.maxFileBytes === undefined
    ? MAX_FIG_FILE_BYTES
    : options.maxFileBytes;
}

function sha1(buf: Uint8Array): string {
  return sha1Hex(buf);
}

function detectImageExt(buf: Uint8Array): string {
  if (buf.length >= 8 && bytesEqual(buf.subarray(0, 8), PNG_MAGIC))
    return "png";
  if (buf.length >= 3 && bytesEqual(buf.subarray(0, 3), JPEG_MAGIC))
    return "jpg";
  if (
    buf.length >= 12 &&
    readAscii(buf, 0, 4) === "RIFF" &&
    readAscii(buf, 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (buf.length >= 4 && readAscii(buf, 0, 4) === "GIF8") {
    return "gif";
  }
  return "bin";
}

function checkDecompressedSize(buf: Uint8Array): Uint8Array {
  if (buf.length > MAX_DECOMPRESSED_CHUNK_BYTES) {
    throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
  }
  return buf;
}

function assertSafeZstdFrameHeader(buf: Uint8Array): void {
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

function decompressZstdChunk(buf: Uint8Array): Uint8Array {
  assertSafeZstdFrameHeader(buf);
  const parts: Uint8Array[] = [];
  let total = 0;
  const decoder = new ZstdDecompress((part) => {
    total += part.byteLength;
    if (total > MAX_DECOMPRESSED_CHUNK_BYTES) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    parts.push(part);
  });
  decoder.push(buf, true);
  return concatBytes(parts, total);
}

function decompressChunk(buf: Uint8Array): Uint8Array {
  if (buf.length === 0) return new Uint8Array(0);
  if (buf.length >= 4 && bytesEqual(buf.subarray(0, 4), ZSTD_MAGIC)) {
    return decompressZstdChunk(buf);
  }
  try {
    return inflateCapped(buf, MAX_DECOMPRESSED_CHUNK_BYTES, true);
  } catch (e) {
    if (/too large/i.test(String(e))) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    /* fall through for format/data errors */
  }
  try {
    return inflateCapped(buf, MAX_DECOMPRESSED_CHUNK_BYTES, false);
  } catch (e) {
    if (/too large/i.test(String(e))) {
      throw new Error("Decompressed .fig chunk is too large (max 48 MB).");
    }
    /* fall through */
  }
  return checkDecompressedSize(buf.slice());
}

export function decodeKiwiContainer(
  file: Uint8Array,
  options?: DecodeFigOptions,
): DecodedFigKiwi {
  assertFileWithinLimit(file, options);
  if (
    !bytesEqual(file.subarray(0, 8), FIG_KIWI_MAGIC) &&
    !bytesEqual(file.subarray(0, 8), FIGJAM_KIWI_MAGIC)
  ) {
    throw new Error("Not a fig-kiwi file (missing magic header)");
  }
  if (file.length < 12) {
    throw new Error(
      "Truncated kiwi header (file too short to contain version)",
    );
  }
  const version = readU32LE(file, 8);
  let offset = 12;
  const chunks: Uint8Array[] = [];
  let decompressedBytes = 0;
  while (offset < file.length) {
    if (chunks.length >= MAX_KIWI_CHUNKS) {
      throw new Error(".fig file has too many binary chunks.");
    }
    if (offset + 4 > file.length) {
      throw new Error(`Truncated chunk header at offset ${offset}`);
    }
    const length = readU32LE(file, offset);
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
  data: Uint8Array;
}

function readZip(file: Uint8Array): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  const maxScan = Math.min(file.length, 65557);
  let eocdOffset = -1;
  for (let i = file.length - 22; i >= file.length - maxScan && i >= 0; i--) {
    if (readU32LE(file, i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Zip EOCD record not found");

  if (eocdOffset + 22 > file.length) {
    throw new Error("Truncated zip EOCD record.");
  }
  const diskNumber = readU16LE(file, eocdOffset + 4);
  const centralDirectoryDisk = readU16LE(file, eocdOffset + 6);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error("Multi-disk .fig zip archives are not supported.");
  }
  const totalEntries = readU16LE(file, eocdOffset + 10);
  if (totalEntries === 0xffff || totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(".fig zip has too many entries (max 2048).");
  }
  const cdSize = readU32LE(file, eocdOffset + 12);
  const cdOffset = readU32LE(file, eocdOffset + 16);
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
    if (readU32LE(file, p) !== 0x02014b50) {
      throw new Error(`Bad central directory entry signature at ${p}`);
    }
    const flags = readU16LE(file, p + 8);
    const compressionMethod = readU16LE(file, p + 10);
    const compressedSize = readU32LE(file, p + 20);
    const uncompressedSize = readU32LE(file, p + 24);
    const nameLen = readU16LE(file, p + 28);
    const extraLen = readU16LE(file, p + 30);
    const commentLen = readU16LE(file, p + 32);
    const localHeaderOffset = readU32LE(file, p + 42);
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
    const name = readUtf8(file.subarray(p + 46, p + 46 + nameLen));
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
    if (readU32LE(file, lh) !== 0x04034b50) {
      throw new Error(`Bad local file header signature at ${lh}`);
    }
    const localFlags = readU16LE(file, lh + 6);
    const localCompressionMethod = readU16LE(file, lh + 8);
    if (
      (localFlags & 0x01) !== 0 ||
      localCompressionMethod !== compressionMethod
    ) {
      throw new Error(`Inconsistent local header for "${name}".`);
    }
    const lhNameLen = readU16LE(file, lh + 26);
    const lhExtraLen = readU16LE(file, lh + 28);
    const dataStart = lh + 30 + lhNameLen + lhExtraLen;
    if (dataStart + compressedSize > file.length) {
      throw new Error(`Compressed data for "${name}" extends past end of file`);
    }
    const compressed = file.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (compressionMethod === 0) {
      if (compressedSize !== uncompressedSize) {
        throw new Error(`Invalid stored size for "${name}".`);
      }
      data = compressed.slice();
    } else if (compressionMethod === 8) {
      try {
        data = inflateCapped(compressed, MAX_DECOMPRESSED_CHUNK_BYTES, true);
      } catch (error) {
        if (/too large/i.test(String(error))) {
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

function isZip(file: Uint8Array): boolean {
  return file.length >= 4 && bytesEqual(file.subarray(0, 4), ZIP_MAGIC);
}

export function assertSafeDecodedFigDocument(value: unknown): void {
  if (
    value !== null &&
    typeof value === "object" &&
    decodedDocuments.has(value)
  ) {
    return;
  }
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
      if (binaryBytes > MAX_DECODED_BINARY_BYTES) {
        throw new Error("Decoded .fig document contains too much binary data.");
      }
      continue;
    }
    const stringValue =
      typeof current.value === "string"
        ? current.value
        : current.value instanceof String
          ? current.value.valueOf()
          : typeof current.value === "bigint"
            ? current.value.toString()
            : undefined;
    if (stringValue !== undefined) {
      const bytes = utf8ByteLength(stringValue);
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

interface KiwiByteBufferState {
  _data: Uint8Array;
  _index: number;
}

const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const SHORT_ASCII_STRING_BYTES = 64;

function isAscii(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index]! >= 0x80) return false;
  }
  return true;
}

class BudgetByteBuffer extends ByteBuffer {
  private binaryBytes = 0;
  private collectionItems = 0;
  private decodedObjects = 0;
  private decodeDepth = 0;
  private readCount = 0;
  private stringBytes = 0;

  override readByte(): number {
    this.chargeReads(1);
    return super.readByte();
  }

  override readByteArray(): Uint8Array {
    const length = this.readVarUint();
    if (
      length > MAX_DECODED_BINARY_FIELD_BYTES ||
      this.binaryBytes + length > MAX_DECODED_BINARY_BYTES
    ) {
      throw new Error("Decoded .fig document contains too much binary data.");
    }
    const state = this as unknown as KiwiByteBufferState;
    const start = state._index;
    const end = start + length;
    if (end > state._data.length) throw new Error("Read array out of bounds");
    state._index = end;
    this.binaryBytes += length;
    return state._data.slice(start, end);
  }

  override readString(): string {
    const state = this as unknown as KiwiByteBufferState;
    const start = state._index;
    const end = state._data.indexOf(0, start);
    this.chargeReads((end >= 0 ? end + 1 : state._data.length) - start);
    if (end >= 0) {
      if (end - start > MAX_DECODED_STRING_BYTES) {
        throw new Error("Decoded .fig document contains too much string data.");
      }
      const bytes = state._data.subarray(start, end);
      const text =
        bytes.length <= SHORT_ASCII_STRING_BYTES && isAscii(bytes)
          ? String.fromCharCode.apply(null, bytes as unknown as number[])
          : utf8Decoder.decode(bytes);
      if (!text.includes(REPLACEMENT_CHARACTER)) {
        this.chargeString(end - start);
        state._index = end + 1;
        return text;
      }
    }
    const text = super.readString();
    this.chargeString(utf8ByteLength(text));
    return text;
  }

  readVarUint64String(): string {
    const text = super.readVarUint64().toString();
    this.chargeString(text.length);
    return text;
  }

  readVarInt64String(): string {
    const text = super.readVarInt64().toString();
    this.chargeString(text.length);
    return text;
  }

  readEnumValue(values: Record<number, string>): string | undefined {
    const value = values[this.readVarUint()];
    if (value !== undefined) this.chargeString(value.length);
    return value;
  }

  enterDecodedArray(): number {
    const length = super.readVarUint();
    this.collectionItems += length;
    if (
      length > MAX_COLLECTION_LENGTH ||
      this.collectionItems > MAX_COLLECTION_ITEMS
    ) {
      throw new Error(".fig document declares an oversized collection.");
    }
    this.enterDecodedObject();
    return length;
  }

  leaveDecodedArray(): void {
    this.decodeDepth -= 1;
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

  leaveDecodedObject<T extends object>(result: T): T {
    this.decodeDepth -= 1;
    for (const _field in result) this.collectionItems += 1;
    if (this.collectionItems > MAX_COLLECTION_ITEMS) {
      throw new Error(".fig document has too many fields.");
    }
    return result;
  }

  private chargeReads(count: number): void {
    this.readCount += count;
    if (this.readCount > MAX_DECODE_READS) {
      throw new Error(".fig document exceeded its decode work budget.");
    }
  }

  private chargeString(bytes: number): void {
    this.stringBytes += bytes;
    if (
      bytes > MAX_DECODED_STRING_BYTES ||
      this.stringBytes > MAX_TOTAL_STRING_BYTES
    ) {
      throw new Error("Decoded .fig document contains too much string data.");
    }
  }
}

type CompiledDecoder = Record<string, unknown> & {
  ByteBuffer: typeof BudgetByteBuffer;
};

function replaceCounted(
  source: string,
  pattern: RegExp,
  replacement: (match: string) => string,
): { source: string; count: number } {
  let count = 0;
  const patched = source.replace(pattern, (match) => {
    count += 1;
    return replacement(match);
  });
  return { source: patched, count };
}

function compileBudgetedSchema(schema: Schema): CompiledDecoder {
  const decoders = schema.definitions.filter((d) => d.kind !== "ENUM").length;
  let source = compileSchemaJS(schema);
  const objects = replaceCounted(
    source,
    /\n {2}var result = \{\};\n/g,
    (match) => `${match}  bb.enterDecodedObject();\n`,
  );
  const returns = replaceCounted(
    objects.source,
    /return result;/g,
    () => "return bb.leaveDecodedObject(result);",
  );
  const arrays = replaceCounted(
    returns.source,
    /var length = bb\.readVarUint\(\);/g,
    () => "var length = bb.enterDecodedArray();",
  );
  const loops = replaceCounted(
    arrays.source,
    /for \(var i = 0; i < length; i\+\+\) values\[i\] = [^\n]*;\n/g,
    (match) => `${match}bb.leaveDecodedArray();\n`,
  );
  const byName = new Map(schema.definitions.map((d) => [d.name, d]));
  const enumFields = schema.definitions
    .filter((d) => d.kind !== "ENUM")
    .flatMap((d) => d.fields)
    .filter((f) => f.type !== null && byName.get(f.type)?.kind === "ENUM");
  const enums = replaceCounted(
    loops.source,
    /this\["[\w$]+"\]\[bb\.readVarUint\(\)\]/g,
    (match) => `bb.readEnumValue(${match.slice(0, match.indexOf("]") + 1)})`,
  );
  if (
    objects.count !== decoders ||
    returns.count !== decoders ||
    loops.count !== arrays.count ||
    enums.count !== enumFields.length
  ) {
    throw new Error("Unsupported kiwi decoder output.");
  }
  source = enums.source
    .split("bb.readVarUint64()")
    .join("bb.readVarUint64String()")
    .split("bb.readVarInt64()")
    .join("bb.readVarInt64String()");
  const compiled: CompiledDecoder = { ByteBuffer: BudgetByteBuffer };
  new Function("exports", source)(compiled);
  return compiled;
}

function decodeKiwiDocument(
  schemaBuf: Uint8Array,
  documentBuf: Uint8Array,
): { document: unknown; decodeError?: string } {
  let schema: Schema;
  try {
    assertSafeBinarySchemaShape(schemaBuf);
    schema = decodeBinarySchema(schemaBuf);
  } catch (e) {
    return {
      document: null,
      decodeError: `Schema parsing failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const definitionNames = new Set(schema.definitions.map((d) => d.name));
  const isSafeIdentifier = (name: string) =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && name !== "__proto__";
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
  for (const definition of schema.definitions) {
    if (!isSafeIdentifier(definition.name)) {
      return {
        document: null,
        decodeError: `Unsafe schema identifier: "${definition.name}"`,
      };
    }
    if (!Array.isArray(definition.fields)) {
      return {
        document: null,
        decodeError: `Definition "${definition.name}" has no fields array`,
      };
    }
    for (const field of definition.fields) {
      if (!isSafeIdentifier(field.name)) {
        return {
          document: null,
          decodeError: `Unsafe field identifier: "${definition.name}.${field.name}"`,
        };
      }
      if (
        field.type !== null &&
        !primitiveTypes.has(field.type) &&
        !definitionNames.has(field.type)
      ) {
        return {
          document: null,
          decodeError: `Unknown field type "${field.type}" in "${definition.name}.${field.name}"`,
        };
      }
    }
  }
  const rootMessage =
    schema.definitions.find(
      (d) => d.name === "Message" && d.kind === "MESSAGE",
    ) ?? schema.definitions.find((d) => d.kind === "MESSAGE");
  if (!rootMessage) {
    return {
      document: null,
      decodeError: `No MESSAGE definition found in schema (${schema.definitions.length} definitions: ${schema.definitions
        .map((d) => d.name)
        .slice(0, 10)
        .join(", ")})`,
    };
  }

  let compiled: CompiledDecoder;
  try {
    compiled = compileBudgetedSchema(schema);
  } catch (e) {
    return {
      document: null,
      decodeError: `Schema compilation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const decodeKey = `decode${rootMessage.name}`;
  const decoder = compiled[decodeKey];
  if (typeof decoder !== "function") {
    return {
      document: null,
      decodeError: `Compiled decoder missing function "${decodeKey}"`,
    };
  }

  try {
    const view = new Uint8Array(
      documentBuf.buffer,
      documentBuf.byteOffset,
      documentBuf.byteLength,
    );
    const bb = new BudgetByteBuffer(view);
    const document: unknown = decoder.call(compiled, bb);
    if (document !== null && typeof document === "object") {
      decodedDocuments.add(document);
    }
    return { document };
  } catch (e) {
    return {
      document: null,
      decodeError: `Document decoding failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function collectImagesFromBlobs(blobs: Uint8Array[]): DecodedFigImage[] {
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

function findThumbnail(
  documentBuf: Uint8Array,
  blobs: Uint8Array[],
): Uint8Array | null {
  const pngBlobs = blobs
    .filter((b) => b.length >= 8 && bytesEqual(b.subarray(0, 8), PNG_MAGIC))
    .sort((a, b) => a.length - b.length);
  if (pngBlobs.length > 0) return pngBlobs[0]!;

  const idx = indexOfBytes(documentBuf, PNG_MAGIC);
  if (idx >= 0) {
    const iend = new Uint8Array([
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const end = indexOfBytes(documentBuf, iend, idx);
    if (end > idx) return documentBuf.subarray(idx, end + iend.length);
  }
  return null;
}

function assertSafeBinarySchemaShape(schemaBuf: Uint8Array): void {
  const bb = new ByteBuffer(
    new Uint8Array(
      schemaBuf.buffer,
      schemaBuf.byteOffset,
      schemaBuf.byteLength,
    ),
  );
  const definitionCount = bb.readVarUint();
  for (let index = 0; index < definitionCount; index += 1) {
    bb.readString();
    const kind = bb.readByte();
    if (kind > 2)
      throw new Error(".fig schema has an invalid definition kind.");
    const fields = bb.readVarUint();
    for (let fieldIndex = 0; fieldIndex < fields; fieldIndex += 1) {
      bb.readString();
      bb.readVarInt();
      bb.readByte();
      bb.readVarUint();
    }
  }
}

function assertFileWithinLimit(
  file: Uint8Array,
  options?: DecodeFigOptions,
): void {
  const fileLimit = maxFileBytes(options);
  if (fileLimit !== null && file.length > fileLimit) {
    throw new Error(
      `.fig file is too large (max ${Math.round(fileLimit / 1024 / 1024)} MB).`,
    );
  }
}

function readZipCanvas(
  file: Uint8Array,
  options?: DecodeFigOptions,
): { entries: ZipEntry[]; inner: DecodedFigKiwi } {
  const entries = readZip(file);
  const canvasEntry = entries.find((e) => e.name === "canvas.fig");
  if (!canvasEntry) throw new Error(".fig zip is missing canvas.fig.");
  return { entries, inner: decodeKiwiContainer(canvasEntry.data, options) };
}

function collectZipImages(
  entries: ZipEntry[],
  blobs: Uint8Array[],
): DecodedFigImage[] {
  return collectImagesFromBlobs([
    ...entries.filter((e) => e.name.startsWith("images/")).map((e) => e.data),
    ...blobs,
  ]);
}

export function decodeFigImages(
  file: Uint8Array,
  options?: DecodeFigOptions,
): DecodedFigImage[] {
  assertFileWithinLimit(file, options);
  if (isZip(file)) {
    const { entries, inner } = readZipCanvas(file, options);
    return collectZipImages(entries, inner.blobs);
  }
  return collectImagesFromBlobs(decodeKiwiContainer(file, options).blobs);
}

export function decodeFig(
  file: Uint8Array,
  options?: DecodeFigOptions,
): DecodedFig {
  assertFileWithinLimit(file, options);
  if (isZip(file)) {
    const { entries, inner } = readZipCanvas(file, options);
    const kiwiResult = decodeKiwiDocument(inner.schema, inner.document);
    const thumbnailEntry = entries.find((e) => e.name === "thumbnail.png");
    return {
      format: "zip",
      version: inner.version,
      document: kiwiResult.document,
      ...(kiwiResult.decodeError
        ? { decodeError: kiwiResult.decodeError }
        : {}),
      images: collectZipImages(entries, inner.blobs),
      thumbnail: thumbnailEntry?.data ?? null,
    };
  }

  const decoded = decodeKiwiContainer(file, options);
  const kiwiResult = decodeKiwiDocument(decoded.schema, decoded.document);
  const images = collectImagesFromBlobs(decoded.blobs);
  const thumbnail = findThumbnail(decoded.document, decoded.blobs);
  return {
    format: "kiwi",
    version: decoded.version,
    document: kiwiResult.document,
    ...(kiwiResult.decodeError ? { decodeError: kiwiResult.decodeError } : {}),
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
