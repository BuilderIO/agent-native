export const IMAGE_CATEGORIES = [
  "hero",
  "landing",
  "product",
  "logo",
  "diagram",
  "video",
  "social",
  "campaign",
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

export const ASSET_MEDIA_TYPES = ["image", "video"] as const;

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

export const VIDEO_DURATIONS = [4, 6, 8] as const;

export const VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;

export const VIDEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
] as const;

export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];
export type AssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];
export type ImageRole =
  | "style_reference"
  | "logo_reference"
  | "product_reference"
  | "diagram_reference"
  | "video_reference"
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
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoModel = (typeof VIDEO_MODELS)[number];

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
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssetFolderSummary {
  id: string;
  libraryId: string;
  parentId?: string | null;
  title: string;
  description?: string | null;
  sortOrder?: number;
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
  description?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  [key: string]: unknown;
}

export interface AssetVariantState {
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

export type ImageVariantState = AssetVariantState;
