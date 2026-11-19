import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  COMMENT_IMAGE_TYPES,
  MAX_COMMENT_IMAGE_BYTES,
  isCommentImageType,
  type CommentImage,
} from "@shared/comment-images";

import { ImageStorageUnavailableError, uploadImageFile } from "./image-upload";

export const COMMENT_IMAGE_ACCEPT = COMMENT_IMAGE_TYPES.join(",");

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

export type CommentImageRefusal = "type" | "size";

export function commentImageRefusal(file: File): CommentImageRefusal | null {
  if (!isCommentImageType(file.type)) return "type";
  if (file.size > MAX_COMMENT_IMAGE_BYTES) return "size";
  return null;
}

export function isStorageUnavailable(error: unknown): boolean {
  return error instanceof ImageStorageUnavailableError;
}

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
