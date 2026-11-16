import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  COMMENT_IMAGE_TYPES,
  MAX_COMMENT_IMAGE_BYTES,
  isCommentImageType,
  type CommentImage,
} from "@shared/comment-images";

import { ImageStorageUnavailableError, uploadImageFile } from "./image-upload";

/** What the comment box's file picker offers. */
export const COMMENT_IMAGE_ACCEPT = COMMENT_IMAGE_TYPES.join(",");

/** Uploads one image for a comment on `documentId`, privately to that page. */
export async function uploadCommentImage(
  file: File,
  documentId: string,
): Promise<CommentImage> {
  const url = await uploadImageFile(file, { documentId, purpose: "comment" });
  return {
    url,
    name: file.name.trim() || "image",
    ...(file.type ? { contentType: file.type } : {}),
  };
}

/** Why a picked, pasted or dropped image can't go on a comment, if it can't. */
export type CommentImageRefusal = "type" | "size";

export function commentImageRefusal(file: File): CommentImageRefusal | null {
  if (!isCommentImageType(file.type)) return "type";
  if (file.size > MAX_COMMENT_IMAGE_BYTES) return "size";
  return null;
}

export function isStorageUnavailable(error: unknown): boolean {
  return error instanceof ImageStorageUnavailableError;
}

/**
 * Whether the workspace has private storage for comment images: false turns
 * the image button off with the reason, and null (not known yet, or the check
 * failed) leaves it on, since the upload itself then says what went wrong.
 * Switching workspaces refetches it with every other action read.
 */
export function useCommentImageStorage(enabled: boolean): boolean | null {
  const status = useActionQuery<{ configured: boolean }>(
    "get-comment-image-storage",
    {},
    {
      enabled,
      staleTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const configured = status.data?.configured;
  return enabled && typeof configured === "boolean" ? configured : null;
}
