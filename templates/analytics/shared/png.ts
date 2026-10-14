const MAX_DIMENSION = 8_192;
const MAX_PIXELS = 16_000_000;

/**
 * Whether a window of this size could be rendered and screenshotted at all. A
 * recording's size comes from the client, so everything that allocates a
 * browser surface or stores a size checks it first.
 */
export function isScreenshotSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_PIXELS
  );
}

/**
 * Width and height from a PNG's IHDR chunk, or null when the bytes are not a
 * PNG or claim a size no screenshot has. Reads 24 bytes; decodes nothing.
 */
export function pngDimensions(
  data: Uint8Array,
): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || signature.some((byte, i) => data[i] !== byte)) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ihdr = String.fromCharCode(data[12]!, data[13]!, data[14]!, data[15]!);
  if (ihdr !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return isScreenshotSize(width, height) ? { width, height } : null;
}
