export function formatSubmittedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const FILTERS = ["all", "completed", "partial"] as const;
export type Filter = (typeof FILTERS)[number];

export function parseFilter(value: string | null): Filter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}
