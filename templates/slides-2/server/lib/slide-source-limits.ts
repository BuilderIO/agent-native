import { Buffer } from "node:buffer";

export const MAX_SLIDE_SOURCE_BYTES = 256 * 1024;
export const SLIDE_SOURCE_BYTE_LIMIT_MESSAGE =
  "Slide source must be at most 256 KiB.";

export function isSlideSourceWithinByteLimit(sourceTsx: string): boolean {
  return Buffer.byteLength(sourceTsx, "utf8") <= MAX_SLIDE_SOURCE_BYTES;
}
