
import type { EngineToolResultImagePart } from "./engine/types.js";

export const AGENT_IMAGES_FIELD = "_agentImages";

export const MAX_TOOL_RESULT_IMAGES = 4;

export const MAX_TOOL_RESULT_IMAGE_BASE64_CHARS = 2_000_000;

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type SupportedMediaType = EngineToolResultImagePart["mediaType"];

export interface NormalizedToolResultImages {
  images: EngineToolResultImagePart[];
  notes: string[];
}

function isSupportedMediaType(value: unknown): value is SupportedMediaType {
  return typeof value === "string" && SUPPORTED_IMAGE_MEDIA_TYPES.has(value);
}

const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

function normalizeOneImage(
  entry: unknown,
  index: number,
): { image?: EngineToolResultImagePart; note?: string } | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const label =
    typeof raw.label === "string" && raw.label.trim().length > 0
      ? raw.label.trim().slice(0, 200)
      : undefined;
  const describe = label ? `"${label}"` : `#${index + 1}`;

  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (url.length > 0) {
    if (!url.startsWith("https://")) {
      return {
        note: `[image ${describe} dropped: url must be a public https:// URL]`,
      };
    }
    return { image: { url, ...(label ? { label } : {}) } };
  }

  let data = typeof raw.data === "string" ? raw.data.trim() : "";
  let mediaType: unknown = raw.mediaType;
  const dataUrlMatch = data.match(/^data:([^;,]+);base64,(.+)$/s);
  if (dataUrlMatch) {
    mediaType = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }
  if (data.length === 0) {
    return { note: `[image ${describe} dropped: no url or base64 data]` };
  }
  if (!isSupportedMediaType(mediaType)) {
    return {
      note: `[image ${describe} dropped: unsupported media type ${String(
        mediaType ?? "(missing)",
      )}; use image/jpeg, image/png, image/gif, or image/webp]`,
    };
  }
  if (data.length > MAX_TOOL_RESULT_IMAGE_BASE64_CHARS) {
    return {
      note: `[image ${describe} (${mediaType}) dropped: ${data.length.toLocaleString()} base64 chars exceeds the ${MAX_TOOL_RESULT_IMAGE_BASE64_CHARS.toLocaleString()}-char limit — return a smaller image or a public https url instead]`,
    };
  }
  if (!BASE64_RE.test(data)) {
    return { note: `[image ${describe} dropped: data is not valid base64]` };
  }
  return { image: { data, mediaType, ...(label ? { label } : {}) } };
}

export function normalizeToolResultImages(
  raw: unknown,
): NormalizedToolResultImages {
  const images: EngineToolResultImagePart[] = [];
  const notes: string[] = [];
  if (!Array.isArray(raw)) return { images, notes };
  for (let i = 0; i < raw.length; i++) {
    const normalized = normalizeOneImage(raw[i], i);
    if (!normalized) continue;
    if (normalized.note) {
      notes.push(normalized.note);
      continue;
    }
    if (!normalized.image) continue;
    if (images.length >= MAX_TOOL_RESULT_IMAGES) {
      notes.push(
        `[image #${i + 1} dropped: max ${MAX_TOOL_RESULT_IMAGES} images per tool result]`,
      );
      continue;
    }
    images.push(normalized.image);
  }
  return { images, notes };
}

export function extractAgentImagesFromActionResult(value: unknown): {
  value: unknown;
  images: EngineToolResultImagePart[];
  notes: string[];
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !(AGENT_IMAGES_FIELD in (value as Record<string, unknown>))
  ) {
    return { value, images: [], notes: [] };
  }
  const { [AGENT_IMAGES_FIELD]: rawImages, ...rest } = value as Record<
    string,
    unknown
  >;
  const { images, notes } = normalizeToolResultImages(rawImages);
  return { value: rest, images, notes };
}

export function describeToolResultImages(
  images: EngineToolResultImagePart[],
): string[] {
  return images.map((image, i) => {
    const label = image.label ? ` ${JSON.stringify(image.label)}` : "";
    if (image.url) return `[image #${i + 1}${label} attached: ${image.url}]`;
    const bytes = Math.floor(((image.data?.length ?? 0) * 3) / 4);
    return `[image: ${image.mediaType ?? "image"}, ${bytes.toLocaleString()} bytes${label} — attached #${i + 1}]`;
  });
}
