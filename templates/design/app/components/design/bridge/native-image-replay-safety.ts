import { validateNativeSvgPrimitiveMarkup } from "./native-svg-source";

export type NativeReplaySafety = "immutable" | "dynamic" | "unknown";

const UNKNOWN_REPLAY_SAFETY: NativeReplaySafety = "unknown";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint32be(bytes: Uint8Array, start: number): number {
  return (
    (bytes[start]! * 0x1000000 +
      (bytes[start + 1]! << 16) +
      (bytes[start + 2]! << 8) +
      bytes[start + 3]!) >>>
    0
  );
}

function uint32le(bytes: Uint8Array, start: number): number {
  return (
    (bytes[start]! +
      (bytes[start + 1]! << 8) +
      (bytes[start + 2]! << 16) +
      bytes[start + 3]! * 0x1000000) >>>
    0
  );
}

function pngSafety(bytes: Uint8Array): NativeReplaySafety {
  if (
    bytes.length < 33 ||
    uint32be(bytes, 8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR"
  )
    return "unknown";
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = uint32be(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return UNKNOWN_REPLAY_SAFETY;
    if (end < offset) return UNKNOWN_REPLAY_SAFETY;
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return "dynamic";
    if (type === "IDAT") imageData = true;
    if (type === "IEND")
      return length === 0 && imageData && end === bytes.length
        ? "immutable"
        : "unknown";
    offset = end;
  }
  return "unknown";
}

function webpSafety(bytes: Uint8Array): NativeReplaySafety {
  if (bytes.length < 20 || uint32le(bytes, 4) + 8 !== bytes.length)
    return "unknown";
  let offset = 12;
  let imageData = false;
  while (offset + 8 <= bytes.length) {
    const length = uint32le(bytes, offset + 4);
    const end = offset + 8 + length + (length & 1);
    if (end > bytes.length) return UNKNOWN_REPLAY_SAFETY;
    if (end < offset) return UNKNOWN_REPLAY_SAFETY;
    const type = ascii(bytes, offset, 4);
    if (type === "ANIM" || type === "ANMF") return "dynamic";
    if (type === "VP8X") {
      if (length < 10) return "unknown";
      if ((bytes[offset + 8]! & 0x02) !== 0) return "dynamic";
    }
    if (type === "VP8 ") {
      if (
        length < 10 ||
        bytes[offset + 11] !== 0x9d ||
        bytes[offset + 12] !== 0x01 ||
        bytes[offset + 13] !== 0x2a
      )
        return "unknown";
      imageData = true;
    }
    if (type === "VP8L") {
      if (length < 5 || bytes[offset + 8] !== 0x2f) return "unknown";
      imageData = true;
    }
    offset = end;
  }
  return imageData && offset === bytes.length ? "immutable" : "unknown";
}

export function classifyNativeImageReplaySafety(
  bytes: Uint8Array,
  mime?: string,
): NativeReplaySafety {
  if (mime === "image/svg+xml") {
    if (bytes.length > 262_144) return "unknown";
    try {
      const markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return validateNativeSvgPrimitiveMarkup(markup);
    } catch {
      return "unknown";
    }
  }
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "GIF") return "dynamic";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
    return "immutable";
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return pngSafety(bytes);
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  )
    return webpSafety(bytes);
  return "unknown";
}
