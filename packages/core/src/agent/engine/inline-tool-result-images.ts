import { normalizeImageMediaType } from "../../file-upload/attachment-bytes.js";
import {
  claimOwnedAttachmentHydrationCandidate,
  createOwnedAttachmentHydrationBudget,
  hydrateOwnedImageUrl,
  type OwnedAttachmentHydrationBudget,
} from "../../file-upload/owned-attachment.js";
import { downscaleImageToFit } from "../../ingestion/media.js";
import { parseBase64DataUrl } from "../../shared/data-url.js";
import { MAX_TOOL_RESULT_IMAGE_BASE64_CHARS } from "../tool-result-images.js";
import type { EngineMessage, EngineToolResultImagePart } from "./types.js";

type InlineImage = Required<
  Pick<EngineToolResultImagePart, "data" | "mediaType">
>;

/**
 * Sends tool-result images we host (screenshots, exports) as bytes instead of
 * URLs. The Builder gateway forwards a URL image unchanged: Vertex's Claude
 * refuses it ("URL sources are not supported") and OpenAI fetches it itself,
 * sometimes timing out. The stored tool result keeps its URL; only this
 * request's copy carries bytes.
 *
 * Newest images are read first, within one request's hydration budget. An
 * image that is not ours, or cannot be read or shrunk under the tool-result
 * image limit, keeps its URL, which is what every request sent before.
 */
export async function inlineOwnedToolResultImages(
  messages: EngineMessage[],
): Promise<EngineMessage[]> {
  const urls: string[] = [];
  for (let m = messages.length - 1; m >= 0; m--) {
    const content = messages[m]?.content ?? [];
    for (let p = content.length - 1; p >= 0; p--) {
      const part = content[p];
      if (part?.type !== "tool-result" || part.isError || !part.images) {
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

  const budget = createOwnedAttachmentHydrationBudget();
  const inlined = new Map<string, InlineImage>();
  for (const url of urls) {
    if (!claimOwnedAttachmentHydrationCandidate(budget)) break;
    const image = await readOwnedImage(url, budget);
    if (image) inlined.set(url, image);
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
  if (result.kind === "unowned") return null;
  if (result.kind === "failed") {
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
