
export type BurnStatus = "running" | "done" | "failed";

interface BurnState {
  status: BurnStatus;
  percent: number;
  updatedAt: number;
  error?: string;
}

const STALE_MS = 30 * 60 * 1000;
const OUTCOME_MS = 5 * 60 * 1000;

const burns = new Map<string, BurnState>();

function sweep(now: number): void {
  for (const [id, entry] of burns) {
    const limit = entry.status === "running" ? STALE_MS : OUTCOME_MS;
    if (now - entry.updatedAt > limit) burns.delete(id);
  }
}

/**
 * Claim a recording for a burn. False when one is already under way — two
 * re-encodes of the same clip would race to replace the same file, and the
 * loser would delete the winner's.
 */
export function startBurn(recordingId: string): boolean {
  const now = Date.now();
  sweep(now);
  const existing = burns.get(recordingId);
  if (existing?.status === "running") return false;
  burns.set(recordingId, { status: "running", percent: 0, updatedAt: now });
  return true;
}

export function setBurnProgress(recordingId: string, percent: number): void {
  const entry = burns.get(recordingId);
  if (!entry || entry.status !== "running") return;
  entry.percent = Math.max(
    entry.percent,
    Math.max(0, Math.min(99, Math.round(percent))),
  );
  entry.updatedAt = Date.now();
}

export function finishBurn(recordingId: string): void {
  burns.set(recordingId, {
    status: "done",
    percent: 100,
    updatedAt: Date.now(),
  });
}

export function failBurn(recordingId: string, error: string): void {
  burns.set(recordingId, {
    status: "failed",
    percent: 0,
    updatedAt: Date.now(),
    error,
  });
}

export interface BurnProgressReport {
  status: BurnStatus | "idle";
  percent: number;
  error?: string;
}

export function getBurnProgress(recordingId: string): BurnProgressReport {
  sweep(Date.now());
  const entry = burns.get(recordingId);
  if (!entry) return { status: "idle", percent: 0 };
  return {
    status: entry.status,
    percent: entry.percent,
    ...(entry.error ? { error: entry.error } : {}),
  };
}
