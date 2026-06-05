import type { BrandKitData, BrandKitDefaults } from "../types.js";
import { decodeFig } from "./decode.js";
import { extractDesignSystemFromFig } from "./extract-design-system.js";

export * from "./decode.js";
export * from "./extract-design-system.js";
export * from "./fig-to-html.js";

export interface FigBrandKitPreview {
  gradients: string[];
  palette: { hex: string; name?: string; count: number }[];
  namedColors: Record<string, string>;
  thumbnailDataUrl: string | null;
  nodeCount: number;
  imageCount: number;
}

export interface FigBrandKitExtraction {
  format: "kiwi" | "zip";
  version: number | null;
  data: Partial<BrandKitData> & { defaults?: BrandKitDefaults };
  customInstructions: string;
  preview: FigBrandKitPreview;
}

export const MAX_FIG_THUMBNAIL_BYTES = 512 * 1024;

export function looksLikeFigFile(data: Uint8Array): boolean {
  const isZip =
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04;
  const isKiwi =
    Buffer.from(data.subarray(0, 8)).toString("utf8") === "fig-kiwi";
  return isZip || isKiwi;
}

export function figThumbnailDataUrl(thumbnail: Buffer | null): string | null {
  if (!thumbnail || thumbnail.length > MAX_FIG_THUMBNAIL_BYTES) return null;
  return `data:image/png;base64,${thumbnail.toString("base64")}`;
}

export function extractFigBrandKit(
  input: Buffer | Uint8Array,
): FigBrandKitExtraction {
  const decoded = decodeFig(Buffer.from(input));
  if (!decoded.document) {
    throw new Error(
      "Decoded the file but found no document. It may be a partial or corrupt export.",
    );
  }

  const extracted = extractDesignSystemFromFig(decoded.document);
  const {
    customInstructions,
    gradients,
    palette,
    namedColors,
    nodeCount,
    ...data
  } = extracted;

  const thumbnailDataUrl = figThumbnailDataUrl(decoded.thumbnail);

  return {
    format: decoded.format,
    version: decoded.version ?? null,
    data,
    customInstructions: customInstructions ?? "",
    preview: {
      gradients: gradients ?? [],
      palette: palette ?? [],
      namedColors: namedColors ?? {},
      thumbnailDataUrl,
      nodeCount: nodeCount ?? 0,
      imageCount: decoded.images.length,
    },
  };
}
