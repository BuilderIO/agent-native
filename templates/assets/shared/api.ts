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

export const MAX_ASSET_UPLOAD_FILES = 20;

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
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

export const GENERATION_INTENTS = ["generate", "restyle", "edit"] as const;

export const STYLE_STRENGTHS = ["subtle", "balanced", "strong"] as const;

export const IMAGE_QUALITY_TIERS = ["auto", "fast", "best"] as const;

export const ASSET_MEDIA_TYPES = ["image", "video"] as const;

export const GENERATION_PRESET_REFERENCE_POLICIES = [
  "auto",
  "collection",
  "explicit",
] as const;

export const GENERATION_SESSION_STATUSES = [
  "open",
  "approved",
  "archived",
] as const;

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
  | "subject_reference"
  | "edit_target"
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
export type GenerationIntent = (typeof GENERATION_INTENTS)[number];
export type StyleStrength = (typeof STYLE_STRENGTHS)[number];
export type ImageQualityTier = (typeof IMAGE_QUALITY_TIERS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoModel = (typeof VIDEO_MODELS)[number];
export type GenerationPresetReferencePolicy =
  (typeof GENERATION_PRESET_REFERENCE_POLICIES)[number];
export type GenerationSessionStatus =
  (typeof GENERATION_SESSION_STATUSES)[number];

export interface StyleBrief {
  description?: string;
  palette?: string[];
  medium?: string;
  mood?: string;
  subjectMatter?: string;
  texture?: string;
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
  referenceCount?: number;
  generatedCount?: number;
  videoCount?: number;
  coverAsset?: ImageAssetPreview | null;
  previewAssets?: ImageAssetPreview[];
}

export interface ImageAssetPreview {
  id: string;
  title?: string | null;
  altText?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
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
  contentHash?: string;
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

export interface SkippedAssetUploadDuplicate {
  filename: string | null;
  reason: "same-upload" | "existing-asset";
  assetId?: string;
  title?: string | null;
}

export interface FailedAssetUpload {
  filename: string | null;
  message: string;
}

export interface AssetVariantState {
  runId: string;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  sessionId?: string | null;
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

export interface GenerationPresetSummary {
  id: string;
  libraryId: string;
  collectionId?: string | null;
  title: string;
  description?: string | null;
  category: ImageCategory;
  mediaType: AssetMediaType;
  promptTemplate?: string | null;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  model: ImageModel;
  textPolicy: string;
  referencePolicy: GenerationPresetReferencePolicy;
  settings: Record<string, unknown>;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GenerationSessionSummary {
  id: string;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  title: string;
  brief?: string | null;
  status: GenerationSessionStatus;
  activeAssetId?: string | null;
  feedbackSummary: string;
  metadata: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
