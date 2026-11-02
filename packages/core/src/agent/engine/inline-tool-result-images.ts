import { normalizeImageMediaType } from "../../file-upload/attachment-bytes.js";
import {
  claimOwnedAttachmentHydrationCandidate,
  createOwnedAttachmentHydrationBudget,
  hydrateOwnedImageUrl,
  releaseOwnedAttachmentHydrationCandidate,
  type OwnedAttachmentHydrationBudget,
} from "../../file-upload/owned-attachment.js";
import { downscaleImageToFit } from "../../ingestion/media.js";
import { parseBase64DataUrl } from "../../shared/data-url.js";
import { MAX_TOOL_RESULT_IMAGE_BASE64_CHARS } from "../tool-result-images.js";
import type { EngineMessage, EngineToolResultImagePart } from "./types.js";

type InlineImage = Required<
  Pick<EngineToolResultImagePart, "data" | "mediaType">
>;

// A tool-result screenshot stays in the thread for every later model step, so
// the same URLs are requested again each step. Entries are bounded in count,
// encoded size, and age.
const INLINE_IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INLINE_IMAGE_CACHE_ENTRIES = 12;
const MAX_INLINE_IMAGE_CACHE_CHARS = 16_000_000;

const inlineImageCache = new Map<
  string,
  { image: InlineImage; expiresAt: number }
>();
let inlineImageCacheChars = 0;

function removeCachedInlineImage(url: string): void {
  const entry = inlineImageCache.get(url);
  if (!entry) return;
  inlineImageCache.delete(url);
  inlineImageCacheChars -= entry.image.data.length;
}

function getCachedInlineImage(url: string): InlineImage | undefined {
  const entry = inlineImageCache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    removeCachedInlineImage(url);
    return undefined;
  }
  // Re-insert so Map order tracks recency.
  inlineImageCache.delete(url);
  inlineImageCache.set(url, entry);
  return entry.image;
}

function cacheInlineImage(url: string, image: InlineImage): void {
  removeCachedInlineImage(url);
  while (
    inlineImageCache.size > 0 &&
    (inlineImageCache.size >= MAX_INLINE_IMAGE_CACHE_ENTRIES ||
      inlineImageCacheChars + image.data.length > MAX_INLINE_IMAGE_CACHE_CHARS)
  ) {
    removeCachedInlineImage(inlineImageCache.keys().next().value as string);
  }
  inlineImageCache.set(url, {
    image,
    expiresAt: Date.now() + INLINE_IMAGE_CACHE_TTL_MS,
  });
  inlineImageCacheChars += image.data.length;
}

/**
 * Sends tool-result images we host (screenshots, exports) as bytes instead of
 * URLs. The Builder gateway forwards a URL image unchanged: Vertex's Claude
 * refuses it ("URL sources are not supported") and OpenAI fetches it itself,
 * sometimes timing out. The stored tool result keeps its URL; only this
 * request's copy carries bytes.
 *
 * Newest images are read first, within one request's hydration budget; URLs
 * that are not ours do not spend it. An
 * image that is not ours, or cannot be read or shrunk under the tool-result
 * image limit, keeps its URL, which is what every request sent before.
 */
export async function inlineOwnedToolResultImages(
  messages: EngineMessage[],
): Promise<EngineMessage[]> {
  const urls: string[] = [];
  for (const message of [...messages].reverse()) {
    for (const part of [...message.content].reverse()) {
      if (part.type !== "tool-result" || part.isError || !part.images) {
        continue;
      }
      for (const image of part.images) {
        if (image.url && !image.data && !urls.includes(image.url)) {
          urls.push(image.url);
        }
      }
    }
  }
  if (urls.length === 0) return messages;

  // Cache hits cost no hydration slot, so take them all before the budget can
  // end the loop; otherwise an exhausted budget strands older cached images.
  const inlined = new Map<string, InlineImage>();
  const uncached: string[] = [];
  for (const url of urls) {
    const cached = getCachedInlineImage(url);
    if (cached) inlined.set(url, cached);
    else uncached.push(url);
  }

  const budget = createOwnedAttachmentHydrationBudget();
  for (const url of uncached) {
    if (!claimOwnedAttachmentHydrationCandidate(budget)) break;
    const image = await readOwnedImage(url, budget);
    if (image) {
      inlined.set(url, image);
      cacheInlineImage(url, image);
    }
  }
  if (inlined.size === 0) return messages;

  return messages.map((message) => ({
    ...message,
    content: message.content.map((part) => {
      if (
        part.type !== "tool-result" ||
        !part.images?.some((image) => image.url && inlined.has(image.url))
      ) {
        return part;
      }
      return {
        ...part,
        images: part.images.map((image) => {
          const bytes = image.url ? inlined.get(image.url) : undefined;
          if (!bytes) return image;
          return { ...bytes, ...(image.label ? { label: image.label } : {}) };
        }),
      };
    }),
  })) as EngineMessage[];
}

async function readOwnedImage(
  url: string,
  budget: OwnedAttachmentHydrationBudget,
): Promise<InlineImage | null> {
  const result = await hydrateOwnedImageUrl(url, undefined, budget);
  // Unowned and malformed URLs are rejected before any fetch, so they must not
  // spend a slot that an older owned screenshot needs.
  if (result.kind === "unowned") {
    releaseOwnedAttachmentHydrationCandidate(budget);
    return null;
  }
  if (result.kind === "failed") {
    if (result.code === "invalid-url") {
      releaseOwnedAttachmentHydrationCandidate(budget);
    }
    console.warn(
      `[builder-engine] tool-result image sent as a URL: ${result.code}`,
    );
    return null;
  }
  const parsed = parseBase64DataUrl(result.dataUrl);
  let data = parsed?.data;
  let mediaType = normalizeImageMediaType(result.mediaType);
  if (data && mediaType && data.length > MAX_TOOL_RESULT_IMAGE_BASE64_CHARS) {
    const resized = await shrinkToToolResultLimit(data);
    data = resized?.data;
    mediaType = resized ? normalizeImageMediaType(resized.mediaType) : null;
  }
  if (!data || !mediaType || data.length > MAX_TOOL_RESULT_IMAGE_BASE64_CHARS) {
    console.warn(
      "[builder-engine] tool-result image sent as a URL: image-too-large",
    );
    return null;
  }
  return { data, mediaType };
}

async function shrinkToToolResultLimit(
  base64: string,
): Promise<{ data: string; mediaType: string } | null> {
  try {
    // Budget in decoded bytes so the re-encoded base64 fits the limit.
    const resized = await downscaleImageToFit({
      data: Buffer.from(base64, "base64"),
      maxBytes: Math.floor(MAX_TOOL_RESULT_IMAGE_BASE64_CHARS / 4) * 3,
    });
    if (!resized) return null;
    return {
      data: Buffer.from(resized.data).toString("base64"),
      mediaType: resized.mimeType,
    };
  } catch (error) {
    // coercion-ok: a failed shrink is reported by the caller, which keeps the URL.
    console.warn(
      "[builder-engine] tool-result image downscale failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
