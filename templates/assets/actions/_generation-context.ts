import { readAppState } from "@agent-native/core/application-state";
import {
  ASPECT_RATIOS,
  ASSET_MEDIA_TYPES,
  IMAGE_MODELS,
  IMAGE_SIZES,
  type AspectRatio,
  type AssetMediaType,
  type ImageModel,
  type ImageSize,
} from "../shared/api.js";

export const GENERATION_CONTEXT_STATE_KEY = "generation-context";
export const LEGACY_IMAGE_MODEL_STATE_KEY = "imageGenerationModel";

export type GenerationContextDefaults = {
  libraryId?: string;
  presetId?: string;
  model?: ImageModel;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  count?: number;
  mediaType?: AssetMediaType;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function enumValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.includes(value)
    ? value
    : undefined;
}

function countValue(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(6, Math.max(1, Math.round(numeric)));
}

export async function readGenerationContextDefaults(): Promise<GenerationContextDefaults> {
  const [contextRaw, legacyRaw] = await Promise.all([
    readAppState(GENERATION_CONTEXT_STATE_KEY).catch(() => null),
    readAppState(LEGACY_IMAGE_MODEL_STATE_KEY).catch(() => null),
  ]);
  const context =
    contextRaw && typeof contextRaw === "object" && !Array.isArray(contextRaw)
      ? (contextRaw as Record<string, unknown>)
      : {};
  const legacy =
    legacyRaw && typeof legacyRaw === "object" && !Array.isArray(legacyRaw)
      ? (legacyRaw as Record<string, unknown>)
      : {};
  return {
    libraryId: stringValue(context.libraryId),
    presetId: stringValue(context.presetId),
    model:
      enumValue(IMAGE_MODELS, context.model) ??
      enumValue(IMAGE_MODELS, legacy.model),
    aspectRatio: enumValue(ASPECT_RATIOS, context.aspectRatio),
    imageSize: enumValue(IMAGE_SIZES, context.imageSize),
    count: countValue(context.count),
    mediaType: enumValue(ASSET_MEDIA_TYPES, context.mediaType),
  };
}
