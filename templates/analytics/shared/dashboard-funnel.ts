export interface DashboardFunnelItem {
  label: string;
  value: number;
  percentOfFirst: number;
  dropOffPercent: number | null;
}

export interface DashboardFunnelRows {
  labelKey: string;
  valueKey: string;
  items: DashboardFunnelItem[];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNumericValue(
  rows: Array<Record<string, unknown>>,
  key: string,
): boolean {
  return rows.some((row) => {
    const value = finiteNumber(row[key]);
    return value !== null && value >= 0;
  });
}

export function resolveDashboardFunnelRows(
  rows: Array<Record<string, unknown>>,
  configuredLabelKey?: string,
  configuredValueKey?: string,
): DashboardFunnelRows {
  if (rows.length === 0) {
    return { labelKey: "", valueKey: "", items: [] };
  }

  const columns = Object.keys(rows[0]);
  const columnSet = new Set(columns);
  const labelKey =
    (configuredLabelKey && columnSet.has(configuredLabelKey)
      ? configuredLabelKey
      : undefined) ||
    columns.find((key) =>
      rows.some((row) => typeof row[key] === "string" && row[key].trim()),
    ) ||
    columns[0] ||
    "";
  const valueKey =
    (configuredValueKey && columnSet.has(configuredValueKey)
      ? configuredValueKey
      : undefined) ||
    columns.find((key) => key !== labelKey && hasNumericValue(rows, key)) ||
    "";

  const parsed = rows.flatMap((row) => {
    const label = String(row[labelKey] ?? "").trim();
    const value = finiteNumber(row[valueKey]);
    if (!label || value === null || value < 0) return [];
    return [{ label, value }];
  });
  const firstValue = parsed[0]?.value ?? 0;

  return {
    labelKey,
    valueKey,
    items: parsed.map((item, index) => {
      const previousValue = parsed[index - 1]?.value;
      return {
        ...item,
        percentOfFirst: firstValue > 0 ? (item.value / firstValue) * 100 : 0,
        dropOffPercent:
          previousValue && previousValue > 0
            ? ((previousValue - item.value) / previousValue) * 100
            : null,
      };
    }),
  };
}
