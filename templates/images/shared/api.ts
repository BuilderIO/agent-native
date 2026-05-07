export const IMAGE_CATEGORIES = [
  "hero",
  "landing",
  "product",
  "logo",
  "diagram",
  "style-only",
  "other",
] as const;

export const ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
] as const;

export const IMAGE_SIZES = ["512", "1K", "2K", "4K"] as const;

export const IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];
export type ImageRole =
  | "style_reference"
  | "logo_reference"
  | "product_reference"
  | "diagram_reference"
  | "generated";
export type ImageStatus =
  | "reference"
  | "candidate"
  | "saved"
  | "archived"
  | "failed";
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type ImageModel = (typeof IMAGE_MODELS)[number];

export interface StyleBrief {
  description?: string;
  palette?: string[];
  composition?: string;
  lighting?: string;
  typographyPolicy?: string;
  doNot?: string[];
}

export interface ImageLibrarySummary {
  id: string;
  title: string;
  description?: string | null;
  customInstructions: string;
  styleBrief: StyleBrief;
  settings: Record<string, unknown>;
  canonicalLogoAssetId?: string | null;
  coverAssetId?: string | null;
  visibility?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImageAssetMetadata {
  category?: ImageCategory;
  colors?: string[];
  generated?: boolean;
  sourceAssetId?: string;
  referenceAssetIds?: string[];
  prompt?: string;
  compiledPrompt?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  [key: string]: unknown;
}

export interface ImageVariantState {
  runId: string;
  libraryId: string;
  collectionId?: string | null;
  prompt: string;
  slots: Array<{
    slotId: string;
    status: "pending" | "ready" | "failed";
    assetId?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    error?: string;
  }>;
  updatedAt: string;
}
