import {
  ASPECT_RATIOS,
  ASSET_MEDIA_TYPES,
  IMAGE_MODELS,
  IMAGE_SIZES,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type AspectRatio,
  type AssetMediaType,
  type ImageModel,
  type ImageSize,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoModel,
  type VideoResolution,
} from "../../shared/api";

export const GENERATION_CONTEXT_STATE_KEY = "generation-context";
export const LEGACY_IMAGE_MODEL_STATE_KEY = "imageGenerationModel";

export const DEFAULT_GENERATION_CONTEXT: GenerationContext = {
  libraryId: null,
  presetId: null,
  model: "gemini-3.1-flash-image",
  aspectRatio: "16:9",
  imageSize: "2K",
  count: 3,
  mediaType: "image",
  videoDurationSeconds: 8,
  videoResolution: "720p",
};

export type GenerationContext = {
  libraryId: string | null;
  presetId: string | null;
  model: ImageModel | VideoModel;
  aspectRatio: AspectRatio | VideoAspectRatio;
  imageSize: ImageSize;
  count: number;
  mediaType: AssetMediaType;
  videoDurationSeconds: VideoDuration;
  videoResolution: VideoResolution;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function countValue(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_GENERATION_CONTEXT.count;
  return Math.min(6, Math.max(1, Math.round(numeric)));
}

function videoDurationValue(value: unknown): VideoDuration {
  const numeric = typeof value === "number" ? value : Number(value);
  return (VIDEO_DURATIONS as readonly number[]).includes(numeric)
    ? (numeric as VideoDuration)
    : DEFAULT_GENERATION_CONTEXT.videoDurationSeconds;
}

export function normalizeGenerationContext(
  value: unknown,
  legacyModel?: unknown,
): GenerationContext {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const legacyRecord =
    legacyModel &&
    typeof legacyModel === "object" &&
    !Array.isArray(legacyModel)
      ? (legacyModel as Record<string, unknown>)
      : {};
  return {
    libraryId: stringOrNull(record.libraryId),
    presetId: stringOrNull(record.presetId),
    model: includes(IMAGE_MODELS, record.model)
      ? record.model
      : includes(VIDEO_MODELS, record.model)
        ? record.model
        : includes(IMAGE_MODELS, legacyRecord.model)
          ? legacyRecord.model
          : DEFAULT_GENERATION_CONTEXT.model,
    aspectRatio: includes(ASPECT_RATIOS, record.aspectRatio)
      ? record.aspectRatio
      : includes(VIDEO_ASPECT_RATIOS, record.aspectRatio)
        ? record.aspectRatio
        : DEFAULT_GENERATION_CONTEXT.aspectRatio,
    imageSize: includes(IMAGE_SIZES, record.imageSize)
      ? record.imageSize
      : DEFAULT_GENERATION_CONTEXT.imageSize,
    count: countValue(record.count),
    mediaType: includes(ASSET_MEDIA_TYPES, record.mediaType)
      ? record.mediaType
      : DEFAULT_GENERATION_CONTEXT.mediaType,
    videoDurationSeconds: videoDurationValue(
      record.videoDurationSeconds ?? record.durationSeconds,
    ),
    videoResolution: includes(VIDEO_RESOLUTIONS, record.videoResolution)
      ? record.videoResolution
      : includes(VIDEO_RESOLUTIONS, record.resolution)
        ? record.resolution
        : DEFAULT_GENERATION_CONTEXT.videoResolution,
  };
}

export function generationContextSummary(
  context: GenerationContext,
  libraryTitle?: string | null,
  presetTitle?: string | null,
) {
  const library = libraryTitle?.trim() || "Choose brand kit";
  const preset = presetTitle?.trim() || "No preset";
  if (context.mediaType === "video") {
    return `${library} / ${preset} / video / ${context.aspectRatio} / ${context.videoDurationSeconds}s / ${context.videoResolution}`;
  }
  return `${library} / ${preset} / ${context.aspectRatio} / ${context.imageSize} / ${context.count}x`;
}

export function generationContextPromptBlock({
  context,
  libraryTitle,
  presetTitle,
}: {
  context: GenerationContext;
  libraryTitle?: string | null;
  presetTitle?: string | null;
}) {
  return [
    "Use this generation context as the defaults for the next asset request.",
    `Library: ${libraryTitle || "none"} (${context.libraryId || "none"})`,
    `Preset: ${presetTitle || "none"} (${context.presetId || "none"})`,
    `Media type: ${context.mediaType}`,
    `Model: ${context.model}`,
    `Aspect ratio: ${context.aspectRatio}`,
    context.mediaType === "video"
      ? `Duration: ${context.videoDurationSeconds}s`
      : `Image size: ${context.imageSize}`,
    context.mediaType === "video"
      ? `Resolution: ${context.videoResolution}`
      : `Candidate count: ${context.count}`,
    "",
    context.libraryId
      ? context.mediaType === "video"
        ? "Call generate-video for video requests. If the user wants to wait, poll with refresh-generation-run until completion."
        : "Call generate-image-batch for image candidates unless the user asks for exactly one image."
      : "No brand kit is selected. Ask the user to choose a brand kit before generating, or help them create one first.",
    context.presetId
      ? context.mediaType === "video"
        ? "Use the selected video preset defaults for model, aspect ratio, duration, and resolution."
        : "Pass presetId through generation and refinement actions."
      : "No preset is selected.",
  ].join("\n");
}
