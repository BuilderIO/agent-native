/**
 * Normalization and caps for vision images attached to tool results.
 *
 * Actions opt in by returning a well-known optional `_agentImages` field on
 * their result object; external MCP tools opt in by returning standard MCP
 * `image` content parts. Both funnel through `normalizeToolResultImages` so
 * the caps live in exactly one place:
 *
 *   - at most {@link MAX_TOOL_RESULT_IMAGES} images per tool result,
 *   - at most {@link MAX_TOOL_RESULT_IMAGE_BASE64_CHARS} base64 chars each.
 *
 * Dropped images become model-readable text notes instead of failing the tool
 * call. Accepted images become `EngineToolResultImagePart`s that live only on
 * the in-memory turn — the run ledger persists the string result (which
 * carries a compact `[image: …]` note per image), never base64 payloads.
 */

import type { EngineToolResultImagePart } from "./engine/types.js";

/** Well-known optional field on action results carrying result images. */
export const AGENT_IMAGES_FIELD = "_agentImages";

export const MAX_TOOL_RESULT_IMAGES = 4;

/** ~2MB of base64 (≈1.5MB decoded) per image; larger becomes a text note. */
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
  /** Model-readable notes for images that were dropped (oversize/invalid). */
  notes: string[];
}

function isSupportedMediaType(value: unknown): value is SupportedMediaType {
  return typeof value === "string" && SUPPORTED_IMAGE_MEDIA_TYPES.has(value);
}

/** Base64 body is validated loosely — providers reject garbage anyway. */
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Normalize one candidate image entry. Accepts:
 * - `{ url }` — public https URL (the provider fetches it),
 * - `{ data, mediaType }` — base64 without a `data:` prefix,
 * - `{ data: "data:image/png;base64,…" }` — full data URL (parsed).
 *
 * Returns the normalized part, a drop note, or null for entries so malformed
 * they aren't worth a note (non-objects).
 */
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

/**
 * Validate and cap a raw `_agentImages`-shaped array. Never throws; anything
 * invalid or over-cap becomes a note the model can read.
 */
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

/**
 * Detect and strip the `_agentImages` field from an action result object.
 * Returns the value to stringify for the model (field removed) plus the
 * normalized images and drop notes. Non-objects pass through untouched.
 */
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

/**
 * Compact per-image notes appended to the string result. This is what the
 * run ledger / journal persists — URLs survive verbatim; base64 becomes a
 * `[image: <mediaType>, <n> …]` placeholder (never the payload).
 */
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
