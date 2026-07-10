import { uploadFile } from "@agent-native/core/file-upload";

import {
  assertSafeDecodedFigDocument,
  decodeFig,
  type DecodedFig,
  type DecodedFigImage,
} from "./fig-file-decoder.js";
import { renderHtmlTemplates } from "./fig-file-to-html.js";
import type { ImportedDesignFile } from "./import-design-files.js";
import { normalizeImportedHtmlDocument } from "./import-design-files.js";

const MAX_FIG_NODES = 75_000;
const MAX_FIG_IMAGES = 1_024;
const MAX_FIG_FRAMES = 200;
const MAX_FRAME_HTML_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_HTML_BYTES = 24 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 64 * 1024 * 1024;
const IMAGE_UPLOAD_CONCURRENCY = 4;
const MAX_DURABLE_IMAGE_URL_CHARS = 2_048;

export interface FigFileImportResult {
  files: ImportedDesignFile[];
  warnings: string[];
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
  };
}

type ImageUploader = typeof uploadFile;

function mimeTypeForImage(image: DecodedFigImage): string {
  if (image.ext === "jpg") return "image/jpeg";
  if (image.ext === "png") return "image/png";
  if (image.ext === "webp") return "image/webp";
  if (image.ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function nodeChangesFromDocument(document: unknown): unknown[] {
  if (!document || typeof document !== "object") {
    throw new Error(
      "This .fig variant could not be decoded. Try a Figma link/API import or export the frame as HTML/SVG instead.",
    );
  }
  const nodeChanges = (document as { nodeChanges?: unknown }).nodeChanges;
  if (!Array.isArray(nodeChanges)) {
    throw new Error(
      "This .fig variant does not expose editable node data. Try a Figma link/API import instead.",
    );
  }
  if (nodeChanges.length > MAX_FIG_NODES) {
    throw new Error(".fig document has too many nodes (max 75,000).");
  }
  return nodeChanges;
}

async function uploadEmbeddedImages(
  images: DecodedFigImage[],
  ownerEmail: string,
  uploader: ImageUploader,
): Promise<{
  imageMap: Map<string, string>;
  uploaded: number;
  omitted: number;
  warnings: string[];
}> {
  assertEmbeddedImageBudget(images);

  const imageMap = new Map<string, string>();
  const warnings: string[] = [];
  let omitted = 0;
  let storageUnavailable = false;

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
          if (!uploaded?.url) {
            storageUnavailable = true;
            omitted += 1;
            return;
          }
          if (uploaded.url.length > MAX_DURABLE_IMAGE_URL_CHARS) {
            omitted += 1;
            return;
          }
          imageMap.set(image.hash, uploaded.url);
        } catch {
          omitted += 1;
        }
      }),
    );
  }

  if (omitted > 0) {
    warnings.push(
      `${omitted} embedded image${omitted === 1 ? " was" : "s were"} omitted because file storage was unavailable or rejected the upload. No image bytes were stored in SQL.`,
    );
  }

  return {
    imageMap,
    uploaded: imageMap.size,
    omitted,
    warnings,
  };
}

function assertEmbeddedImageBudget(images: DecodedFigImage[]): void {
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
    uploader?: ImageUploader;
  },
): Promise<FigFileImportResult> {
  assertSafeDecodedFigDocument(decoded.document);
  const nodeChanges = nodeChangesFromDocument(decoded.document);
  assertEmbeddedImageBudget(decoded.images);
  // Render and validate before uploading any extracted images so an invalid or
  // excessively complex document cannot leave orphaned storage objects behind.
  // The upload primitive has no cross-provider delete contract, so validate
  // with worst-case durable URL lengths before performing any writes.
  const worstCaseUrl = `https://invalid.example/${"x".repeat(
    MAX_DURABLE_IMAGE_URL_CHARS - 24,
  )}`;
  const worstCaseImageMap = new Map(
    decoded.images.map((image) => [image.hash, worstCaseUrl]),
  );
  const preliminary = renderHtmlTemplates(decoded.document, {
    imageMap: worstCaseImageMap,
    missingImageUrl: "about:blank",
  });
  validateRenderedFrames(preliminary);
  const images = await uploadEmbeddedImages(
    decoded.images,
    options.ownerEmail,
    options.uploader ?? uploadFile,
  );
  const rendered =
    decoded.images.length === 0
      ? preliminary
      : renderHtmlTemplates(decoded.document, {
          imageMap: images.imageMap,
          // Never persist a data URL or a broken relative link when an image
          // blob could not be uploaded. The warning makes the omission clear.
          missingImageUrl: "about:blank",
        });
  validateRenderedFrames(rendered);

  let totalHtmlBytes = 0;
  const files = rendered.frames.map((frame) => {
    const content = normalizeImportedHtmlDocument(
      frame.html,
      `experimental .fig upload ${options.originalName}`,
    );
    const htmlBytes = Buffer.byteLength(content, "utf8");
    if (htmlBytes > MAX_FRAME_HTML_BYTES) {
      throw new Error(
        `.fig frame "${frame.frameName}" is too complex (generated HTML exceeds 4 MB).`,
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
    // The generic experimental-format caveat is disclosed beside the upload
    // control. Keep this list actionable so a clean import stays a success and
    // only file-specific conversion issues produce warning UI.
    warnings: images.warnings,
    stats: {
      sourceKind: "fig-upload",
      format: decoded.format,
      version: decoded.version,
      pageCount: rendered.pageCount,
      frameCount: rendered.frameCount,
      nodeCount: nodeChanges.length,
      imageCount: decoded.images.length,
      uploadedImageCount: images.uploaded,
      omittedImageCount: images.omitted,
    },
  };
}

function validateRenderedFrames(
  rendered: ReturnType<typeof renderHtmlTemplates>,
): void {
  if (rendered.frames.length === 0) {
    throw new Error(
      "No editable top-level frames were found in this .fig file. Try importing a Figma frame link instead.",
    );
  }
  if (rendered.frames.length > MAX_FIG_FRAMES) {
    throw new Error(".fig document has too many top-level frames (max 200).");
  }
  let total = 0;
  for (const frame of rendered.frames) {
    const bytes = Buffer.byteLength(frame.html, "utf8");
    if (bytes > MAX_FRAME_HTML_BYTES) {
      throw new Error(
        `.fig frame "${frame.frameName}" is too complex (generated HTML exceeds 4 MB).`,
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
  data: Buffer;
  originalName: string;
  ownerEmail: string;
  uploader?: ImageUploader;
}): Promise<FigFileImportResult> {
  const decoded = decodeFig(options.data);
  return convertDecodedFigToEditableHtml(decoded, options);
}
