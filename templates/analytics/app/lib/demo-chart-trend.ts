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
  series: number[],
  minimum: number,
  range: number,
  volatilityScore: number,
  random: () => number,
): number[] {
  const length = series.length;
  if (length <= 1) return [0];
  if (length === 2) return [0, 1];

  const normalized = series.map((value) => (value - minimum) / range);
  const randomization = 0.012 + volatilityScore * 0.08;
  const shape = [normalized[0]];

  // Preserve the source's actual step pattern (including when and how sharply
  // it spikes), with just enough seeded variation that otherwise-similar demo
  // series do not become identical. Smooth sources receive almost no jitter;
  // volatile sources can vary a little more without moving their events.
  for (let index = 1; index < length; index += 1) {
    const sourceStep = normalized[index] - normalized[index - 1];
    const factor = 1 + (random() * 2 - 1) * randomization;
    shape.push(shape[index - 1] + sourceStep * factor);
  }

  // Add only the linear drift required for the first point to be the global
  // minimum and the last to be the global maximum. A linear term has zero
  // second difference, so the source's local acceleration, spikes, and dips
  // survive instead of being replaced by a synthetic random walk.
  let requiredDrift = 0;
  for (let index = 1; index < length; index += 1) {
    const progress = index / (length - 1);
    requiredDrift = Math.max(
      requiredDrift,
      (shape[0] - shape[index]) / progress,
    );
  }
  for (let index = 0; index < length - 1; index += 1) {
    const progress = index / (length - 1);
    requiredDrift = Math.max(
      requiredDrift,
      (shape[index] - shape[length - 1]) / (1 - progress),
    );
  }

  const drift = requiredDrift + 0.012 + random() * 0.018;
  const candidate = shape.map(
    (value, index) => value + drift * (index / (length - 1)),
  );
  const candidateRange = candidate[length - 1] - candidate[0];
  return candidate.map((value) => (value - candidate[0]) / candidateRange);
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
    const trend = normalizedTrend(
      points.map((point) => point.numeric),
      minimum,
      range,
      volatilityScore,
      random,
    );
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
