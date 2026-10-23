import { fail } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import {
  DEFAULT_PPTX_IMAGE_BYTE_LIMITS,
  type PptxImageByteLimits,
} from "@agent-native/core/ingestion";
import { nanoid } from "nanoid";

import { SOURCE_IMPORT_NO_WRITE_ERROR_CODE } from "../../../shared/source-import-errors.js";
import { storeLocalImportedAsset } from "../../lib/import-asset-storage.js";
import type { ImportedAssetUpload } from "../../lib/imported-asset-batch.js";
import type { ParsedElement, ParsedSlide } from "./pptx-parser.js";

const BROWSER_RENDERABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);
export const MAX_PPTX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PPTX_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024;

function assertPptxImageBytesWithinLimits(slides: readonly ParsedSlide[]) {
  let totalBytes = 0;
  for (const slide of slides) {
    for (const element of slide.elements ?? []) {
      if (element.kind !== "image" || !element.image) continue;
      const bytes = element.image.data.byteLength;
      if (bytes > MAX_PPTX_IMAGE_BYTES) {
        fail(
          `Source-faithful PPTX import cannot preserve an image above the ${MAX_PPTX_IMAGE_BYTES / 1024 / 1024} MB limit. No images were uploaded.`,
          { errorCode: "pptx_image_size_limit", statusCode: 413 },
        );
      }
      if (bytes > MAX_PPTX_IMAGES_TOTAL_BYTES - totalBytes) {
        fail(
          `Source-faithful PPTX import cannot preserve images above the ${MAX_PPTX_IMAGES_TOTAL_BYTES / 1024 / 1024} MB total limit. No images were uploaded.`,
          { errorCode: "pptx_image_size_limit", statusCode: 413 },
        );
      }
      totalBytes += bytes;
    }
  }
}

export function assertPptxImagesRenderable(
  slides: readonly ParsedSlide[],
): void {
  const unsupported = new Set<string>();
  for (const slide of slides) {
    for (const element of slide.elements ?? []) {
      if (element.kind !== "image" || !element.image) continue;
      if (!BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(element.image.mimeType)) {
        unsupported.add(element.image.mimeType || "unknown");
      }
    }
  }
  if (unsupported.size > 0) {
    fail(
      `Source-faithful PPTX import cannot preserve unsupported image type(s): ${[...unsupported].join(", ")}. No images were uploaded. Re-export the deck with browser-renderable images or use a PDF export for page-faithful preservation.`,
      { errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE },
    );
  }
  assertPptxImageBytesWithinLimits(slides);
}

export function assertPptxImageByteLimits(
  slides: readonly ParsedSlide[],
  limits: Readonly<PptxImageByteLimits> = DEFAULT_PPTX_IMAGE_BYTE_LIMITS,
): void {
  let totalBytes = 0;
  for (const slide of slides) {
    for (const element of slide.elements ?? []) {
      if (element.kind !== "image" || !element.image) continue;
      const imageBytes = element.image.data.byteLength;
      if (
        imageBytes > limits.maxImageBytes ||
        totalBytes + imageBytes > limits.maxTotalImageBytes
      ) {
        fail(
          "Slides could not read this PowerPoint file. No slides were written to the deck.",
          {
            errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
            statusCode: 413,
          },
        );
      }
      totalBytes += imageBytes;
    }
  }
}

export async function uploadPptxSlideImages(args: {
  slide: ParsedSlide;
  slideIndex: number;
  ownerEmail: string;
  onUploaded?: (asset: ImportedAssetUpload) => void;
}): Promise<{
  urls: Record<string, string>;
  assets: Record<string, ImportedAssetUpload>;
  imageSkippedCount: number;
}> {
  const imageElements = (args.slide.elements ?? []).filter(
    (
      element,
    ): element is ParsedElement & {
      kind: "image";
      image: NonNullable<ParsedElement["image"]>;
    } => element.kind === "image" && Boolean(element.image),
  );
  assertPptxImageBytesWithinLimits([args.slide]);
  const urls: Record<string, string> = {};
  const assets: Record<string, ImportedAssetUpload> = {};

  for (const [imageIndex, element] of imageElements.entries()) {
    const image = element.image;
    if (!BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(image.mimeType)) continue;
    const filename = `pptx-import-${Date.now()}-s${args.slideIndex}-i${imageIndex}-${image.name}`;
    let uploadedAsset:
      | { url: string; provider: string; providerObjectId: string | null }
      | undefined;
    try {
      const result = await uploadFile({
        data: Buffer.from(image.data),
        filename,
        mimeType: image.mimeType,
        ownerEmail: args.ownerEmail,
        recordAsset: false,
      });
      if (result?.url) {
        uploadedAsset = {
          url: result.url,
          provider: result.provider,
          providerObjectId: result.id ?? null,
        };
      }
    } catch {
      uploadedAsset = undefined;
    }

    if (!uploadedAsset) {
      const localAsset = await storeLocalImportedAsset({
        email: args.ownerEmail,
        filename,
        mimeType: image.mimeType,
        data: image.data,
      });
      if (localAsset) {
        uploadedAsset = {
          url: localAsset.url,
          provider: localAsset.provider,
          providerObjectId: localAsset.id,
        };
      }
    }
    if (uploadedAsset) {
      const asset: ImportedAssetUpload = {
        assetId: nanoid(),
        filename: image.name,
        url: uploadedAsset.url,
        mimeType: image.mimeType,
        size: image.data.byteLength,
        provider: uploadedAsset.provider,
        providerObjectId: uploadedAsset.providerObjectId,
      };
      urls[element.id] = asset.url;
      assets[element.id] = asset;
      args.onUploaded?.(asset);
    }
  }

  return {
    urls,
    assets,
    imageSkippedCount: Math.max(
      0,
      imageElements.length - Object.keys(urls).length,
    ),
  };
}
