/**
 * Decode a `.fig` into editable frames. Isomorphic on purpose: the decoder and
 * the kiwi walker no longer need Node, so this runs in the browser too, and a
 * `.fig` decoded there never has to be uploaded past Netlify's ~6MB request
 * cap. The two things that DO differ between a server and a browser -- where an
 * image is stored and how a document is wrapped -- are injected.
 */

import {
  assertSafeDecodedFigDocument,
  decodeFig,
  type DecodedFig,
  type DecodedFigImage,
} from "../server/lib/fig-file-decoder.js";
import {
  collectTopLevelFrames,
  guidKey,
  imageSizeFromUnknownBytes,
  renderHtmlTemplates,
  type FigNode,
} from "../server/lib/fig-file-to-html.js";
import type { ImportedDesignFile } from "../server/lib/import-design-files.js";
import { utf8ByteLength } from "./fig-bytes.js";

const MAX_FIG_NODES = 75_000;
const MAX_FIG_IMAGES = 1_024;
const MAX_FIG_FRAMES = 300;
const MAX_FRAME_HTML_BYTES = 4 * 1024 * 1024;
/** The browser action transport accepts smaller per-frame payloads. */
export const MAX_FIG_FRAME_HTML_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_HTML_BYTES = 24 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 64 * 1024 * 1024;
const IMAGE_UPLOAD_CONCURRENCY = 4;
const MAX_DURABLE_IMAGE_URL_CHARS = 2_048;

export interface FigFileImportResult {
  files: ImportedDesignFile[];
  warnings: string[];
  cleanup?: () => Promise<number>;
  finalize?: () => Promise<number>;
  stats: {
    sourceKind: "fig-upload";
    format: "kiwi" | "zip";
    version?: number;
    pageCount: number;
    frameCount: number;
    nodeCount: number;
    imageCount: number;
    uploadedImageCount: number;
    omittedImageCount: number;
    approximatedNodeCount: number;
    unresolvedImageRefCount: number;
  };
}

export interface FigImportFrameSummary {
  id: string;
  pageName: string;
  frameName: string;
  width?: number;
  height?: number;
}

export interface FigImportSummary {
  pageCount: number;
  frameCount: number;
  nodeCount: number;
  imageCount: number;
  frames: FigImportFrameSummary[];
}

/**
 * Stores one image and returns where it landed, or null when storage is
 * unavailable. Injected rather than imported so this module stays isomorphic:
 * the server passes core's `uploadFile`, the browser passes a call to the
 * `upload-image` action.
 */
export type ImageUploader = (input: {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  ownerEmail: string;
  recordAsset?: boolean;
  stableUrl?: boolean;
}) => Promise<{
  url?: string;
  cleanup?: () => Promise<boolean>;
  finalize?: () => Promise<boolean>;
} | null>;

/** Wraps a frame's HTML into a standalone document. */
export type HtmlNormalizer = (content: string, sourceLabel: string) => string;

function mimeTypeForImage(image: DecodedFigImage): string {
  if (image.ext === "jpg") return "image/jpeg";
  if (image.ext === "png") return "image/png";
  if (image.ext === "webp") return "image/webp";
  if (image.ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function nodeChangesFromDocument(
  document: unknown,
  decodeError?: string,
): unknown[] {
  if (!document || typeof document !== "object") {
    const detail = decodeError ? ` Decode detail: ${decodeError}.` : "";
    throw new Error(
      `This .fig file could not be decoded.${detail} The schema format may have changed since this file was saved, or the file may be a newer Figma version. Try: (1) copy the frame in Figma and paste directly onto the Design canvas — no API quota needed, or (2) use a Figma frame link to import via the API.`,
    );
  }
  const nodeChanges = (document as { nodeChanges?: unknown }).nodeChanges;
  if (!Array.isArray(nodeChanges)) {
    throw new Error(
      "This .fig file decoded but does not contain editable node data. Copy the frame in Figma and paste onto the canvas, or use a Figma frame link to import via the API.",
    );
  }
  if (nodeChanges.length > MAX_FIG_NODES) {
    throw new Error(".fig document has too many nodes (max 75,000).");
  }
  return nodeChanges;
}

export function inspectDecodedFig(decoded: DecodedFig): FigImportSummary {
  assertSafeDecodedFigDocument(decoded.document);
  const nodeChanges = nodeChangesFromDocument(
    decoded.document,
    decoded.decodeError,
  ) as FigNode[];
  assertEmbeddedImageBudget(decoded.images);

  const childrenOf = new Map<string, FigNode[]>();
  for (const node of nodeChanges) {
    const parentKey = guidKey(node.parentIndex?.guid);
    if (!parentKey) continue;
    const children = childrenOf.get(parentKey) ?? [];
    children.push(node);
    childrenOf.set(parentKey, children);
  }

  const documentNode = nodeChanges.find((node) => node.type === "DOCUMENT");
  const pages = (
    documentNode ? (childrenOf.get(guidKey(documentNode.guid)) ?? []) : []
  ).filter((node) => node.type === "CANVAS" && !node.internalOnly);
  const frames = pages.flatMap((page, pageIndex) =>
    collectTopLevelFrames(page, childrenOf).map((frame, frameIndex) => ({
      id: guidKey(frame.guid),
      pageName: page.name ?? `Page ${pageIndex + 1}`,
      frameName: frame.name ?? `Frame ${frameIndex + 1}`,
      width: frame.size?.x,
      height: frame.size?.y,
    })),
  );

  return {
    pageCount: pages.length,
    frameCount: frames.length,
    nodeCount: nodeChanges.length,
    imageCount: decoded.images.length,
    frames,
  };
}

const LARGE_FIG_WARNING_BYTES = 10 * 1024 * 1024;
const LARGE_FIG_WARNING_FRAMES = 12;
const LARGE_FIG_WARNING_NODES = 10_000;
const LARGE_FIG_WARNING_IMAGES = 64;

export function shouldWarnForFigImport(
  fileBytes: number,
  summary: FigImportSummary,
): boolean {
  if (summary.frameCount === 0) return false;
  return (
    fileBytes >= LARGE_FIG_WARNING_BYTES ||
    summary.frameCount >= LARGE_FIG_WARNING_FRAMES ||
    summary.nodeCount >= LARGE_FIG_WARNING_NODES ||
    summary.imageCount >= LARGE_FIG_WARNING_IMAGES
  );
}

async function uploadEmbeddedImages(
  images: DecodedFigImage[],
  ownerEmail: string,
  uploader: ImageUploader,
): Promise<{
  imageMap: Map<string, string>;
  imageSizes: Map<string, { width: number; height: number }>;
  uploaded: number;
  omitted: number;
  warnings: string[];
  cleanup: () => Promise<number>;
  finalize: () => Promise<number>;
}> {
  assertEmbeddedImageBudget(images);

  const imageMap = new Map<string, string>();
  // Sized from the BYTES, here, while we still hold them. The renderer used to
  // read intrinsic size back out of the fill's URL, which only ever matched a
  // `data:` URL — and every production caller passes an uploaded https URL, so
  // TILE sizing and nearest-neighbour magnification were dead outside the
  // measurement harness. An undecodable container (WebP, GIF) stays absent,
  // which the renderer reads as "cannot tell" rather than as a size.
  const imageSizes = new Map<string, { width: number; height: number }>();
  for (const image of images) {
    const size = imageSizeFromUnknownBytes(image.bytes);
    if (size && size.width > 0 && size.height > 0)
      imageSizes.set(image.hash, size);
  }
  let omitted = 0;
  let storageUnavailable = false;
  const uploadCleanups: Array<() => Promise<boolean>> = [];
  const uploadFinalizers: Array<() => Promise<boolean>> = [];

  for (
    let offset = 0;
    offset < images.length;
    offset += IMAGE_UPLOAD_CONCURRENCY
  ) {
    const batch = images.slice(offset, offset + IMAGE_UPLOAD_CONCURRENCY);
    if (storageUnavailable) {
      omitted += batch.length;
      continue;
    }
    await Promise.all(
      batch.map(async (image) => {
        try {
          const uploaded = await uploader({
            data: image.bytes,
            filename: `figma-${image.hash}.${image.ext}`,
            mimeType: mimeTypeForImage(image),
            ownerEmail,
            recordAsset: false,
            stableUrl: true,
          });
          if (uploaded?.cleanup) uploadCleanups.push(uploaded.cleanup);
          if (uploaded?.finalize) uploadFinalizers.push(uploaded.finalize);
          if (!uploaded?.url) {
            storageUnavailable = true;
            omitted += 1;
            return;
          }
          if (uploaded.url.length > MAX_DURABLE_IMAGE_URL_CHARS) {
            storageUnavailable = true;
            omitted += 1;
            return;
          }
          imageMap.set(image.hash, uploaded.url);
        } catch {
          storageUnavailable = true;
          omitted += 1;
        }
      }),
    );
  }

  return {
    imageMap,
    imageSizes,
    uploaded: imageMap.size,
    omitted,
    warnings: [],
    cleanup: () => cleanupUploadedImages(uploadCleanups),
    finalize: () => finalizeUploadedImages(uploadFinalizers),
  };
}

async function cleanupUploadedImages(
  cleanups: Array<() => Promise<boolean>>,
): Promise<number> {
  const results = await Promise.allSettled(
    cleanups.map((cleanup) => cleanup()),
  );
  return results.filter(
    (result) => result.status === "rejected" || !result.value,
  ).length;
}

async function finalizeUploadedImages(
  finalizers: Array<() => Promise<boolean>>,
): Promise<number> {
  const results = await Promise.allSettled(
    finalizers.map((finalize) => finalize()),
  );
  return results.filter(
    (result) => result.status === "rejected" || !result.value,
  ).length;
}

function withCleanupFailures(message: string, failures: number): string {
  if (failures === 0) return message;
  return `${message} Storage cleanup failed for ${failures} uploaded image${failures === 1 ? "" : "s"}.`;
}

export function assertEmbeddedImageBudget(images: DecodedFigImage[]): void {
  if (images.length > MAX_FIG_IMAGES) {
    throw new Error(".fig document has too many embedded images (max 1,024).");
  }
  const totalImageBytes = images.reduce(
    (total, image) => total + image.bytes.byteLength,
    0,
  );
  if (totalImageBytes > MAX_EMBEDDED_IMAGE_BYTES) {
    throw new Error(
      ".fig document has too much embedded image data (max 64 MB).",
    );
  }
}

export async function convertDecodedFigToEditableHtml(
  decoded: DecodedFig,
  options: {
    originalName: string;
    ownerEmail: string;
    uploader: ImageUploader;
    normalizeHtml: HtmlNormalizer;
    maxFrameHtmlBytes?: number;
    selection?: ReadonlySet<string>;
  },
): Promise<FigFileImportResult> {
  const maxFrameHtmlBytes = options.maxFrameHtmlBytes ?? MAX_FRAME_HTML_BYTES;
  assertSafeDecodedFigDocument(decoded.document);
  const nodeChanges = nodeChangesFromDocument(
    decoded.document,
    decoded.decodeError,
  );
  assertEmbeddedImageBudget(decoded.images);

  // Providers may not support deletion, so validate the document before any
  // uploads and compensate completed writes when a later import step fails.
  const worstCaseUrl = `https://invalid.example/${"x".repeat(
    MAX_DURABLE_IMAGE_URL_CHARS - 24,
  )}`;
  const worstCaseImageMap = new Map(
    decoded.images.map((image) => [image.hash, worstCaseUrl]),
  );
  const selection =
    options.selection && options.selection.size > 0
      ? new Set(options.selection)
      : undefined;
  const preliminary = renderHtmlTemplates(decoded.document, {
    imageMap: selection ? new Map() : worstCaseImageMap,
    missingImageUrl: "about:blank",
    trackUnresolvedImageRefs: true,
    selection,
  });
  validateRenderedFrames(preliminary, maxFrameHtmlBytes);
  const imagesToUpload = selection
    ? decoded.images.filter((image) =>
        preliminary.unresolvedImageRefs?.has(image.hash),
      )
    : decoded.images;
  let images: Awaited<ReturnType<typeof uploadEmbeddedImages>> | undefined;
  try {
    const uploadedImages = await uploadEmbeddedImages(
      imagesToUpload,
      options.ownerEmail,
      options.uploader,
    );
    images = uploadedImages;
    if (uploadedImages.omitted > 0) {
      throw new Error(
        `${uploadedImages.omitted} embedded image${uploadedImages.omitted === 1 ? " was" : "s were"} omitted because file storage was unavailable or rejected the upload. No image bytes were stored in SQL.`,
      );
    }
    const rendered =
      imagesToUpload.length === 0
        ? preliminary
        : renderHtmlTemplates(decoded.document, {
            imageMap: uploadedImages.imageMap,
            imageSizes: uploadedImages.imageSizes,
            missingImageUrl: "about:blank",
            trackUnresolvedImageRefs: true,
            selection,
          });
    validateRenderedFrames(rendered, maxFrameHtmlBytes);

    let totalHtmlBytes = 0;
    const files = rendered.frames.map((frame) => {
      const content = options.normalizeHtml(
        frame.html,
        `experimental .fig upload ${options.originalName}`,
      );
      const htmlBytes = utf8ByteLength(content);
      if (htmlBytes > maxFrameHtmlBytes) {
        throw new Error(
          `.fig frame "${frame.frameName}" is too complex (generated HTML exceeds ${Math.round(maxFrameHtmlBytes / 1024 / 1024)} MB).`,
        );
      }
      totalHtmlBytes += htmlBytes;
      if (totalHtmlBytes > MAX_TOTAL_HTML_BYTES) {
        throw new Error(
          ".fig import generated too much editable HTML (max 24 MB).",
        );
      }
      return {
        filename: `${frame.pageDirName}-${frame.fileName}`,
        fileType: "html" as const,
        content,
        source: {
          sourceType: "fig-upload",
          originalName: options.originalName,
          figFormat: decoded.format,
          figVersion: decoded.version,
          figPageName: frame.pageName,
          figFrameName: frame.frameName,
          experimental: true,
        },
        preferredFrame: {
          title: frame.frameName,
          width: frame.width,
          height: frame.height,
        },
      } satisfies ImportedDesignFile;
    });

    return {
      files,
      warnings: uploadedImages.warnings,
      cleanup: uploadedImages.cleanup,
      finalize: uploadedImages.finalize,
      stats: {
        sourceKind: "fig-upload",
        format: decoded.format,
        version: decoded.version,
        pageCount: rendered.pageCount,
        frameCount: rendered.frameCount,
        nodeCount: nodeChanges.length,
        imageCount: decoded.images.length,
        uploadedImageCount: uploadedImages.uploaded,
        omittedImageCount: uploadedImages.omitted,
        approximatedNodeCount: rendered.approximatedNodes.length,
        unresolvedImageRefCount: rendered.unresolvedImageRefs?.size ?? 0,
      },
    };
  } catch (error) {
    const cleanupFailures = images ? await images.cleanup() : 0;
    if (cleanupFailures === 0) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withCleanupFailures(message, cleanupFailures));
  }
}

function validateRenderedFrames(
  rendered: ReturnType<typeof renderHtmlTemplates>,
  maxFrameHtmlBytes = MAX_FRAME_HTML_BYTES,
): void {
  if (rendered.frames.length === 0) {
    throw new Error(
      "No editable top-level frames were found in this .fig file.",
    );
  }
  if (rendered.frames.length > MAX_FIG_FRAMES) {
    throw new Error(
      `.fig document has too many top-level frames (max ${MAX_FIG_FRAMES}).`,
    );
  }
  let total = 0;
  for (const frame of rendered.frames) {
    const bytes = utf8ByteLength(frame.html);
    if (bytes > maxFrameHtmlBytes) {
      throw new Error(
        `.fig frame "${frame.frameName}" is too complex (generated HTML exceeds ${Math.round(maxFrameHtmlBytes / 1024 / 1024)} MB).`,
      );
    }
    total += bytes;
    if (total > MAX_TOTAL_HTML_BYTES) {
      throw new Error(
        ".fig import generated too much editable HTML (max 24 MB).",
      );
    }
  }
}

export async function importFigFileToEditableHtml(options: {
  data: Uint8Array;
  originalName: string;
  ownerEmail: string;
  uploader: ImageUploader;
  normalizeHtml: HtmlNormalizer;
  maxFrameHtmlBytes?: number;
}): Promise<FigFileImportResult> {
  const decoded = decodeFig(options.data);
  return convertDecodedFigToEditableHtml(decoded, options);
}
