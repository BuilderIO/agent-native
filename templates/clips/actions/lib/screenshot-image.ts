/**
 * The one check every screenshot upload goes through: a capture, an edited
 * copy, and a burned-in base alike.
 */

import {
  hasExpectedImageSignature,
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from "../../server/lib/image-signature.js";
import { decodeDataUrl } from "./data-url.js";

/**
 * Generous next to a compressed screen grab (a 4K JPEG lands well under 5 MB),
 * tight enough that a mis-encoded or hand-crafted payload can't push tens of
 * megabytes through an action body.
 */
export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

/**
 * Decode a screenshot sent as a data URL, refusing anything that is not a
 * supported image, is empty or too large, or whose bytes are not the type it
 * claims to be. `what` names the image in the error, e.g. "Screenshot".
 */
export function decodeScreenshotDataUrl(
  dataUrl: string,
  what: string,
): { bytes: Uint8Array; mimeType: SupportedImageMimeType } {
  const tooLarge = `${what} is too large (max ${Math.floor(MAX_SCREENSHOT_BYTES / (1024 * 1024))} MB)`;
  const { bytes, mime } = decodeDataUrl(dataUrl, {
    maxBytes: MAX_SCREENSHOT_BYTES,
    tooLarge,
  });
  const mimeType = mime.split(";")[0].trim().toLowerCase();
  if (!isSupportedImageMimeType(mimeType)) {
    throw new Error(`${what} must be a PNG, JPEG, GIF or WebP image, not ${mimeType}`);
  }
  if (!bytes.byteLength) {
    throw new Error(`${what} is empty`);
  }
  // The Content-Type is only the caller's claim; check the bytes agree
  // before they are stored under a matching extension.
  if (!hasExpectedImageSignature(bytes, mimeType)) {
    throw new Error(`${what} bytes do not match the declared image type`);
  }
  return { bytes, mimeType };
}
