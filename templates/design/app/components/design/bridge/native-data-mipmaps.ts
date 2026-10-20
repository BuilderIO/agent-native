export type NativeDataMipLevel = {
  width: number;
  height: number;
  bytes: Uint8Array;
};

export class NativeDataMipError extends Error {
  constructor(readonly code: "invalid-raster" | "limit") {
    super(code);
    this.name = "NativeDataMipError";
  }
}

export function buildNativeDataMipmaps(source: {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}): {
  levels: NativeDataMipLevel[];
  totalBytes: number;
} {
  if (
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width < 1 ||
    source.height < 1 ||
    !(
      source.data instanceof Uint8Array ||
      source.data instanceof Uint8ClampedArray
    ) ||
    source.data.length !== source.width * source.height * 4
  )
    throw new NativeDataMipError("invalid-raster");
  if (
    source.width > 4096 ||
    source.height > 4096 ||
    source.width * source.height > 4_194_304
  )
    throw new NativeDataMipError("limit");
  const levels: NativeDataMipLevel[] = [
    {
      width: source.width,
      height: source.height,
      bytes: Uint8Array.from(source.data),
    },
  ];
  let totalBytes = levels[0].bytes.byteLength;
  while (
    levels[levels.length - 1]!.width > 1 ||
    levels[levels.length - 1]!.height > 1
  ) {
    const prior = levels[levels.length - 1]!;
    const width = Math.max(1, Math.floor(prior.width / 2));
    const height = Math.max(1, Math.floor(prior.height / 2));
    const bytes = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let count = 0;
        const sums = [0, 0, 0, 0];
        const left = Math.floor((x * prior.width) / width);
        const right = Math.floor(((x + 1) * prior.width) / width);
        const top = Math.floor((y * prior.height) / height);
        const bottom = Math.floor(((y + 1) * prior.height) / height);
        for (let sy = top; sy < bottom; sy += 1) {
          for (let sx = left; sx < right; sx += 1) {
            const index = (sy * prior.width + sx) * 4;
            for (let channel = 0; channel < 4; channel += 1)
              sums[channel] += prior.bytes[index + channel];
            count += 1;
          }
        }
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1)
          bytes[index + channel] = Math.round(sums[channel] / count);
      }
    }
    levels.push({ width, height, bytes });
    totalBytes += bytes.byteLength;
  }
  return { levels, totalBytes };
}
