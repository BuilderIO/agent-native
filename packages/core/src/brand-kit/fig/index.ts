import type { BrandKitData, BrandKitDefaults } from "../types.js";

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

function unsupportedFigImport(): never {
  throw new Error(
    "Local .fig design-system extraction has moved to Builder indexing. Connect Builder and use the design system indexing flow instead.",
  );
}

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
  _input: Buffer | Uint8Array,
): FigBrandKitExtraction {
  return unsupportedFigImport();
}

export function decodeFig(_input: Buffer | Uint8Array): never {
  return unsupportedFigImport();
}

export function extractDesignSystemFromFig(_document: unknown): never {
  return unsupportedFigImport();
}

export function figToHtml(_node: unknown): never {
  return unsupportedFigImport();
}
