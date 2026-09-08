export function normalizeReportFilterSnapshot(
  filters: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    const k = key.trim();
    const v = String(value ?? "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function reportFilterSnapshotKey(
  filters: Record<string, string>,
): string {
  return Object.keys(filters)
    .sort()
    .map((key) => `${key}:${filters[key]}`)
    .join("\n");
}

export function savedReportFiltersForEdit(
  savedFilters: Record<string, string>,
): Record<string, string> {
  return normalizeReportFilterSnapshot(savedFilters);
}
