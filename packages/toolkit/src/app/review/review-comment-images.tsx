import { uploadEditorImage } from "@agent-native/core/client/uploads";
import type { ReviewComment } from "@agent-native/core/review/types";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

/** As many images as the server keeps on one comment. */
export const MAX_REVIEW_COMMENT_IMAGES = 5;

/** An uploaded image on a comment, as it's kept in `metadata.attachments`. */
export interface ReviewCommentImage {
  url: string;
  name: string;
  contentType?: string;
  provider?: string;
}

/** Uploads one image file and returns it as a comment keeps it. */
export type ReviewCommentImageUpload = (
  file: File,
) => Promise<ReviewCommentImage>;

/**
 * The app's own image upload. A data URL is the editor's fallback when no
 * storage is set up, and would put the whole image in the comment, so it's
 * refused.
 */
export const uploadReviewCommentImage: ReviewCommentImageUpload = async (
  file,
) => {
  const uploaded = await uploadEditorImage(file);
  const url = uploaded.src.trim();
  if (!url || /^data:/i.test(url)) {
    throw new Error("Image upload did not return a durable URL.");
  }
  return {
    url,
    name: file.name || "image",
    ...(file.type ? { contentType: file.type } : {}),
    ...(uploaded.provider ? { provider: uploaded.provider } : {}),
  };
};

/** The images a comment shows, read as the comment card reads them. */
export function reviewCommentImages(
  comment: Pick<ReviewComment, "metadata">,
): ReviewCommentImage[] {
  const raw = comment.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value): ReviewCommentImage[] => {
      if (!value || typeof value !== "object") return [];
      const attachment = value as Record<string, unknown>;
      const url = typeof attachment.url === "string" ? attachment.url : "";
      const contentType =
        typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined;
      const provider =
        typeof attachment.provider === "string"
          ? attachment.provider
          : undefined;
      if (
        !url ||
        (contentType && !contentType.startsWith("image/")) ||
        !isTrustedReviewAttachmentUrl(url)
      ) {
        return [];
      }
      return [
        {
          url,
          name:
            typeof attachment.name === "string" && attachment.name.trim()
              ? attachment.name
              : "image",
          ...(contentType ? { contentType } : {}),
          ...(provider ? { provider } : {}),
        },
      ];
    })
    .slice(0, MAX_REVIEW_COMMENT_IMAGES);
}

/**
 * The attachments a comment keeps that its card doesn't show, such as images
 * on a storage provider's own host. An edit that changes the shown images
 * sends these along, so it never drops them.
 */
export function reviewCommentHiddenAttachments(
  comment: Pick<ReviewComment, "metadata">,
): Record<string, unknown>[] {
  const raw = comment.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  const shown = new Set(reviewCommentImages(comment).map(({ url }) => url));
  return raw.flatMap((value): Record<string, unknown>[] => {
    if (!value || typeof value !== "object") return [];
    const attachment = value as Record<string, unknown>;
    return typeof attachment.url === "string" && shown.has(attachment.url)
      ? []
      : [attachment];
  });
}

/** The `attachments` a comment's metadata keeps for its images. */
export function reviewCommentImageMetadata(
  images: readonly ReviewCommentImage[],
): Record<string, unknown>[] {
  return images.map(({ url, name, contentType, provider }) => ({
    url,
    name,
    ...(contentType ? { contentType } : {}),
    ...(provider ? { provider } : {}),
  }));
}

/**
 * Whether a comment card shows an image from `value`: this site's own, or
 * Builder's image CDN, so a comment can't load a tracking pixel from anywhere.
 */
export function isTrustedReviewAttachmentUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(
      value,
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin,
    );
    // coercion-ok: an unparseable attachment URL is untrusted, not absent.
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (typeof window !== "undefined" && parsed.origin === window.location.origin)
    return true;
  return parsed.protocol === "https:" && parsed.hostname === "cdn.builder.io";
}

export interface ReviewCommentImageUploadState {
  uploading: boolean;
  /** Room left for more images. */
  remaining: number;
  /** Uploads the image files among `files`, as many as there's room for. */
  addFiles: (files: readonly File[]) => boolean;
}

/**
 * Uploads picked, pasted or dropped images and adds them to `images` as each
 * batch finishes. A batch that loses a file still adds the rest.
 */
export function useReviewCommentImageUpload({
  images,
  onImagesChange,
  upload = uploadReviewCommentImage,
  onUploadError,
  disabled = false,
  maxImages = MAX_REVIEW_COMMENT_IMAGES,
}: {
  images: readonly ReviewCommentImage[];
  onImagesChange: ((images: ReviewCommentImage[]) => void) | undefined;
  upload?: ReviewCommentImageUpload | undefined;
  onUploadError?: ((error: unknown) => void) | undefined;
  disabled?: boolean | undefined;
  /** At most this many images, up to five. */
  maxImages?: number | undefined;
}): ReviewCommentImageUploadState {
  const [pending, setPending] = useState(0);
  const limit = Math.max(0, Math.min(MAX_REVIEW_COMMENT_IMAGES, maxImages));
  // The images as of the last change, which a batch finishing before the
  // next render adds to, so two batches never overwrite each other.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const latest = useRef({ onImagesChange, upload, onUploadError, limit });
  latest.current = { onImagesChange, upload, onUploadError, limit };
  // Files still uploading, so a second batch doesn't take their places.
  const pendingRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const remaining = Math.max(0, limit - images.length - pending);

  const addFiles = (files: readonly File[]): boolean => {
    if (disabled || !latest.current.onImagesChange) return false;
    const room = limit - imagesRef.current.length - pendingRef.current;
    const selected = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, room));
    // Images past the limit are still taken, so they don't paste as text.
    if (!selected.length)
      return files.some((file) => file.type.startsWith("image/"));
    pendingRef.current += selected.length;
    setPending(pendingRef.current);
    void Promise.allSettled(
      selected.map((file) => latest.current.upload(file)),
    ).then((results) => {
      pendingRef.current -= selected.length;
      if (!mountedRef.current) return;
      setPending(pendingRef.current);
      const uploaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (uploaded.length) {
        const next = [...imagesRef.current, ...uploaded].slice(
          0,
          latest.current.limit,
        );
        imagesRef.current = next;
        latest.current.onImagesChange?.(next);
      }
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed) latest.current.onUploadError?.(failed.reason);
    });
    return true;
  };

  return { uploading: pending > 0, remaining, addFiles };
}

export function ReviewCommentImageStrip({
  images,
  onRemove,
  removeLabel = "Remove image",
  disabled = false,
}: {
  images: readonly ReviewCommentImage[];
  onRemove?: ((index: number) => void) | undefined;
  removeLabel?: string | undefined;
  disabled?: boolean | undefined;
}) {
  if (!images.length) return null;
  return (
    <div
      data-review-composer-images=""
      className="flex flex-wrap items-center gap-1.5"
    >
      {images.map((image, index) => (
        <div
          key={`${image.url}-${index}`}
          data-review-composer-image=""
          className="group relative size-10 overflow-hidden rounded-md border border-border bg-muted"
        >
          <img
            src={image.url}
            alt={image.name}
            className="size-full object-cover"
          />
          {onRemove ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-0.5 top-0.5 size-5 opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              disabled={disabled}
              onClick={() => onRemove(index)}
              aria-label={`${removeLabel}: ${image.name}`}
            >
              <IconX className="size-3" />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
