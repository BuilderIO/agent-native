export type NativeRasterFormat = "png" | "jpg" | "webp" | "avif";

const MAX_ENCODED_BYTES = 100_000_000;

export class NativeRasterEncodingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "raster-encoding-unavailable"
      | "raster-format-unsupported" = "raster-encoding-unavailable",
  ) {
    super(message);
    this.name = "NativeRasterEncodingError";
  }
}

export function rasterMimeType(format: NativeRasterFormat): string {
  switch (format) {
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
  }
}

export function flattenStraightRgbaOnWhite(rgba: Uint8Array): Uint8Array {
  if (rgba.byteLength % 4 !== 0)
    throw new NativeRasterEncodingError("Raster pixels are incomplete.");
  const result = rgba.slice();
  for (let offset = 0; offset < result.length; offset += 4) {
    const alpha = result[offset + 3]!;
    if (alpha !== 255) {
      for (let channel = 0; channel < 3; channel++) {
        result[offset + channel] = Math.round(
          (result[offset + channel]! * alpha + 255 * (255 - alpha)) / 255,
        );
      }
    }
    result[offset + 3] = 255;
  }
  return result;
}

function hasSignature(
  bytes: Uint8Array,
  format: NativeRasterFormat,
  size: number,
) {
  if (format === "png")
    return (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      ) &&
      String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR"
    );
  if (format === "jpg")
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (format === "webp")
    return (
      bytes.length >= 16 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(
        String.fromCharCode(...bytes.subarray(12, 16)),
      ) &&
      new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) +
        8 ===
        size
    );
  if (bytes.length < 16) return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  if (
    boxSize < 16 ||
    boxSize > size ||
    String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp"
  )
    return false;
  const end = Math.min(boxSize, bytes.length);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (offset === 12) continue;
    const brand = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

export async function validateEncodedRasterBlob(
  blob: Blob | null,
  format: NativeRasterFormat,
): Promise<Blob> {
  const expectedType = rasterMimeType(format);
  if (format !== "png" && blob?.type === "image/png") {
    await validateEncodedRasterBlob(blob, "png");
    throw new NativeRasterEncodingError(
      `The browser does not support ${expectedType} encoding.`,
      "raster-format-unsupported",
    );
  }
  if (
    !blob ||
    blob.type !== expectedType ||
    blob.size < 16 ||
    blob.size > MAX_ENCODED_BYTES
  )
    throw new NativeRasterEncodingError(
      `The browser did not produce a bounded ${expectedType} image.`,
    );
  const bytes = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
  if (!hasSignature(bytes, format, blob.size))
    throw new NativeRasterEncodingError(
      `The browser returned bytes that are not ${expectedType}.`,
    );
  return blob;
}

export async function validateEncodedPngViewport(
  blob: Blob,
  viewport: { width: number; height: number },
): Promise<void> {
  await validateEncodedRasterBlob(blob, "png");
  const header = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (
    header.getUint32(16) !== viewport.width ||
    header.getUint32(20) !== viewport.height
  )
    throw new NativeRasterEncodingError(
      "The captured PNG dimensions do not match the selected Design viewport.",
    );
}

const encoderProbes = new Map<NativeRasterFormat, Promise<boolean>>();

export async function canCanvasEncodeRasterFormat(
  format: NativeRasterFormat,
  canvas: HTMLCanvasElement,
): Promise<boolean> {
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext("2d");
  if (!context)
    throw new NativeRasterEncodingError(
      "The browser cannot create a raster encoder probe.",
    );
  // guard:allow-raw-color — fixed white test pixels identify the browser encoder, independent of editor theme.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 2, 2);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, rasterMimeType(format), 0.95),
  );
  if (format !== "png" && blob?.type === "image/png") {
    await validateEncodedRasterBlob(blob, "png");
    return false;
  }
  await validateEncodedRasterBlob(blob, format);
  return true;
}

export function probeNativeRasterEncoder(
  format: NativeRasterFormat,
): Promise<boolean> {
  const existing = encoderProbes.get(format);
  if (existing) return existing;
  const probe = canCanvasEncodeRasterFormat(
    format,
    document.createElement("canvas"),
  );
  encoderProbes.set(format, probe);
  void probe.catch(() => {
    if (encoderProbes.get(format) === probe) encoderProbes.delete(format);
  });
  return probe;
}
