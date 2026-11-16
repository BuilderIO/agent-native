import { privateMediaIdFromSrc } from "./private-media.js";

/**
 * An image on a Page comment, kept as the shared Comments & Review Kit keeps
 * a comment's images (`url`, `name`, `contentType`), so the images move with
 * the comments when Content's comments move onto the kit. The link is a
 * private image's stored path, which loads only for people who can view the
 * page the comment is on, and for the person who uploaded it.
 */
export interface CommentImage {
  url: string;
  name: string;
  contentType?: string;
}

/** As many images as one comment keeps, the kit's limit too. */
export const MAX_COMMENT_IMAGES = 5;

/** The image types a comment takes: the usual screenshot formats. */
export const COMMENT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Each image can be as large as an image uploaded into a page. */
export const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;

const MAX_IMAGE_NAME_LENGTH = 200;

export function isCommentImageType(type: string): boolean {
  return (COMMENT_IMAGE_TYPES as readonly string[]).includes(
    type.split(";")[0]?.trim().toLowerCase() ?? "",
  );
}

/** The private image behind a comment image, or null when it isn't one. */
export function commentImageMediaId(image: Pick<CommentImage, "url">) {
  return privateMediaIdFromSrc(image.url);
}

/** The image as a comment keeps it, or null when it isn't a private image. */
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

/** The images saved on a comment row; anything unreadable is left out. */
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

/** What a comment row stores for its images: null when it has none. */
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
