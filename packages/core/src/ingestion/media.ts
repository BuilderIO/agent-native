import { createHash } from "node:crypto";

export interface MediaFingerprint {
  sha256: string;
  byteLength: number;
  mimeType?: string;
}

export function fingerprintMedia(
  data: Uint8Array,
  mimeType?: string,
): MediaFingerprint {
  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    byteLength: data.byteLength,
    ...(mimeType ? { mimeType } : {}),
  };
}

export function extractCssColors(value: string): string[] {
  const colors = new Set<string>();
  const pattern =
    /(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)|\b(?:transparent|currentColor)\b)/gi;
  for (const match of value.match(pattern) ?? []) colors.add(match.trim());
  return [...colors];
}

export function rankColorSamples(
  samples: readonly string[],
  limit = 24,
): string[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const normalized = sample.trim().replace(/\s+/g, " ").toLowerCase();
    if (
      !normalized ||
      normalized === "rgba(0, 0, 0, 0)" ||
      normalized === "transparent"
    )
      continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit))
    .map(([color]) => color);
}

export async function extractDominantColors(
  data: Uint8Array,
  limit = 6,
): Promise<string[]> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error(
      "Image palette extraction requires the optional sharp dependency.",
    );
  }
  const output = await sharp(Buffer.from(data), { failOn: "none" })
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, number>();
  for (let index = 0; index < output.data.length; index += 3) {
    const key = [
      output.data[index],
      output.data[index + 1],
      output.data[index + 2],
    ]
      .map((channel) => Math.round(channel / 32) * 32)
      .map((channel) =>
        Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"),
      )
      .join("");
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([hex]) => `#${hex.toUpperCase()}`);
}

export interface CroppedImageRegion {
  data: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
}

export async function compareRasterImages(input: {
  source: Uint8Array;
  rendered: Uint8Array;
  maxInputBytes?: number;
}): Promise<{ meanAbsoluteDifference: number; width: number; height: number }> {
  const maxInputBytes = input.maxInputBytes ?? 20 * 1024 * 1024;
  if (
    input.source.byteLength > maxInputBytes ||
    input.rendered.byteLength > maxInputBytes
  ) {
    throw new Error(`Image comparison input exceeds ${maxInputBytes} bytes.`);
  }
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error("Image comparison requires the optional sharp dependency.");
  }
  const source = sharp(Buffer.from(input.source), { failOn: "none" });
  const rendered = sharp(Buffer.from(input.rendered), { failOn: "none" });
  const [sourceMetadata, renderedMetadata] = await Promise.all([
    source.metadata(),
    rendered.metadata(),
  ]);
  if (
    !sourceMetadata.width ||
    !sourceMetadata.height ||
    sourceMetadata.width !== renderedMetadata.width ||
    sourceMetadata.height !== renderedMetadata.height ||
    sourceMetadata.channels !== renderedMetadata.channels
  ) {
    throw new Error(
      "Image comparison requires identical dimensions and channels.",
    );
  }
  const [sourcePixels, renderedPixels] = await Promise.all([
    source.raw().toBuffer(),
    rendered.raw().toBuffer(),
  ]);
  if (sourcePixels.byteLength !== renderedPixels.byteLength) {
    throw new Error("Image comparison buffers have different lengths.");
  }
  let difference = 0;
  for (let index = 0; index < sourcePixels.length; index++) {
    difference += Math.abs(sourcePixels[index]! - renderedPixels[index]!);
  }
  return {
    meanAbsoluteDifference: difference / sourcePixels.length,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
  };
}

/** Crops a bounded raster region without retaining the source image. */
export async function cropImageRegion(input: {
  data: Uint8Array;
  left: number;
  top: number;
  width: number;
  height: number;
  maxInputBytes?: number;
  maxOutputPixels?: number;
}): Promise<CroppedImageRegion> {
  const maxInputBytes = input.maxInputBytes ?? 20 * 1024 * 1024;
  const maxOutputPixels = input.maxOutputPixels ?? 16_000_000;
  if (input.data.byteLength > maxInputBytes) {
    throw new Error(`Image crop input exceeds ${maxInputBytes} bytes.`);
  }
  const region = Object.fromEntries(
    (["left", "top", "width", "height"] as const).map((key) => [
      key,
      Math.round(input[key]),
    ]),
  ) as { left: number; top: number; width: number; height: number };
  if (
    region.left < 0 ||
    region.top < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.width * region.height > maxOutputPixels
  ) {
    throw new Error("Image crop region is invalid or exceeds the pixel limit.");
  }
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error("Image cropping requires the optional sharp dependency.");
  }
  const pipeline = sharp(Buffer.from(input.data), { failOn: "none" });
  const metadata = await pipeline.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    region.left + region.width > metadata.width ||
    region.top + region.height > metadata.height
  ) {
    throw new Error("Image crop region falls outside the source image.");
  }
  const data = await pipeline.extract(region).png().toBuffer();
  return {
    data: new Uint8Array(data),
    mimeType: "image/png",
    width: region.width,
    height: region.height,
  };
}

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Remote artifact exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Remote artifact exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

interface SharpPipeline {
  resize(
    width: number,
    height: number,
    options: { fit: "inside" },
  ): SharpPipeline;
  removeAlpha(): SharpPipeline;
  metadata(): Promise<{ width?: number; height?: number; channels?: number }>;
  extract(region: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): SharpPipeline;
  png(): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  raw(): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Uint8Array }>;
}

type SharpFactory = (
  data: Buffer,
  options: { failOn: "none" },
) => SharpPipeline;

async function loadSharp(): Promise<SharpFactory | null> {
  const specifier = "sharp";
  try {
    const module = (await import(/* @vite-ignore */ specifier)) as {
      default?: SharpFactory;
    };
    return module.default ?? (module as unknown as SharpFactory);
  } catch {
    return null;
  }
}
