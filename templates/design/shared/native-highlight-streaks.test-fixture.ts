export type HighlightStreaksPixel = readonly [number, number, number, number];

export interface HighlightStreaksOracleInput {
  width: number;
  height: number;
  pixels: readonly HighlightStreaksPixel[];
  density: { numerator: number; denominator: number };
  runWidth: number;
  threshold: number;
  amount: number;
}

export const HIGHLIGHT_STREAKS_RGBA16F_ABSOLUTE_TOLERANCE = 1 / 512;

export function highlightStreaksOracle(input: HighlightStreaksOracleInput) {
  const { width, height, pixels, density, runWidth, threshold, amount } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height ||
    !Number.isSafeInteger(density.numerator) ||
    !Number.isSafeInteger(density.denominator) ||
    density.numerator < 1 ||
    density.denominator < 1 ||
    !Number.isInteger(runWidth) ||
    runWidth < 1 ||
    runWidth > 16 ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1 ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 1
  )
    throw new TypeError("Invalid Highlight Streaks oracle input");
  const anchors = new Uint32Array(pixels.length);
  const buckets = new Uint32Array(pixels.length);
  const output: HighlightStreaksPixel[] = [];
  for (let y = 0; y < height; y++) {
    const segments = new Map<number, number[]>();
    for (let x = 0; x < width; x++) {
      const bucket = Number(
        (BigInt(2 * x + 1) * BigInt(density.denominator)) /
          (2n * BigInt(runWidth) * BigInt(density.numerator)),
      );
      const indices = segments.get(bucket);
      if (indices) indices.push(x);
      else segments.set(bucket, [x]);
      buckets[y * width + x] = bucket;
    }
    for (const indices of segments.values()) {
      if (
        BigInt(runWidth) * BigInt(density.numerator) <
        BigInt(density.denominator)
      )
        continue;
      let winner: number | null = null;
      let greatest = -Infinity;
      for (const x of indices) {
        const [r, g, b, alpha] = pixels[y * width + x]!;
        if (alpha <= 0.00001) continue;
        const straightRed = r / alpha;
        const straightGreen = g / alpha;
        const straightBlue = b / alpha;
        const luminance =
          0.2126 * straightRed + 0.7152 * straightGreen + 0.0722 * straightBlue;
        if (luminance >= threshold && luminance > greatest) {
          greatest = luminance;
          winner = x;
        }
      }
      for (const x of indices)
        anchors[y * width + x] = winner === null ? 0 : winner + 1;
    }
    for (let x = 0; x < width; x++) {
      const linear = y * width + x;
      const original = pixels[linear]!;
      const anchor = anchors[linear]!;
      if (anchor === 0 || amount === 0 || original[3] <= 0.00001) {
        output.push([...original]);
        continue;
      }
      const chosen = pixels[y * width + anchor - 1]!;
      const alpha = original[3];
      output.push([
        original[0] * (1 - amount) + ((chosen[0] * alpha) / chosen[3]) * amount,
        original[1] * (1 - amount) + ((chosen[1] * alpha) / chosen[3]) * amount,
        original[2] * (1 - amount) + ((chosen[2] * alpha) / chosen[3]) * amount,
        alpha,
      ]);
    }
  }
  return { anchors, buckets, pixels: output };
}

export const HIGHLIGHT_STREAKS_GOLDEN: HighlightStreaksOracleInput = {
  width: 5,
  height: 1,
  pixels: [
    [0, 0, 0, 1],
    [1, 0, 0, 1],
    [0.5, 0.5, 0.5, 0.5],
    [0, 0, 1, 1],
    [0, 1, 0, 1],
  ],
  density: { numerator: 1, denominator: 1 },
  runWidth: 4,
  threshold: 0.1,
  amount: 1,
};
