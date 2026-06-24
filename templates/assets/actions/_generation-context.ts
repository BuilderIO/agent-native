import { readAppState } from "@agent-native/core/application-state";
import { getRequestRunContext } from "@agent-native/core/server/request-context";
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
} from "../shared/api.js";

export const GENERATION_CONTEXT_STATE_KEY = "generation-context";
export const LEGACY_IMAGE_MODEL_STATE_KEY = "imageGenerationModel";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export type GenerationContextDefaults = {
  libraryId?: string;
  presetId?: string;
  model?: ImageModel | VideoModel;
  aspectRatio?: AspectRatio | VideoAspectRatio;
  imageSize?: ImageSize;
  count?: number;
  mediaType?: AssetMediaType;
  videoDurationSeconds?: VideoDuration;
  videoResolution?: VideoResolution;
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

function videoDurationValue(value: unknown): VideoDuration | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return (VIDEO_DURATIONS as readonly number[]).includes(numeric)
    ? (numeric as VideoDuration)
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scopedGenerationContextKey() {
  // Non-browser callers such as A2A, cron, and external MCP runs usually do
  // not have a browser tab id. Those callers should pass libraryId explicitly;
  // the global context is only a best-effort fallback.
  const browserTabId = getRequestRunContext()?.browserTabId?.trim();
  if (!browserTabId || !SAFE_BROWSER_TAB_ID_RE.test(browserTabId)) return null;
  return `${GENERATION_CONTEXT_STATE_KEY}:${browserTabId}`;
}

export async function readGenerationContextDefaults(): Promise<GenerationContextDefaults> {
  const scopedKey = scopedGenerationContextKey();
  const [contextRaw, scopedRaw, legacyRaw] = await Promise.all([
    readAppState(GENERATION_CONTEXT_STATE_KEY).catch(() => null),
    scopedKey ? readAppState(scopedKey).catch(() => null) : null,
    readAppState(LEGACY_IMAGE_MODEL_STATE_KEY).catch(() => null),
  ]);
  const context = recordValue(contextRaw);
  const scoped = recordValue(scopedRaw);
  const legacy = recordValue(legacyRaw);
  const hasScopedLibrary =
    Object.prototype.hasOwnProperty.call(scoped, "libraryId") ||
    Object.prototype.hasOwnProperty.call(scoped, "presetId");
  const libraryContext = hasScopedLibrary ? scoped : context;
  return {
    libraryId: stringValue(libraryContext.libraryId),
    presetId: stringValue(libraryContext.presetId),
    model:
      enumValue(IMAGE_MODELS, context.model) ??
      enumValue(VIDEO_MODELS, context.model) ??
      enumValue(IMAGE_MODELS, scoped.model) ??
      enumValue(VIDEO_MODELS, scoped.model) ??
      enumValue(IMAGE_MODELS, legacy.model),
    aspectRatio:
      enumValue(ASPECT_RATIOS, context.aspectRatio) ??
      enumValue(VIDEO_ASPECT_RATIOS, context.aspectRatio) ??
      enumValue(ASPECT_RATIOS, scoped.aspectRatio) ??
      enumValue(VIDEO_ASPECT_RATIOS, scoped.aspectRatio),
    imageSize:
      enumValue(IMAGE_SIZES, context.imageSize) ??
      enumValue(IMAGE_SIZES, scoped.imageSize),
    count: countValue(context.count) ?? countValue(scoped.count),
    mediaType:
      enumValue(ASSET_MEDIA_TYPES, context.mediaType) ??
      enumValue(ASSET_MEDIA_TYPES, scoped.mediaType),
    videoDurationSeconds:
      videoDurationValue(context.videoDurationSeconds) ??
      videoDurationValue(context.durationSeconds) ??
      videoDurationValue(scoped.videoDurationSeconds) ??
      videoDurationValue(scoped.durationSeconds),
    videoResolution:
      enumValue(VIDEO_RESOLUTIONS, context.videoResolution) ??
      enumValue(VIDEO_RESOLUTIONS, context.resolution) ??
      enumValue(VIDEO_RESOLUTIONS, scoped.videoResolution) ??
      enumValue(VIDEO_RESOLUTIONS, scoped.resolution),
  };
}
