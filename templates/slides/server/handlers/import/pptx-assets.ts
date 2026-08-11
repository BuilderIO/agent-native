import { uploadFile } from "@agent-native/core/file-upload";

import { storeLocalImportedAsset } from "../../lib/import-asset-storage.js";
import type { ParsedElement, ParsedSlide } from "./pptx-parser.js";

const BROWSER_RENDERABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

export async function uploadPptxSlideImages(args: {
  slide: ParsedSlide;
  slideIndex: number;
  ownerEmail: string;
}): Promise<{ urls: Record<string, string>; imageSkippedCount: number }> {
  const imageElements = (args.slide.elements ?? []).filter(
    (
      element,
    ): element is ParsedElement & {
      kind: "image";
      image: NonNullable<ParsedElement["image"]>;
    } => element.kind === "image" && Boolean(element.image),
  );
  const urls: Record<string, string> = {};

  for (const [imageIndex, element] of imageElements.entries()) {
    const image = element.image;
    if (!BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(image.mimeType)) continue;
    const filename = `pptx-import-${Date.now()}-s${args.slideIndex}-i${imageIndex}-${image.name}`;
    let url: string | undefined;
    try {
      const result = await uploadFile({
        data: Buffer.from(image.data),
        filename,
        mimeType: image.mimeType,
        ownerEmail: args.ownerEmail,
        recordAsset: false,
      });
      url = result?.url;
    } catch {
      url = undefined;
    }

    if (!url) {
      url =
        (await storeLocalImportedAsset({
          email: args.ownerEmail,
          filename,
          mimeType: image.mimeType,
          data: image.data,
        })) ?? undefined;
    }
    if (url) urls[element.id] = url;
  }

  return {
    urls,
    imageSkippedCount: Math.max(
      0,
      imageElements.length - Object.keys(urls).length,
    ),
  };
}
