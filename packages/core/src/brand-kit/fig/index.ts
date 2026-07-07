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
const LEGACY_LOCAL_COPY_MAGIC = new Uint8Array([
  0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69,
]);

function unsupportedFigImport(): never {
  throw new Error(
    "Legacy .fig helpers no longer process files locally. Connect Builder and use the design system indexing flow instead.",
  );
}

export function looksLikeFigFile(data: Uint8Array): boolean {
  const isZip =
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04;
  const isLegacyLocalCopy = LEGACY_LOCAL_COPY_MAGIC.every(
    (byte, index) => data[index] === byte,
  );
  return isZip || isLegacyLocalCopy;
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
