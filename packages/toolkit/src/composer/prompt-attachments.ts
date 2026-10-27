import type { ComposerTranslate } from "./runtime-adapters.js";

export type AgentPromptAttachmentReadError =
  | "read-failed"
  | "too-large"
  | "not-utf8";

export interface AgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  /** Length of the whole file when `text` holds only its head. */
  totalChars?: number;
  readError?: AgentPromptAttachmentReadError;
  dataUrl?: string;
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatPromptWithAttachments(
  prompt: string,
  attachments: readonly AgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  let remainingChars = AGENT_PROMPT_MAX_TOTAL_TEXT_CHARS;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type
        ? ` type="${escapePromptAttachmentAttribute(attachment.type)}"`
        : "";
      if (attachment.readError) {
        return `<attached-file-error name="${escapePromptAttachmentAttribute(attachment.name)}" code="${escapePromptAttachmentAttribute(attachment.readError)}"${type}${size}>\n${describeAgentPromptAttachmentReadError(attachment.readError)}\n</attached-file-error>`;
      }
      // Only a well-formed base64 image data URL is pasted: it cannot hold
      // "<", so it cannot close its tag or forge prompt text.
      if (attachment.dataUrl && attachment.text === undefined) {
        return `<attached-image name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}>\n${INLINE_IMAGE_DATA_URL.test(attachment.dataUrl) ? attachment.dataUrl : "[The image data was not a valid base64 image data URL, so it was not included.]"}\n</attached-image>`;
      }
      const { body, usedChars } = budgetAttachedFileText(
        attachment,
        remainingChars,
      );
      remainingChars -= usedChars;
      const boundary = attachedFileBoundaryFor(body);
      const boundaryAttr = boundary ? ` boundary="${boundary}"` : "";
      return `<attached-file name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}${boundaryAttr}>\n${body}\n</attached-file${boundaryAttr}>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

/**
 * Caps each file at the inline limit and the whole message at a shared total,
 * on whatever text arrives, so metadata from any caller cannot grow the
 * prompt past what the composer itself would send.
 */
function budgetAttachedFileText(
  attachment: AgentPromptAttachment,
  remainingChars: number,
): { body: string; usedChars: number } {
  if (attachment.text === undefined) {
    return {
      body: "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.",
      usedChars: 0,
    };
  }
  const text = attachment.text;
  const totalChars = Math.max(attachment.totalChars ?? 0, text.length);
  const shown = sliceTextHead(
    text,
    Math.min(AGENT_PROMPT_MAX_INLINE_TEXT_CHARS, Math.max(0, remainingChars)),
  );
  const head = shown.trim();
  // "No visible text" is true only of the whole file; a blank head of a
  // longer file must still say the rest was left out.
  if (shown.length >= totalChars) {
    return {
      body: head || "[The attached file has no visible text.]",
      usedChars: shown.length,
    };
  }
  const note =
    shown.length === 0
      ? `[This file's ${totalChars.toLocaleString()} characters were not attached because this message reached its ${AGENT_PROMPT_MAX_TOTAL_TEXT_CHARS.toLocaleString()}-character limit for attached text, and none of it is available to you. Tell the user up front that you could not read it, and do not report finished work that depends on it.]`
      : `[Only the first ${shown.length.toLocaleString()} of ${totalChars.toLocaleString()} characters of this file were attached, and the rest is not available to you. Tell the user up front that you could read only part of it, and do not report finished work that depends on the rest.]`;
  return { body: head ? `${head}\n\n${note}` : note, usedChars: shown.length };
}

const INLINE_IMAGE_DATA_URL =
  /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/i;

/** Cuts at `end` without leaving half of a surrogate pair at the edge. */
function sliceTextHead(text: string, end: number): string {
  if (end <= 0) return "";
  if (end >= text.length) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

// A file that contains our own tag names could close its envelope early and
// forge prompt text, so it gets a closing tag it cannot know in advance.
function attachedFileBoundaryFor(body: string): string | null {
  if (!/<\/?attached-(?:file|image)/i.test(body)) return null;
  let boundary: string;
  do {
    boundary = Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(6)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } while (body.includes(boundary));
  return boundary;
}

function describeAgentPromptAttachmentReadError(
  code: AgentPromptAttachmentReadError,
): string {
  return code === "too-large"
    ? "This file is over the 8 MB limit for reading attachments, so its contents were not sent. Do not infer its contents. Tell the user it is too large to read and ask for a smaller file."
    : code === "not-utf8"
      ? "This file is not UTF-8 text, so its contents were not sent. Do not infer its contents. Tell the user it could not be read and ask them to save it as UTF-8 and attach it again."
      : "The browser could not read this file, so its contents were not sent. Do not infer its contents. Tell the user it could not be read and ask them to attach it again.";
}

export const AGENT_PROMPT_MAX_INLINE_TEXT_CHARS = 60_000;
export const AGENT_PROMPT_MAX_TOTAL_TEXT_CHARS = 80_000;
/** Matches hosted chat's text hydration cap (core MAX_OWNED_TEXT_FILE_BYTES). */
export const AGENT_PROMPT_MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
export const AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ReadAgentPromptAttachmentOptions {
  maxInlineTextChars?: number;
  maxInlineImageBytes?: number;
  maxImageDimensionPx?: number;
}

const MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OPTIMIZABLE_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;

export async function readAgentPromptAttachment(
  file: File,
  options: ReadAgentPromptAttachmentOptions = {},
): Promise<AgentPromptAttachment> {
  const maxInlineTextChars =
    options.maxInlineTextChars ?? AGENT_PROMPT_MAX_INLINE_TEXT_CHARS;
  const maxInlineImageBytes =
    options.maxInlineImageBytes ?? AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES;
  const maxImageDimensionPx = options.maxImageDimensionPx ?? 2048;
  const attachment: AgentPromptAttachment = {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
  };

  if (isInlineableAgentPromptFile(file)) {
    if (file.size > AGENT_PROMPT_MAX_TEXT_FILE_BYTES) {
      attachment.readError = "too-large";
      return attachment;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      attachment.readError = "read-failed";
      return attachment;
    }
    // Chat without file storage only sends images inline as data URLs, so an
    // SVG keeps one even when its text is unreadable; the server then reports
    // that instead of the send failing for want of storage.
    if (isSvgFile(file) && file.size <= maxInlineImageBytes) {
      try {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } catch {
        // coercion-ok: this is only the inline image copy; the text read below reports its own outcome.
      }
    }
    // File.text() replaces bad bytes with U+FFFD, which would send a mangled
    // file as if it had been read faithfully.
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      attachment.readError = "not-utf8";
      return attachment;
    }
    attachment.text = sliceTextHead(text, maxInlineTextChars);
    if (text.length > maxInlineTextChars) attachment.totalChars = text.length;
  } else if (file.type.startsWith("image/")) {
    try {
      if (file.size <= maxInlineImageBytes) {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } else if (isRasterImageMediaType(file.type)) {
        const optimized = await optimizeAgentPromptImage(file, {
          maxBytes: maxInlineImageBytes,
          maxDimensionPx: maxImageDimensionPx,
        });
        if (optimized) {
          attachment.type = optimized.type;
          attachment.dataUrl = await readBlobAsDataUrl(optimized);
        }
      }
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  }

  return attachment;
}

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

const TEXT_APPLICATION_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/typescript",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  "message/rfc822",
]);

// Keep in step with core's isTextLikeMimeType / isTextLikeFilename, which
// decide what hosted chat reads as text.
export function isInlineableAgentPromptFile(file: File): boolean {
  const [baseType = ""] = file.type.split(";");
  const type = baseType.trim().toLowerCase();
  if (type.startsWith("text/") || TEXT_APPLICATION_TYPES.has(type)) return true;
  if (type.endsWith("+json") || type.endsWith("+xml")) return true;
  if (isSvgFile(file)) return true;
  return /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|yaml|yml|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|cs|swift|kt|sh|bash|zsh|fish|toml|ini|cfg|conf|xml|svg|html|htm|css|scss|sass|less|sql|graphql|gql|eml)$/i.test(
    file.name,
  );
}

/**
 * Images past these limits cannot be shrunk in the browser, so they are refused
 * at attach time; otherwise they fall back to a normal upload and the failure
 * surfaces at send time with the wrong reason.
 */
export async function getUnshrinkableImageError(
  file: File,
  translate: ComposerTranslate,
): Promise<string | null> {
  if (!isRasterImageMediaType(file.type)) return null;
  if (file.size > MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES) {
    const limit = MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES / 1024 / 1024;
    return translate("agentChat.composer.imageTooLargeToAttach", {
      defaultValue:
        '"{{name}}" is {{size}} MB - images over {{limit}} MB cannot be attached. Please use a smaller image.',
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(1),
      limit,
    });
  }
  const dimensions = await readRasterImageDimensions(file);
  if (
    dimensions &&
    dimensions.width * dimensions.height > MAX_OPTIMIZABLE_IMAGE_PIXELS
  ) {
    const limit = MAX_OPTIMIZABLE_IMAGE_PIXELS / 1_000_000;
    return translate("agentChat.composer.imageTooManyPixelsToAttach", {
      defaultValue:
        '"{{name}}" is {{megapixels}} megapixels - images over {{limit}} megapixels cannot be attached. Please use a smaller image.',
      name: file.name,
      megapixels: ((dimensions.width * dimensions.height) / 1_000_000).toFixed(
        1,
      ),
      limit,
    });
  }
  return null;
}

/**
 * What the composer chip shows before send, using the same checks as the read.
 * The size check above bounds this full decode at 8 MB, so the chip never
 * clears a file the send-time read will reject.
 */
export async function probeAgentPromptAttachment(
  file: File,
): Promise<AgentPromptAttachmentReadError | null> {
  if (!isInlineableAgentPromptFile(file)) return null;
  if (file.size > AGENT_PROMPT_MAX_TEXT_FILE_BYTES) return "too-large";
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return "read-failed";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return null;
  } catch {
    return "not-utf8";
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

const RASTER_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isRasterImageMediaType(mediaType: string): boolean {
  return RASTER_IMAGE_TYPES.has(
    mediaType.split(";", 1)[0]!.trim().toLowerCase(),
  );
}

async function optimizeAgentPromptImage(
  file: File,
  options: { maxBytes: number; maxDimensionPx: number },
): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;

  if (file.size > MAX_OPTIMIZABLE_IMAGE_INPUT_BYTES) return null;
  const dimensions = await readRasterImageDimensions(file);
  if (
    !dimensions ||
    dimensions.width * dimensions.height > MAX_OPTIMIZABLE_IMAGE_PIXELS
  ) {
    return null;
  }

  const scale = Math.min(
    1,
    options.maxDimensionPx / Math.max(dimensions.width, dimensions.height),
  );
  const resizeWidth = Math.max(1, Math.round(dimensions.width * scale));
  const resizeHeight = Math.max(1, Math.round(dimensions.height * scale));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth,
      resizeHeight,
      resizeQuality: "high",
    });
  } catch {
    // coercion-ok: failed resizing keeps the original upload for server hydration or a typed size-limit explanation.
    return null;
  }

  try {
    if (!bitmap.width || !bitmap.height) return null;
    let scale = Math.min(
      1,
      options.maxDimensionPx / Math.max(bitmap.width, bitmap.height),
    );
    const minScale = Math.min(
      scale,
      256 / Math.max(bitmap.width, bitmap.height),
    );

    while (scale >= minScale) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const png = await canvasToBlob(canvas, "image/png");
      if (png && png.size <= options.maxBytes) return png;

      context.save();
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
      const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.9);
      if (jpeg && jpeg.size <= options.maxBytes) return jpeg;

      if (scale === minScale) break;
      scale = Math.max(minScale, scale * 0.8);
    }
    return null;
  } finally {
    bitmap.close();
  }
}

async function readRasterImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(
    await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const dimensions = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(1, 3) === "PNG" &&
    ascii(12, 4) === "IHDR"
  ) {
    return dimensions(view.getUint32(16), view.getUint32(20));
  }

  if (
    bytes.length >= 10 &&
    (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")
  ) {
    return dimensions(view.getUint16(6, true), view.getUint16(8, true));
  }

  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
      return dimensions(width, height);
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      const bits =
        bytes[21]! +
        (bytes[22]! << 8) +
        (bytes[23]! << 16) +
        (bytes[24]! << 24);
      return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a &&
      bytes.length >= 30
    ) {
      const width = (view.getUint16(26, true) & 0x3fff) + 0;
      const height = (view.getUint16(28, true) & 0x3fff) + 0;
      return dimensions(width, height);
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    let jpegDimensions: { width: number; height: number } | null = null;
    let orientation = 1;
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset + 1] === 0xff) offset += 1;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if (marker === 0xe1) {
        const exifOrientation = readJpegExifOrientation(
          bytes,
          view,
          offset,
          segmentLength,
        );
        if (exifOrientation === null) return null;
        if (exifOrientation !== undefined) orientation = exifOrientation;
      }
      if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
        jpegDimensions = dimensions(
          view.getUint16(offset + 7),
          view.getUint16(offset + 5),
        );
      }
      offset += 2 + segmentLength;
    }
    if (jpegDimensions) {
      return orientation >= 5 && orientation <= 8
        ? dimensions(jpegDimensions.height, jpegDimensions.width)
        : jpegDimensions;
    }
  }

  return null;
}

function readJpegExifOrientation(
  bytes: Uint8Array,
  view: DataView,
  markerOffset: number,
  segmentLength: number,
): number | null | undefined {
  const segmentEnd = markerOffset + 2 + segmentLength;
  const exifOffset = markerOffset + 4;
  if (exifOffset + 4 > segmentEnd) return undefined;
  if (
    bytes[exifOffset] !== 0x45 ||
    bytes[exifOffset + 1] !== 0x78 ||
    bytes[exifOffset + 2] !== 0x69 ||
    bytes[exifOffset + 3] !== 0x66
  ) {
    return undefined;
  }
  if (
    exifOffset + 6 > segmentEnd ||
    bytes[exifOffset + 4] !== 0x00 ||
    bytes[exifOffset + 5] !== 0x00
  ) {
    return null;
  }

  const tiffOffset = exifOffset + 6;
  if (tiffOffset + 8 > segmentEnd) return null;
  const littleEndian =
    bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49;
  if (
    !littleEndian &&
    !(bytes[tiffOffset] === 0x4d && bytes[tiffOffset + 1] === 0x4d)
  ) {
    return null;
  }
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return null;

  const relativeIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
  if (relativeIfdOffset < 8) return null;
  const ifdOffset = tiffOffset + relativeIfdOffset;
  if (ifdOffset + 2 > segmentEnd) return null;
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const entriesStart = ifdOffset + 2;
  if (entriesStart + entryCount * 12 > segmentEnd) return null;

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesStart + index * 12;
    if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
      if (
        view.getUint16(entryOffset + 2, littleEndian) !== 3 ||
        view.getUint32(entryOffset + 4, littleEndian) !== 1
      ) {
        return null;
      }
      const orientation = view.getUint16(entryOffset + 8, littleEndian);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }

  return 1;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch (error) {
      reject(error);
    }
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read optimized image"));
    reader.readAsDataURL(blob);
  });
}
