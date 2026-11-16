import { appApiPath } from "@agent-native/core/client/api-path";
import {
  COMMENT_IMAGE_TYPES,
  MAX_COMMENT_IMAGE_BYTES,
  isCommentImageType,
  type CommentImage,
} from "@shared/comment-images";
import { useEffect, useState } from "react";

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

const STORAGE_STATUS_TTL_MS = 60_000;
let storageStatus: { at: number; configured: Promise<boolean | null> } | null =
  null;

function readStorageStatus(): Promise<boolean | null> {
  if (storageStatus && Date.now() - storageStatus.at < STORAGE_STATUS_TTL_MS)
    return storageStatus.configured;
  const configured = fetch(appApiPath("/api/private-media-status"), {
    credentials: "include",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { configured?: unknown };
      return typeof body.configured === "boolean" ? body.configured : null;
    })
    // coercion-ok: an unknown status leaves the button on; an upload then says why it failed.
    .catch(() => null);
  storageStatus = { at: Date.now(), configured };
  return configured;
}

/**
 * Whether the workspace has private storage for comment images: false turns
 * the image button off with the reason, and null (not known yet, or the check
 * failed) leaves it on, since the upload itself then says what went wrong.
 */
export function useCommentImageStorage(enabled: boolean): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void readStorageStatus().then((value) => {
      if (live) setConfigured(value);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? configured : null;
}
