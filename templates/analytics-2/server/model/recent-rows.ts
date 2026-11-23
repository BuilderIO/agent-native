/** Keep the newest row for each resource, identified by kind and ID. */

export type RecentRow = {
  id: string;
  title: string;
  kind: "project" | "thread" | "collection" | "data";
  href: string;
  /** Sortable timestamp; the newest row of a collapsed group keeps the slot. */
  timestamp: string;
};

export function collapseRecentRows<T extends RecentRow>(
  rows: readonly T[],
): T[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of sorted) {
    const key = `${row.kind}\u0000${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}
