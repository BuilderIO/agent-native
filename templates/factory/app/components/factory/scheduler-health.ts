/** What `get-factory-automation-health` returns. */
export interface SchedulerHealth {
  status: "healthy" | "stale" | "error" | "no-data";
  lastCheckedAt?: number | null;
  lastError?: string | null;
}

export type SchedulerWord = "healthy" | "stale" | "error" | "noHeartbeat";

type SchedulerView =
  /** The health read itself failed, which says nothing about the scheduler. */
  | { kind: "unreadable"; message: string }
  | {
      kind: "reported";
      word: SchedulerWord;
      lastCheckedAt: number | null;
      lastError: string | null;
    };

const WORDS: Record<SchedulerHealth["status"], SchedulerWord> = {
  healthy: "healthy",
  stale: "stale",
  error: "error",
  "no-data": "noHeartbeat",
};

export function schedulerView(
  health: SchedulerHealth | undefined,
  readError: unknown,
): SchedulerView | null {
  if (readError) {
    return {
      kind: "unreadable",
      message:
        readError instanceof Error ? readError.message : String(readError),
    };
  }
  if (!health) return null;
  return {
    kind: "reported",
    word: WORDS[health.status],
    lastCheckedAt: health.lastCheckedAt ?? null,
    lastError: health.lastError || null,
  };
}
