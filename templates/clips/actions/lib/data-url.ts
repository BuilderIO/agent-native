/**
 * Decode a base64 `data:` URL into raw bytes.
 *
 * Browsers hand images to the server as data URLs (canvas has no other cheap
 * way to produce one), so both the thumbnail action and the screenshot action
 * need the same decode. Anything that is not base64-encoded is rejected rather
 * than half-decoded.
 *
 * With `maxBytes`, an oversized payload is refused from its length alone,
 * before any of it is decoded.
 */
export function decodeDataUrl(
  dataUrl: string,
  options: { maxBytes?: number; tooLarge?: string } = {},
): {
  bytes: Uint8Array;
  mime: string;
} {
  const comma = dataUrl.indexOf(",");
  const header = comma > 0 ? dataUrl.slice(0, comma) : "";
  const match = /^data:([^;,]+)(?:;[^;,]*)*;base64$/.exec(header);
  if (!match || comma === dataUrl.length - 1) {
    throw new Error("dataUrl must be base64-encoded data: URL");
  }
  const mime = match[1];
  const base64 = dataUrl.slice(comma + 1);
  if (options.maxBytes !== undefined) {
    // Four base64 characters carry three bytes; padding only makes it less.
    const upperBound = Math.floor((base64.length * 3) / 4);
    if (upperBound - 2 > options.maxBytes) {
      throw new Error(options.tooLarge ?? "The image is too large");
    }
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error("dataUrl must be base64-encoded data: URL");
  }
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (options.maxBytes !== undefined && bytes.byteLength > options.maxBytes) {
    throw new Error(options.tooLarge ?? "The image is too large");
  }
  return { bytes, mime };
}
