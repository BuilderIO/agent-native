import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < PNG_CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  PNG_CRC_TABLE[index] = value >>> 0;
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngPaethPredictor(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function isInvalidPngDeflateError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    [
      "ERR_BUFFER_TOO_LARGE",
      "Z_BUF_ERROR",
      "Z_DATA_ERROR",
      "Z_NEED_DICT",
    ].includes(error.code)
  );
}

export function pngDimensions(
  source: Uint8Array,
  limits: { maxDimension: number; maxPixels: number },
): { width: number; height: number } | null {
  const data = Buffer.from(source);
  if (
    data.length < PNG_SIGNATURE.length ||
    !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return null;
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let paletteEntryCount = 0;
  let seenHeader = false;
  let seenPalette = false;
  let seenData = false;
  let dataEnded = false;
  let seenEnd = false;
  const compressedChunks: Buffer[] = [];

  while (offset < data.length) {
    if (offset + 12 > data.length) return null;
    const chunkLength = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > data.length) return null;
    const chunkType = data.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(chunkType)) return null;
    const checksumOffset = offset + 8 + chunkLength;
    if (
      pngCrc32(data.subarray(offset + 4, checksumOffset)) !==
      data.readUInt32BE(checksumOffset)
    ) {
      return null;
    }
    const chunk = data.subarray(offset + 8, checksumOffset);

    if (
      !seenHeader &&
      (chunkType !== "IHDR" || offset !== PNG_SIGNATURE.length)
    ) {
      return null;
    }
    if (chunkType === "IHDR") {
      if (seenHeader || chunkLength !== 13) return null;
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8];
      colorType = chunk[9]!;
      if (
        width < 1 ||
        height < 1 ||
        width > limits.maxDimension ||
        height > limits.maxDimension ||
        width * height > limits.maxPixels ||
        bitDepth !== 8 ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        chunk[10] !== 0 ||
        chunk[11] !== 0 ||
        chunk[12] !== 0
      ) {
        return null;
      }
      seenHeader = true;
    } else if (chunkType === "PLTE") {
      if (
        seenPalette ||
        seenData ||
        (colorType !== 2 && colorType !== 3 && colorType !== 6) ||
        chunkLength < 3 ||
        chunkLength > 768 ||
        chunkLength % 3 !== 0
      ) {
        return null;
      }
      seenPalette = true;
      paletteEntryCount = chunkLength / 3;
    } else if (chunkType === "IDAT") {
      if (dataEnded || (colorType === 3 && !seenPalette)) return null;
      seenData = true;
      compressedChunks.push(chunk);
    } else if (chunkType === "IEND") {
      if (chunkLength !== 0 || !seenData || chunkEnd !== data.length) {
        return null;
      }
      seenEnd = true;
      break;
    } else {
      if (seenData) dataEnded = true;
      if (chunkType[0] === chunkType[0]?.toUpperCase()) return null;
      if (chunkType[2] !== chunkType[2]?.toUpperCase()) return null;
    }

    if (seenData && chunkType !== "IDAT") dataEnded = true;
    offset = chunkEnd;
  }

  if (!seenEnd || !seenData) return null;
  const channels =
    colorType === 0 || colorType === 3
      ? 1
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : 4;
  const rowBytes = width * channels;
  const expectedDecodedBytes = (rowBytes + 1) * height;
  if (expectedDecodedBytes > limits.maxPixels * 4 + limits.maxDimension) {
    return null;
  }

  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(compressedChunks), {
      maxOutputLength: expectedDecodedBytes,
    });
  } catch (error) {
    if (!isInvalidPngDeflateError(error)) throw error;
    return null;
  }
  if (decoded.byteLength !== expectedDecodedBytes) return null;
  const rowStride = rowBytes + 1;
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * rowStride;
    const filter = decoded[rowOffset]!;
    if (filter > 4) return null;
    if (colorType !== 3) continue;

    const pixels = decoded.subarray(rowOffset + 1, rowOffset + rowStride);
    const previousPixels =
      row === 0 ? null : decoded.subarray(rowOffset - rowStride + 1, rowOffset);
    for (let column = 0; column < pixels.byteLength; column += 1) {
      const left = column === 0 ? 0 : pixels[column - 1]!;
      const above = previousPixels?.[column] ?? 0;
      const upperLeft = column === 0 ? 0 : (previousPixels?.[column - 1] ?? 0);
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : pngPaethPredictor(left, above, upperLeft);
      const paletteIndex = (pixels[column]! + predictor) & 0xff;
      if (paletteIndex >= paletteEntryCount) return null;
      pixels[column] = paletteIndex;
    }
  }

  return { width, height };
}
