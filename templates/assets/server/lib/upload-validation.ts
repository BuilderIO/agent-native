import type { AssetMediaType } from "../../shared/api.js";
import {
  hasRasterImageSignature,
  hasVideoSignature,
} from "./image-processing.js";

export const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

export const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
]);

export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 250 * 1024 * 1024;

export function maxUploadBytesForMediaType(mediaType: AssetMediaType): number {
  return mediaType === "video"
    ? MAX_VIDEO_UPLOAD_BYTES
    : MAX_IMAGE_UPLOAD_BYTES;
}

export function hasAllowedSignature(
  mimeType: string,
  data: Uint8Array,
): boolean {
  if (IMAGE_MIME_TYPES.has(mimeType))
    return hasRasterImageSignature(mimeType, data);
  if (VIDEO_MIME_TYPES.has(mimeType)) return hasVideoSignature(mimeType, data);
  return false;
}
