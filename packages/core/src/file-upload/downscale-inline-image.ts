import { downscaleImageToFit } from "../ingestion/media.js";
import { normalizeImageMediaType } from "./attachment-bytes.js";
import { MAX_INLINE_IMAGE_BASE64_CHARS } from "./inline-attachment-limits.js";

export async function downscaleInlineImageBase64(
  base64: string,
  mediaType: string,
): Promise<{ base64: string; mediaType: string } | null> {
  if (
    base64.length <= MAX_INLINE_IMAGE_BASE64_CHARS ||
    !normalizeImageMediaType(mediaType)
  ) {
    return null;
  }
  try {
    // Budget in decoded bytes so the re-encoded base64 always passes the inline limit.
    const resized = await downscaleImageToFit({
      data: Buffer.from(base64, "base64"),
      maxBytes: (MAX_INLINE_IMAGE_BASE64_CHARS / 4) * 3,
    });
    if (!resized) return null;
    return {
      base64: Buffer.from(resized.data).toString("base64"),
      mediaType: resized.mimeType,
    };
  } catch (err) {
    // The unchanged oversized image falls through to the size-note path.
    console.warn(
      "[agent-native] inline image downscale failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
