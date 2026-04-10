import type { PivotConfig } from "./types";

/**
 * Convert long-form rows like
 *   [{ date: "2026-01-01", author: "Alice", value: 5 },
 *    { date: "2026-01-01", author: "Bob",   value: 3 }]
 * into wide-form like
 *   [{ date: "2026-01-01", Alice: 5, Bob: 3 }]
 *
 * Returns the pivoted rows plus the discovered series keys (in stable insertion order)
 * so the chart renderer can build one stack/line per series.
 */
export interface PivotResult {
  rows: Record<string, unknown>[];
  seriesKeys: string[];
}

export function pivotRows(
  rows: Record<string, unknown>[],
  config: PivotConfig,
): PivotResult {
  const { xKey, seriesKey, valueKey } = config;
  const byX = new Map<string, Record<string, unknown>>();
  const seriesKeys: string[] = [];
  const seenSeries = new Set<string>();

  for (const row of rows) {
    const xRaw = row[xKey];
    const x = xRaw instanceof Date ? xRaw.toISOString() : String(xRaw ?? "");
    const series = String(row[seriesKey] ?? "");
    if (!series) continue;

    if (!seenSeries.has(series)) {
      seenSeries.add(series);
      seriesKeys.push(series);
    }

    let bucket = byX.get(x);
    if (!bucket) {
      bucket = { [xKey]: row[xKey] };
      byX.set(x, bucket);
    }
    bucket[series] = row[valueKey];
  }

  // Preserve original x ordering by walking input rows once more
  const orderedRows: Record<string, unknown>[] = [];
  const emitted = new Set<string>();
  for (const row of rows) {
    const xRaw = row[xKey];
    const x = xRaw instanceof Date ? xRaw.toISOString() : String(xRaw ?? "");
    if (emitted.has(x)) continue;
    emitted.add(x);
    const bucket = byX.get(x);
    if (bucket) orderedRows.push(bucket);
  }

  return { rows: orderedRows, seriesKeys };
}
