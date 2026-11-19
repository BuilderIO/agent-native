import { privateMediaIdFromSrc } from "./private-media.js";

export interface CommentImage {
  url: string;
  name: string;
  contentType?: string;
}

export const MAX_COMMENT_IMAGES = 5;

export const MAX_SUBMITTED_COMMENT_IMAGES = 50;

export const COMMENT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;

const MAX_IMAGE_NAME_LENGTH = 200;

export function isCommentImageType(type: string): boolean {
  return (COMMENT_IMAGE_TYPES as readonly string[]).includes(
    type.split(";")[0]?.trim().toLowerCase() ?? "",
  );
}

export function commentImageMediaId(image: Pick<CommentImage, "url">) {
  return privateMediaIdFromSrc(image.url);
}

export function normalizeCommentImage(value: unknown): CommentImage | null {
  if (!value || typeof value !== "object") return null;
  const { url, name, contentType } = value as Record<string, unknown>;
  if (typeof url !== "string" || !commentImageMediaId({ url })) return null;
  const type =
    typeof contentType === "string" ? contentType.trim().toLowerCase() : "";
  if (type && !isCommentImageType(type)) return null;
  const label =
    typeof name === "string" && name.trim()
      ? name.trim().slice(0, MAX_IMAGE_NAME_LENGTH)
      : "image";
  return { url, name: label, ...(type ? { contentType: type } : {}) };
}

export function readStoredCommentImages(
  json: string | null | undefined,
): CommentImage[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
    // coercion-ok: a row whose images don't parse shows none rather than failing the thread.
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value) => {
      const image = normalizeCommentImage(value);
      return image ? [image] : [];
    })
    .slice(0, MAX_COMMENT_IMAGES);
}

export function serializeStoredCommentImages(
  images: readonly CommentImage[],
): string | null {
  if (!images.length) return null;
  return JSON.stringify(
    images.map(({ url, name, contentType }) => ({
      url,
      name,
      ...(contentType ? { contentType } : {}),
    })),
  );
}
