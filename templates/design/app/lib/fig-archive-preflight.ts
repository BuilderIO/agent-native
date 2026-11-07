import {
  BROWSER_FIG_LIMITS,
  type FigImportLimits,
} from "../../server/lib/fig-file-limits.js";
import {
  readAscii,
  readU16LE,
  readU32LE,
  readUtf8,
} from "../../shared/fig-bytes.js";

/** Reads only the zip central directory and the kiwi chunk headers of a .fig,
 * so a file the browser decoder would refuse is refused before it is loaded
 * into memory. Sizes it cannot see from headers are left to the decoder. */
export type FigArchivePreflight =
  | { status: "fits" }
  | { status: "too-large"; limit: keyof FigImportLimits }
  | { status: "unreadable"; reason: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_SCAN_BYTES = 65_557;
const ZSTD_MAGIC = 0xfd2fb528;
const MAX_ZSTD_HEADER_BYTES = 18;
const MAX_KIWI_CHUNKS = 4_096;

class UnreadableArchive extends Error {}

async function readBytes(
  blob: Blob,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (start < 0 || end > blob.size || start > end) {
    throw new UnreadableArchive(`Range ${start}-${end} is outside the file.`);
  }
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** The content size a Zstandard frame header declares, or null when the
 * frame leaves it out. */
function zstdDeclaredContentSize(header: Uint8Array): number | null {
  if (header.length < 6 || readU32LE(header, 0) !== ZSTD_MAGIC) return null;
  const descriptor = header[4]!;
  const singleSegment = (descriptor & 0x20) !== 0;
  const contentSizeFlag = descriptor >>> 6;
  let offset = 5 + (singleSegment ? 0 : 1);
  offset += [0, 1, 2, 4][descriptor & 0x03]!;
  const contentSizeBytes =
    contentSizeFlag === 0
      ? singleSegment
        ? 1
        : 0
      : [0, 2, 4, 8][contentSizeFlag]!;
  if (contentSizeBytes === 0) return null;
  if (offset + contentSizeBytes > header.length) {
    throw new UnreadableArchive("Truncated Zstandard frame header.");
  }
  let size = 0;
  for (let index = contentSizeBytes - 1; index >= 0; index -= 1) {
    size = size * 256 + header[offset + index]!;
  }
  return contentSizeBytes === 2 ? size + 256 : size;
}

interface KiwiSizes {
  inflatedBytes: number;
  imageBytes: number;
  largestChunkBytes: number;
}

async function readKiwiChunkSizes(
  blob: Blob,
  start: number,
  length: number,
): Promise<KiwiSizes> {
  const sizes: KiwiSizes = {
    inflatedBytes: 0,
    imageBytes: 0,
    largestChunkBytes: 0,
  };
  let offset = 12;
  for (let index = 0; offset < length; index += 1) {
    if (index >= MAX_KIWI_CHUNKS) break;
    if (offset + 4 > length) {
      throw new UnreadableArchive("Truncated kiwi chunk header.");
    }
    const chunkLength = readU32LE(
      await readBytes(blob, start + offset, start + offset + 4),
      0,
    );
    offset += 4;
    if (offset + chunkLength > length) {
      throw new UnreadableArchive("Kiwi chunk extends past the document.");
    }
    const declared = zstdDeclaredContentSize(
      await readBytes(
        blob,
        start + offset,
        start + offset + Math.min(chunkLength, MAX_ZSTD_HEADER_BYTES),
      ),
    );
    offset += chunkLength;
    if (declared === null) continue;
    sizes.inflatedBytes += declared;
    sizes.largestChunkBytes = Math.max(sizes.largestChunkBytes, declared);
    // Chunks after the schema and the document are embedded image blobs.
    if (index >= 2) sizes.imageBytes += declared;
  }
  return sizes;
}

function isKiwiMagic(head: Uint8Array): boolean {
  const magic = readAscii(head, 0, 8);
  return magic === "fig-kiwi" || magic === "fig-jam.";
}

interface ZipSizes extends KiwiSizes {
  entries: number;
}

async function readZipSizes(
  blob: Blob,
  limits: FigImportLimits,
): Promise<ZipSizes | { tooManyEntries: true }> {
  const tailStart = Math.max(0, blob.size - EOCD_SCAN_BYTES);
  const tail = await readBytes(blob, tailStart, blob.size);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (readU32LE(tail, index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new UnreadableArchive("Zip directory not found.");
  const entries = readU16LE(tail, eocd + 10);
  if (entries > limits.zipEntries) return { tooManyEntries: true };
  const directorySize = readU32LE(tail, eocd + 12);
  const directoryOffset = readU32LE(tail, eocd + 16);
  const directory = await readBytes(
    blob,
    directoryOffset,
    directoryOffset + directorySize,
  );

  const sizes: ZipSizes = {
    entries,
    inflatedBytes: 0,
    imageBytes: 0,
    largestChunkBytes: 0,
  };
  let canvas: { localHeaderOffset: number; size: number } | null = null;
  let position = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (
      position + 46 > directory.length ||
      readU32LE(directory, position) !== CENTRAL_ENTRY_SIGNATURE
    ) {
      throw new UnreadableArchive("Bad zip directory entry.");
    }
    const compressionMethod = readU16LE(directory, position + 10);
    const uncompressedSize = readU32LE(directory, position + 24);
    const nameLength = readU16LE(directory, position + 28);
    const extraLength = readU16LE(directory, position + 30);
    const commentLength = readU16LE(directory, position + 32);
    const localHeaderOffset = readU32LE(directory, position + 42);
    const name = readUtf8(
      directory.subarray(position + 46, position + 46 + nameLength),
    );
    position += 46 + nameLength + extraLength + commentLength;

    if (compressionMethod !== 0) {
      sizes.inflatedBytes += uncompressedSize;
      sizes.largestChunkBytes = Math.max(
        sizes.largestChunkBytes,
        uncompressedSize,
      );
    }
    if (name.startsWith("images/")) sizes.imageBytes += uncompressedSize;
    if (name === "canvas.fig" && compressionMethod === 0) {
      canvas = { localHeaderOffset, size: uncompressedSize };
    }
  }

  if (canvas) {
    const header = await readBytes(
      blob,
      canvas.localHeaderOffset,
      canvas.localHeaderOffset + 30,
    );
    if (readU32LE(header, 0) !== LOCAL_HEADER_SIGNATURE) {
      throw new UnreadableArchive("Bad canvas.fig local header.");
    }
    const dataStart =
      canvas.localHeaderOffset +
      30 +
      readU16LE(header, 26) +
      readU16LE(header, 28);
    const head = await readBytes(blob, dataStart, dataStart + 12);
    if (isKiwiMagic(head)) {
      const kiwi = await readKiwiChunkSizes(blob, dataStart, canvas.size);
      sizes.inflatedBytes += kiwi.inflatedBytes;
      sizes.imageBytes += kiwi.imageBytes;
      sizes.largestChunkBytes = Math.max(
        sizes.largestChunkBytes,
        kiwi.largestChunkBytes,
      );
    }
  }
  return sizes;
}

function firstExceededLimit(
  sizes: KiwiSizes,
  limits: FigImportLimits,
): keyof FigImportLimits | null {
  if (sizes.largestChunkBytes > limits.inflatedChunkBytes) {
    return "inflatedChunkBytes";
  }
  if (sizes.inflatedBytes > limits.inflatedBytes) return "inflatedBytes";
  if (sizes.imageBytes > limits.imageBytes) return "imageBytes";
  return null;
}

export async function preflightFigArchive(
  file: Blob,
  limits: FigImportLimits = BROWSER_FIG_LIMITS,
): Promise<FigArchivePreflight> {
  if (file.size > limits.fileBytes) {
    return { status: "too-large", limit: "fileBytes" };
  }
  try {
    if (file.size < 12) throw new UnreadableArchive("File is too short.");
    const head = await readBytes(file, 0, 12);
    let sizes: KiwiSizes;
    if (readU32LE(head, 0) === LOCAL_HEADER_SIGNATURE) {
      const zip = await readZipSizes(file, limits);
      if ("tooManyEntries" in zip) {
        return { status: "too-large", limit: "zipEntries" };
      }
      sizes = zip;
    } else if (isKiwiMagic(head)) {
      sizes = await readKiwiChunkSizes(file, 0, file.size);
    } else {
      throw new UnreadableArchive("Not a .fig archive.");
    }
    const limit = firstExceededLimit(sizes, limits);
    return limit ? { status: "too-large", limit } : { status: "fits" };
  } catch (error) {
    if (error instanceof UnreadableArchive) {
      return { status: "unreadable", reason: error.message };
    }
    throw error;
  }
}
