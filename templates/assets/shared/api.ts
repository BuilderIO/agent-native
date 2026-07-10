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
  "skeleton",
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
  "gpt-image-1",
  "gpt-image-2",
] as const;

// Per-model aspect-ratio constraints. Mirrors the image service catalog's
// `supportedAspectRatios` (see the ai-services image-generation catalog). Models
// omitted here accept the full ASPECT_RATIOS set. GPT image models map each
// aspect ratio to a fixed OpenAI resolution and support only these three; other
// ratios are rejected upstream with `unsupported_aspect_ratio`. Keep this in
// sync with the catalog until the picker sources it dynamically from `/discover`.
export const MODEL_ASPECT_RATIOS: Partial<
  Record<ImageModel, readonly AspectRatio[]>
> = {
  "gpt-image-1": ["1:1", "2:3", "3:2"],
  "gpt-image-2": ["1:1", "2:3", "3:2"],
};

export function supportedAspectRatiosForModel(
  model: ImageModel,
): readonly AspectRatio[] {
  return MODEL_ASPECT_RATIOS[model] ?? ASPECT_RATIOS;
}

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
  | "background_reference"
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
  fontFamilies?: string[];
  fontWeights?: string[];
  letterforms?: string;
  caseStyle?: string;
  typographyPolicy?: string;
  doNot?: string[];
}

export type PresetSkeletonBackground = { type: "asset"; assetId: string };
export type PresetSkeletonMask = { type: "asset"; assetId: string };

export type PresetSkeletonForegroundSource =
  | "canonicalLogo"
  | { assetId: string };

export interface PresetSkeletonForegroundLayer {
  source: PresetSkeletonForegroundSource;
  x: number;
  y: number;
  w: number;
}

export interface PresetSkeletonSpec {
  background: PresetSkeletonBackground;
  mask?: PresetSkeletonMask;
  contentMode: "cutout" | "fill";
  contentRegion?: { x: number; y: number; w: number; h: number };
  dropShadow?: boolean;
  foreground?: PresetSkeletonForegroundLayer[];
}

export const PRESET_REFERENCE_ROLES = [
  "subject",
  "style",
  "product",
  "background",
  "composition",
] as const;

export type PresetReferenceRole = (typeof PRESET_REFERENCE_ROLES)[number];

export interface PresetReference {
  id: string;
  label: string;
  role: PresetReferenceRole;
  description?: string;
  assetIds: string[];
  variable: boolean;
  required: boolean;
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
  accessRole?: "owner" | "admin" | "editor" | "viewer";
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  referenceCount?: number;
  generatedCount?: number;
  videoCount?: number;
  coverAsset?: ImageAssetPreview | null;
  previewAssets?: ImageAssetPreview[];
  folders?: AssetFolderSummary[];
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
  intent?: "subject" | string;
  sourceAssetId?: string;
  referenceAssetIds?: string[];
  prompt?: string;
  compiledPrompt?: string;
  description?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  subjectAssetId?: string;
  [key: string]: unknown;
}

export interface AssetLineageSummary {
  kind: "original" | "variation";
  serial: number;
  label: string;
  sourceAssetId?: string | null;
  sourceLabel?: string | null;
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
  batchId?: string | null;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  variantScopeId?: string | null;
  prompt: string;
  slots: Array<{
    slotId: string;
    runId?: string;
    status: "pending" | "ready" | "failed";
    assetId?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    error?: string;
    createdAt?: string;
    updatedAt?: string;
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
  aspectRatio: AspectRatio | VideoAspectRatio;
  imageSize: ImageSize | VideoResolution;
  model: ImageModel | VideoModel;
  textPolicy: string;
  referencePolicy: GenerationPresetReferencePolicy;
  includeLogo: boolean;
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
  items?: GenerationSessionItemSummary[];
  itemCount?: number;
  assetCount?: number;
  variationCount?: number;
}

export interface GenerationSessionItemSummary {
  id: string;
  assetId?: string | null;
  generationRunId?: string | null;
  role: string;
  sortOrder: number;
  createdAt?: string;
  label: string;
  lineage?: AssetLineageSummary | null;
}
