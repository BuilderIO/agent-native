import { fail } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
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
