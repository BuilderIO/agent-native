import {
  MissingVisualImagePayloadError,
  isSupportedChatImageType,
  isVisualImageAttachment,
} from "@/lib/chat-image-attachments";

const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
const MAX_PNG_METADATA_BYTES = 1024 * 1024;
const MAX_IMAGE_DECODE_PIXELS = 32_000_000;
const MAX_IMAGE_DECODE_DIMENSION = 20_000;
const IMAGE_COMPRESSION_PASSES = [
  { maxDimension: 1400, quality: 0.76 },
  { maxDimension: 1024, quality: 0.7 },
  { maxDimension: 768, quality: 0.65 },
  { maxDimension: 640, quality: 0.6 },
  { maxDimension: 512, quality: 0.55 },
  { maxDimension: 384, quality: 0.5 },
];

export interface PreparedPromptImage {
  file: File;
  dataUrl: string;
}

export type PromptImageOptimizationFailureCode =
  | "animated-image-exceeds-data-url-budget"
  | "image-decode-failed"
  | "image-optimization-failed"
  | "image-optimization-unavailable"
  | "image-resolution-exceeds-safety-limit"
  | "invalid-or-unsupported-image";

export class PromptImageOptimizationError extends MissingVisualImagePayloadError {
  readonly cause?: unknown;

  constructor(
    readonly code: PromptImageOptimizationFailureCode,
    cause?: unknown,
  ) {
    super();
    this.name = "PromptImageOptimizationError";
    if (cause !== undefined) this.cause = cause;
  }
}

type ImageFormat = "gif" | "jpeg" | "png" | "webp";

interface ImageMetadata {
  format: ImageFormat;
  width: number;
  height: number;
  animated: boolean;
}

class FileByteReader {
  private position = 0;
  private chunkStart = -1;
  private chunk = new Uint8Array();

  constructor(private readonly file: File) {}

  get offset(): number {
    return this.position;
  }

  async ensureBuffered(): Promise<boolean> {
    return this.loadChunk();
  }

  private async loadChunk(): Promise<boolean> {
    if (this.position >= this.file.size) return false;
    if (
      this.position < this.chunkStart ||
      this.position >= this.chunkStart + this.chunk.length
    ) {
      this.chunkStart = Math.floor(this.position / 64_000) * 64_000;
      this.chunk = new Uint8Array(
        await this.file
          .slice(this.chunkStart, this.chunkStart + 64_000)
          .arrayBuffer(),
      );
    }
    return true;
  }

  async readByte(): Promise<number | null> {
    if (!(await this.loadChunk())) return null;
    return this.chunk[this.position++ - this.chunkStart] ?? null;
  }

  readBufferedBytes(length: number): Uint8Array | null {
    if (
      length < 0 ||
      this.position < this.chunkStart ||
      this.position + length > this.chunkStart + this.chunk.length ||
      this.position + length > this.file.size
    ) {
      return null;
    }
    const start = this.position - this.chunkStart;
    this.position += length;
    return this.chunk.subarray(start, start + length);
  }

  async readBytes(length: number): Promise<Uint8Array | null> {
    if (length < 0 || this.position + length > this.file.size) return null;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      const byte = await this.readByte();
      if (byte === null) return null;
      bytes[index] = byte;
    }
    return bytes;
  }

  async readString(length: number): Promise<string | null> {
    const bytes = await this.readBytes(length);
    return bytes ? String.fromCharCode(...bytes) : null;
  }

  async readUint16LE(): Promise<number | null> {
    const bytes = await this.readBytes(2);
    return bytes ? bytes[0] | (bytes[1] << 8) : null;
  }

  async readUint32LE(): Promise<number | null> {
    const bytes = await this.readBytes(4);
    return bytes
      ? (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0
      : null;
  }

  async readUint32BE(): Promise<number | null> {
    const bytes = await this.readBytes(4);
    return bytes
      ? bytes[0] * 0x1000000 + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]
      : null;
  }

  skip(length: number): boolean {
    if (length < 0 || this.position + length > this.file.size) return false;
    this.position += length;
    return true;
  }

  async skipSubBlocks(): Promise<boolean> {
    while (this.position < this.file.size) {
      if (
        this.position < this.chunkStart ||
        this.position >= this.chunkStart + this.chunk.length
      ) {
        if (!(await this.loadChunk())) return false;
      }
      const length = this.chunk[this.position++ - this.chunkStart];
      if (length === undefined) return false;
      if (length === 0) return true;
      if (this.position + length > this.file.size) return false;
      this.position += length;
    }
    return false;
  }
}

function dataUrlBytes(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).byteLength;
}

function estimatedDataUrlBytes(file: File): number {
  const mimeType = file.type || "application/octet-stream";
  return `data:${mimeType};base64,`.length + 4 * Math.ceil(file.size / 3);
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

async function readGifMetadata(file: File): Promise<ImageMetadata | null> {
  const reader = new FileByteReader(file);
  const signature = await reader.readString(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  const width = await reader.readUint16LE();
  const height = await reader.readUint16LE();
  const packed = await reader.readByte();
  if (width === null || height === null || packed === null) return null;
  if (!reader.skip(2)) return null;
  if (packed & 0x80) {
    const colorTableBytes = 3 * 2 ** ((packed & 0x07) + 1);
    if (!reader.skip(colorTableBytes)) return null;
  }

  let frameCount = 0;
  while (reader.offset < file.size) {
    const marker = await reader.readByte();
    if (marker === 0x3b) {
      return { format: "gif", width, height, animated: frameCount > 1 };
    }
    if (marker === 0x21) {
      if (
        (await reader.readByte()) === null ||
        !(await reader.skipSubBlocks())
      ) {
        return null;
      }
      continue;
    }
    if (marker !== 0x2c || !reader.skip(8)) return null;

    const imagePacked = await reader.readByte();
    if (imagePacked === null) return null;
    if (imagePacked & 0x80) {
      const colorTableBytes = 3 * 2 ** ((imagePacked & 0x07) + 1);
      if (!reader.skip(colorTableBytes)) return null;
    }
    if ((await reader.readByte()) === null || !(await reader.skipSubBlocks())) {
      return null;
    }

    frameCount++;
    if (frameCount > 1) {
      return { format: "gif", width, height, animated: true };
    }
  }

  return null;
}

async function readJpegMetadata(file: File): Promise<ImageMetadata | null> {
  const bytes = new Uint8Array(
    await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) return null;

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2) return null;
    offset += 2;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7 || offset + 5 > bytes.length) return null;
      const height = readUint16BE(bytes, offset + 1);
      const width = readUint16BE(bytes, offset + 3);
      return { format: "jpeg", width, height, animated: false };
    }
    if (marker === 0xda) return null;
    offset += segmentLength - 2;
  }

  return null;
}

async function readPngMetadata(file: File): Promise<ImageMetadata | null> {
  const bytes = new Uint8Array(await file.slice(0, 26).arrayBuffer());
  if (
    bytes.length < 26 ||
    bytes[0] !== 0x89 ||
    String.fromCharCode(...bytes.slice(1, 4)) !== "PNG" ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null;
  }

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  const reader = new FileByteReader(file);
  if (width <= 0 || height <= 0 || !reader.skip(8)) return null;

  let animated = false;
  while (reader.offset + 8 <= file.size) {
    if (reader.offset > MAX_PNG_METADATA_BYTES) return null;
    let chunkHeader = reader.readBufferedBytes(8);
    if (!chunkHeader) {
      if (!(await reader.ensureBuffered())) return null;
      chunkHeader = reader.readBufferedBytes(8) ?? (await reader.readBytes(8));
    }
    if (!chunkHeader || chunkHeader.length !== 8) {
      return null;
    }
    const chunkLength = readUint32BE(chunkHeader, 0);
    const chunkType = String.fromCharCode(...chunkHeader.subarray(4, 8));
    if (chunkLength > file.size - reader.offset - 4) return null;
    if (chunkType === "acTL") animated = true;
    if (chunkType === "IDAT") {
      return { format: "png", width, height, animated };
    }
    if (chunkType === "IEND") {
      return { format: "png", width, height, animated };
    }
    if (!reader.skip(chunkLength + 4)) return null;
  }

  return null;
}

async function readWebpMetadata(file: File): Promise<ImageMetadata | null> {
  const reader = new FileByteReader(file);
  if ((await reader.readString(4)) !== "RIFF") return null;
  const riffSize = await reader.readUint32LE();
  if ((await reader.readString(4)) !== "WEBP" || riffSize === null) return null;

  let width = 0;
  let height = 0;
  let animated = false;
  while (reader.offset + 8 <= Math.min(file.size, riffSize + 8)) {
    const chunkType = await reader.readString(4);
    const chunkSize = await reader.readUint32LE();
    if (!chunkType || chunkSize === null) return null;

    let consumed = 0;
    if (chunkType === "VP8X") {
      const data = await reader.readBytes(Math.min(chunkSize, 10));
      if (!data || data.length < 10) return null;
      animated ||= (data[0] & 0x02) !== 0;
      width = 1 + readUint24LE(data, 4);
      height = 1 + readUint24LE(data, 7);
      consumed = data.length;
    } else if (chunkType === "VP8 ") {
      const data = await reader.readBytes(Math.min(chunkSize, 10));
      if (!data || data.length < 10) return null;
      if (data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
        width = readUint16LE(data, 6) & 0x3fff;
        height = readUint16LE(data, 8) & 0x3fff;
      }
      consumed = data.length;
    } else if (chunkType === "VP8L") {
      const data = await reader.readBytes(Math.min(chunkSize, 5));
      if (!data || data.length < 5 || data[0] !== 0x2f) return null;
      width = 1 + data[1] + ((data[2] & 0x3f) << 8);
      height = 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10);
      consumed = data.length;
    } else if (chunkType === "ANIM" || chunkType === "ANMF") {
      animated = true;
    }

    if (!reader.skip(chunkSize - consumed)) return null;
    if (chunkSize & 1 && !reader.skip(1)) return null;
  }

  if (!width || !height) return null;
  return { format: "webp", width, height, animated };
}

async function readImageMetadata(file: File): Promise<ImageMetadata | null> {
  const prefix = new Uint8Array(
    await file.slice(0, Math.min(file.size, 12)).arrayBuffer(),
  );
  if (String.fromCharCode(...prefix.slice(0, 3)) === "GIF") {
    return readGifMetadata(file);
  }
  if (
    prefix[0] === 0x89 &&
    String.fromCharCode(...prefix.slice(1, 4)) === "PNG"
  ) {
    return readPngMetadata(file);
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8) {
    return readJpegMetadata(file);
  }
  if (String.fromCharCode(...prefix.slice(0, 4)) === "RIFF") {
    return readWebpMetadata(file);
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function fileExtensionForImageType(type: string): string {
  switch (type) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    default:
      return "jpg";
  }
}

function optimizedImageName(name: string, type: string): string {
  const stem = name.replace(/\.[^.]*$/, "") || "image";
  return `${stem}.${fileExtensionForImageType(type)}`;
}

function originalImageExtension(type: string): string | null {
  switch (type.split(";", 1)[0]?.trim().toLowerCase()) {
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function withSupportedImageExtension(file: File): File {
  const extension = originalImageExtension(file.type);
  if (!extension) return file;
  const nameParts = file.name.split(".");
  const currentExtension = nameParts[nameParts.length - 1]?.toLowerCase();
  const allowedExtensions = extension === "jpg" ? ["jpg", "jpeg"] : [extension];
  if (currentExtension && allowedExtensions.includes(currentExtension)) {
    return file;
  }
  const stem = file.name.replace(/\.[^.]*$/, "") || "image";
  return new File([file], `${stem}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

function outputTypesForFormat(format: ImageFormat): string[] {
  return format === "jpeg"
    ? ["image/webp", "image/jpeg", "image/png"]
    : ["image/webp", "image/png"];
}

export async function preparePromptImageAttachment(
  file: File,
  maxDataUrlBytes: number,
): Promise<PreparedPromptImage | null> {
  if (!isVisualImageAttachment(file)) return null;

  const originalFile = withSupportedImageExtension(file);
  if (
    isSupportedChatImageType(originalFile.type) &&
    estimatedDataUrlBytes(originalFile) <= maxDataUrlBytes
  ) {
    const dataUrl = await readFileDataUrl(originalFile);
    if (dataUrl && dataUrlBytes(dataUrl) <= maxDataUrlBytes) {
      return { file: originalFile, dataUrl };
    }
  }

  let metadata: ImageMetadata | null;
  try {
    metadata = await readImageMetadata(file);
  } catch (error) {
    throw new PromptImageOptimizationError(
      "invalid-or-unsupported-image",
      error,
    );
  }
  if (!metadata) {
    throw new PromptImageOptimizationError("invalid-or-unsupported-image");
  }
  if (metadata.animated) {
    throw new PromptImageOptimizationError(
      "animated-image-exceeds-data-url-budget",
    );
  }
  if (
    metadata.width <= 0 ||
    metadata.height <= 0 ||
    metadata.width > MAX_IMAGE_DECODE_DIMENSION ||
    metadata.height > MAX_IMAGE_DECODE_DIMENSION ||
    metadata.width * metadata.height > MAX_IMAGE_DECODE_PIXELS
  ) {
    throw new PromptImageOptimizationError(
      "image-resolution-exceeds-safety-limit",
    );
  }

  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof HTMLCanvasElement === "undefined" ||
    typeof HTMLCanvasElement.prototype.toBlob !== "function"
  ) {
    throw new PromptImageOptimizationError("image-optimization-unavailable");
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch (error) {
    throw new PromptImageOptimizationError(
      "image-optimization-unavailable",
      error,
    );
  }
  let image: HTMLImageElement | null = null;
  try {
    try {
      image = await loadImage(objectUrl);
    } catch (error) {
      throw new PromptImageOptimizationError("image-decode-failed", error);
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new PromptImageOptimizationError("image-decode-failed");
    }

    for (const pass of IMAGE_COMPRESSION_PASSES) {
      const ratio = Math.min(
        pass.maxDimension / image.naturalWidth,
        pass.maxDimension / image.naturalHeight,
        1,
      );
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new PromptImageOptimizationError(
          "image-optimization-unavailable",
        );
      }
      context.drawImage(image, 0, 0, width, height);

      for (const type of outputTypesForFormat(metadata.format)) {
        const blob = await canvasToBlob(canvas, type, pass.quality);
        if (!blob) continue;
        const mediaType = blob.type || type;
        const optimizedFile = new File(
          [blob],
          optimizedImageName(file.name, mediaType),
          {
            type: mediaType,
            lastModified: file.lastModified,
          },
        );
        if (estimatedDataUrlBytes(optimizedFile) > maxDataUrlBytes) continue;
        const dataUrl = await readFileDataUrl(optimizedFile);
        if (dataUrl && dataUrlBytes(dataUrl) <= maxDataUrlBytes) {
          return { file: optimizedFile, dataUrl };
        }
      }
    }
  } catch (error) {
    if (error instanceof PromptImageOptimizationError) throw error;
    throw new PromptImageOptimizationError("image-optimization-failed", error);
  } finally {
    if (image) image.src = "";
    URL.revokeObjectURL(objectUrl);
  }

  throw new PromptImageOptimizationError("image-optimization-failed");
}
