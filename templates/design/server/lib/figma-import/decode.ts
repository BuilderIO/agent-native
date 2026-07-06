import * as crypto from "node:crypto";
import * as zlib from "node:zlib";

import { Decompress as ZstdDecompress } from "fzstd";
import {
  ByteBuffer,
  compileSchema,
  decodeBinarySchema,
  type Schema,
} from "kiwi-schema";
import * as pako from "pako";

import type { DecodedFig, DecodedFigImage } from "./types.js";

const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const FIG_KIWI_MAGIC = Buffer.from("fig-kiwi", "utf8");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

interface DecodedFigKiwi {
  version: number;
  schema: Buffer;
  document: Buffer;
  blobs: Buffer[];
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function assertWithinTotalBudget(
  currentBytes: number,
  additionalBytes: number,
): number {
  const nextBytes = currentBytes + additionalBytes;
  if (nextBytes > MAX_TOTAL_DECOMPRESSED_BYTES) {
    throw new Error(
      `Total decompressed Figma data exceeds size limit (${nextBytes} > ${MAX_TOTAL_DECOMPRESSED_BYTES})`,
    );
  }
  return nextBytes;
}

export function isFigKiwiBuffer(file: Buffer): boolean {
  return (
    file.length >= FIG_KIWI_MAGIC.length &&
    file.subarray(0, FIG_KIWI_MAGIC.length).equals(FIG_KIWI_MAGIC)
  );
}

export function isZipBuffer(file: Buffer): boolean {
  return file.length >= 4 && file.subarray(0, 4).equals(ZIP_MAGIC);
}

function detectImageExt(buf: Buffer): DecodedFigImage["ext"] | null {
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
  return null;
}

function checkDecompressedSize(
  buf: Buffer,
  maxBytes = MAX_DECOMPRESSED_BYTES,
): Buffer {
  if (buf.length > maxBytes) {
    throw new Error(
      `Decompressed chunk exceeds size limit (${buf.length} > ${maxBytes})`,
    );
  }
  return buf;
}

function decompressZstdChunk(buf: Buffer, maxOutputLength: number): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const decoder = new ZstdDecompress((chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxOutputLength) {
      throw new Error(
        `Decompressed chunk exceeds size limit (${totalBytes} > ${maxOutputLength})`,
      );
    }
    chunks.push(Buffer.from(chunk));
  });
  decoder.push(buf, true);
  return Buffer.concat(chunks, totalBytes);
}

function decompressPakoChunk(
  buf: Buffer,
  maxOutputLength: number,
  raw: boolean,
): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const inflator = new pako.Inflate({ raw });
  inflator.onData = (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxOutputLength) {
      throw new Error(
        `Decompressed chunk exceeds size limit (${totalBytes} > ${maxOutputLength})`,
      );
    }
    chunks.push(Buffer.from(chunk));
  };
  inflator.push(buf, true);
  if (inflator.err) {
    throw new Error(inflator.msg || "Pako inflate failed");
  }
  return Buffer.concat(chunks, totalBytes);
}

function decompressChunk(buf: Buffer, remainingBytes: number): Buffer {
  const maxOutputLength = Math.min(MAX_DECOMPRESSED_BYTES, remainingBytes);
  if (maxOutputLength <= 0) {
    throw new Error("Total decompressed Figma data exceeds size limit");
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC)) {
    try {
      return decompressZstdChunk(buf, maxOutputLength);
    } catch (error) {
      if (error instanceof Error && /size limit/i.test(error.message)) {
        throw error;
      }
      // Some historical files carry misleading chunk headers; try zlib below.
    }
  }
  try {
    return zlib.inflateRawSync(buf, {
      maxOutputLength,
    });
  } catch (error) {
    if (error instanceof RangeError) throw error;
  }
  try {
    return zlib.inflateSync(buf, { maxOutputLength });
  } catch (error) {
    if (error instanceof RangeError) throw error;
  }
  try {
    return decompressPakoChunk(buf, maxOutputLength, true);
  } catch (error) {
    if (error instanceof Error && /size limit/i.test(error.message)) {
      throw error;
    }
    // Fall through.
  }
  try {
    return decompressPakoChunk(buf, maxOutputLength, false);
  } catch (error) {
    if (error instanceof Error && /size limit/i.test(error.message)) {
      throw error;
    }
    // Fall through.
  }
  throw new Error("Figma chunk could not be decompressed.");
}

export function decodeKiwiContainer(file: Buffer): DecodedFigKiwi {
  if (!isFigKiwiBuffer(file)) {
    throw new Error("Not a fig-kiwi file (missing magic header)");
  }
  if (file.length < 12) {
    throw new Error(
      "Truncated kiwi header (file too short to contain version)",
    );
  }
  const version = file.readUInt32LE(8);
  let offset = 12;
  let totalDecompressedBytes = 0;
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
    const chunk = decompressChunk(
      compressed,
      MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes,
    );
    totalDecompressedBytes = assertWithinTotalBudget(
      totalDecompressedBytes,
      chunk.length,
    );
    chunks.push(chunk);
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

function readZip(file: Buffer): ZipEntry[] {
  const eocdSignature = 0x06054b50;
  const maxScan = Math.min(file.length, 65557);
  let eocdOffset = -1;
  for (let i = file.length - 22; i >= file.length - maxScan && i >= 0; i--) {
    if (file.readUInt32LE(i) === eocdSignature) {
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
  let totalDecompressedBytes = 0;
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > file.length) {
      throw new Error(`Truncated central directory entry at offset ${cursor}`);
    }
    if (file.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Bad central directory entry signature at ${cursor}`);
    }
    const compressionMethod = file.readUInt16LE(cursor + 10);
    const compressedSize = file.readUInt32LE(cursor + 20);
    const uncompressedSize = file.readUInt32LE(cursor + 24);
    const nameLen = file.readUInt16LE(cursor + 28);
    const extraLen = file.readUInt16LE(cursor + 30);
    const commentLen = file.readUInt16LE(cursor + 32);
    const localHeaderOffset = file.readUInt32LE(cursor + 42);
    const name = file
      .subarray(cursor + 46, cursor + 46 + nameLen)
      .toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

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
      totalDecompressedBytes = assertWithinTotalBudget(
        totalDecompressedBytes,
        compressed.length,
      );
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      data = zlib.inflateRawSync(compressed, {
        maxOutputLength: Math.min(
          MAX_DECOMPRESSED_BYTES,
          MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressedBytes,
        ),
      });
      totalDecompressedBytes = assertWithinTotalBudget(
        totalDecompressedBytes,
        data.length,
      );
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
    if (!name.endsWith("/")) entries.push({ name, data });
  }
  return entries;
}

function sanitizeForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeForJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = sanitizeForJson(child);
    }
    return out;
  }
  return value;
}

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
    schema.definitions.find((definition) => definition.name === "Message")
      ?.name ??
    schema.definitions.find((definition) => definition.kind === "MESSAGE")
      ?.name ??
    null;
  if (!rootMessage) return null;

  let compiled: Record<string, (bb: ByteBuffer) => unknown>;
  try {
    compiled = compileSchema(schema);
  } catch {
    return null;
  }
  const decoder = compiled[`decode${rootMessage}`];
  if (typeof decoder !== "function") return null;

  try {
    const view = new Uint8Array(
      documentBuf.buffer,
      documentBuf.byteOffset,
      documentBuf.byteLength,
    );
    return sanitizeForJson(decoder.call(compiled, new ByteBuffer(view)));
  } catch {
    return null;
  }
}

function collectImagesFromBlobs(blobs: Buffer[]): DecodedFigImage[] {
  const seen = new Map<string, DecodedFigImage>();
  for (const blob of blobs) {
    if (blob.length === 0) continue;
    const ext = detectImageExt(blob);
    if (!ext) continue;
    const hash = sha1(blob);
    if (!seen.has(hash)) seen.set(hash, { hash, ext, bytes: blob });
  }
  return Array.from(seen.values());
}

function findThumbnail(documentBuf: Buffer, blobs: Buffer[]): Buffer | null {
  const pngBlobs = blobs
    .filter((blob) => blob.length >= 8 && blob.subarray(0, 8).equals(PNG_MAGIC))
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

export function decodeFig(file: Buffer): DecodedFig {
  if (isZipBuffer(file)) {
    const entries = readZip(file);
    const canvasEntry = entries.find((entry) => entry.name === "canvas.fig");
    const imageEntries = entries.filter((entry) =>
      entry.name.startsWith("images/"),
    );

    let document: unknown = null;
    let version: number | undefined;
    let blobs: Buffer[] = [];
    if (canvasEntry) {
      try {
        const inner = decodeKiwiContainer(canvasEntry.data);
        version = inner.version;
        blobs = inner.blobs;
        document = decodeKiwiDocument(inner.schema, inner.document);
      } catch {
        // Keep document null; caller surfaces a targeted decode error.
      }
    }

    const images: DecodedFigImage[] = [];
    const seen = new Set<string>();
    for (const entry of imageEntries) {
      const ext = detectImageExt(entry.data);
      if (!ext) continue;
      const hash = sha1(entry.data);
      if (seen.has(hash)) continue;
      seen.add(hash);
      images.push({ hash, ext, bytes: entry.data });
    }
    for (const image of collectImagesFromBlobs(blobs)) {
      if (seen.has(image.hash)) continue;
      seen.add(image.hash);
      images.push(image);
    }

    const thumbnailEntry = entries.find(
      (entry) => entry.name === "thumbnail.png",
    );
    return {
      format: "zip",
      version,
      document,
      images,
      thumbnail: thumbnailEntry?.data ?? null,
      blobs,
    };
  }

  const decoded = decodeKiwiContainer(file);
  const document = decodeKiwiDocument(decoded.schema, decoded.document);
  return {
    format: "kiwi",
    version: decoded.version,
    document,
    images: collectImagesFromBlobs(decoded.blobs),
    thumbnail: findThumbnail(decoded.document, decoded.blobs),
    blobs: decoded.blobs,
  };
}
