export const PERIOD_LABELS = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
} as const;

export type Period = keyof typeof PERIOD_LABELS;

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function answerCountLabel(count: number): string {
  return `${count} ${count === 1 ? "answer" : "answers"}`;
}
