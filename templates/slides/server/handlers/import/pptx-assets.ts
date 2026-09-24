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

/**
 * Validate every image before any upload starts. PPTX imports reject partial
 * fidelity, so an unsupported image must not leave earlier slide uploads
 * orphaned when the action eventually throws.
 */
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
    throw new Error(
      `Source-faithful PPTX import cannot preserve unsupported image type(s): ${[...unsupported].join(", ")}. No images were uploaded. Re-export the deck with browser-renderable images or use a PDF export for page-faithful preservation.`,
    );
  }
}

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
