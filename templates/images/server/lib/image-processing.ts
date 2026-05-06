import sharp from "sharp";

export async function imageInfo(buffer: Buffer): Promise<{
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: number;
}> {
  const img = sharp(buffer, { failOn: "none" });
  const meta = await img.metadata();
  const format = meta.format === "jpeg" ? "jpeg" : meta.format || "png";
  return {
    width: meta.width ?? null,
    height: meta.height ?? null,
    mimeType:
      format === "jpg" || format === "jpeg" ? "image/jpeg" : `image/${format}`,
    sizeBytes: buffer.byteLength,
  };
}

export async function makeThumbnail(buffer: Buffer): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  return {
    buffer: await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer(),
    mimeType: "image/webp",
  };
}

export async function extractDominantColors(buffer: Buffer): Promise<string[]> {
  const { data } = await sharp(buffer, { failOn: "none" })
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, number>();
  for (let i = 0; i < data.length; i += 3) {
    const r = Math.round(data[i] / 32) * 32;
    const g = Math.round(data[i + 1] / 32) * 32;
    const b = Math.round(data[i + 2] / 32) * 32;
    const key = [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
      .join("");
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => `#${hex.toUpperCase()}`);
}

export async function compositeLogo(input: {
  image: Buffer;
  logo: Buffer;
}): Promise<Buffer> {
  const base = sharp(input.image, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const logoWidth = Math.max(120, Math.round(width * 0.16));
  const logoBuffer = await sharp(input.logo, { failOn: "none" })
    .resize({ width: logoWidth, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const inset = Math.max(24, Math.round(Math.min(width, height) * 0.035));
  return base
    .composite([
      { input: logoBuffer, top: inset, left: width - logoWidth - inset },
    ])
    .png()
    .toBuffer();
}

export function hasRasterImageSignature(
  mimeType: string,
  data: Uint8Array,
): boolean {
  if (mimeType === "image/png") {
    return (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }
  if (mimeType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  if (mimeType === "image/avif") {
    return Buffer.from(data.subarray(4, 12)).toString("ascii").includes("ftyp");
  }
  return false;
}
