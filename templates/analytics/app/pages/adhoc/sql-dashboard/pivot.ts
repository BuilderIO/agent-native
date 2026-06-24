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

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAILY_GAP_FILL_DAYS = 800;

function dayToUtcMs(day: string): number | null {
  if (!ISO_DAY_RE.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, date);
  return Number.isFinite(ms) ? ms : null;
}

function utcMsToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fillMissingSeries(
  row: Record<string, unknown>,
  seriesKeys: string[],
): Record<string, unknown> {
  for (const key of seriesKeys) {
    if (!(key in row)) row[key] = 0;
  }
  return row;
}

function fillMissingDailyRows(
  rows: Record<string, unknown>[],
  xKey: string,
  seriesKeys: string[],
): Record<string, unknown>[] {
  if (rows.length < 2 || seriesKeys.length === 0) return rows;

  const first = rows[0]?.[xKey];
  const last = rows[rows.length - 1]?.[xKey];
  if (typeof first !== "string" || typeof last !== "string") return rows;

  const startMs = dayToUtcMs(first);
  const endMs = dayToUtcMs(last);
  if (startMs == null || endMs == null || endMs < startMs) return rows;

  const dayCount = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (dayCount > MAX_DAILY_GAP_FILL_DAYS) return rows;

  const byDay = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const day = row[xKey];
    if (typeof day === "string" && ISO_DAY_RE.test(day)) {
      byDay.set(day, row);
    }
  }

  const filled: Record<string, unknown>[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const day = utcMsToDay(ms);
    filled.push(
      fillMissingSeries(byDay.get(day) ?? { [xKey]: day }, seriesKeys),
    );
  }
  return filled;
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
    if (bucket) orderedRows.push(fillMissingSeries(bucket, seriesKeys));
  }

  return {
    rows: fillMissingDailyRows(orderedRows, xKey, seriesKeys),
    seriesKeys,
  };
}
