type DemoTrendSeed = string | number;

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedVolatility(
  series: number[],
  minimum: number,
  range: number,
) {
  if (series.length < 3 || range === 0) return 0;
  const normalized = series.map((value) => (value - minimum) / range);
  const averageStep =
    (normalized[normalized.length - 1] - normalized[0]) /
    (normalized.length - 1);
  const deviation = normalized
    .slice(1)
    .reduce(
      (total, value, index) =>
        total + Math.abs(value - normalized[index] - averageStep),
      0,
    );
  return clamp((deviation / (normalized.length - 1)) * 1.4, 0, 1);
}

function normalizedTrend(
  length: number,
  volatilityScore: number,
  random: () => number,
): number[] {
  if (length <= 1) return [0];
  if (length === 2) return [0, 1];

  const volatility = 0.015 + volatilityScore * (0.22 + random() * 0.12);
  const noiseMemory = 0.78 - volatilityScore * 0.58;
  let noise = 0;
  const values = Array.from({ length }, (_, index) => {
    if (index === 0) return 0;
    if (index === length - 1) return 1;

    const progress = index / (length - 1);
    noise = noise * noiseMemory + (random() * 2 - 1) * (1 - noiseMemory);
    const taperedNoise = noise * volatility * Math.sin(Math.PI * progress);
    return clamp(progress + taperedNoise, 0.025, 0.975);
  });

  // Pullback count and depth follow the source's normalized volatility. A
  // smooth source remains a gentle rise; a jagged source gets several seeded
  // reversals. Spacing the reversals across the series prevents them from
  // collapsing into one noisy patch.
  if (length >= 5 && volatilityScore >= 0.12) {
    const maximumPullbacks = Math.min(3, Math.floor((length - 2) / 2));
    const pullbackCount = Math.max(
      1,
      Math.round(volatilityScore * maximumPullbacks),
    );
    for (let pullback = 0; pullback < pullbackCount; pullback += 1) {
      const segmentCenter =
        ((pullback + 1) * (length - 3)) / (pullbackCount + 1) + 1;
      const jitter = (random() - 0.5) * Math.max(1, length / 10);
      const dipIndex = Math.round(clamp(segmentCenter + jitter, 2, length - 2));
      const center = dipIndex / (length - 1);
      const amplitude = 0.025 + volatilityScore * (0.075 + random() * 0.12);
      values[dipIndex - 1] = clamp(center + amplitude, 0.075, 0.925);
      values[dipIndex] = clamp(center - amplitude, 0.05, 0.9);
    }
  }

  return values;
}

/**
 * Replace numeric chart series with a stable, seeded upward trend while
 * retaining the query's original range and every non-series field. This is a
 * presentation-only demo-mode transform: callers keep the real query result
 * and opt individual line/area renderers into the returned rows.
 */
export function createDemoChartTrendRows(
  rows: Record<string, unknown>[],
  yKeys: string[],
  seed: DemoTrendSeed,
): Record<string, unknown>[] {
  if (rows.length === 0 || yKeys.length === 0) return rows;

  let output: Record<string, unknown>[] | null = null;

  for (const yKey of yKeys) {
    const points = rows.flatMap((row, rowIndex) => {
      const numeric = numericValue(row[yKey]);
      return numeric === null
        ? []
        : [{ rowIndex, numeric, original: row[yKey] }];
    });

    if (points.length < 2) continue;

    const minimum = Math.min(...points.map((point) => point.numeric));
    const maximum = Math.max(...points.map((point) => point.numeric));
    if (minimum === maximum) continue;

    const random = createRandom(`${String(seed)}:${yKey}`);
    const range = maximum - minimum;
    const volatilityScore = normalizedVolatility(
      points.map((point) => point.numeric),
      minimum,
      range,
    );
    const trend = normalizedTrend(points.length, volatilityScore, random);
    const useStringValues = points.every(
      (point) => typeof point.original === "string",
    );

    output ??= rows.map((row) => ({ ...row }));
    points.forEach((point, pointIndex) => {
      const numeric =
        pointIndex === 0
          ? minimum
          : pointIndex === points.length - 1
            ? maximum
            : minimum + trend[pointIndex] * range;
      output![point.rowIndex][yKey] = useStringValues
        ? String(numeric)
        : numeric;
    });
  }

  return output ?? rows;
}
