/**
 * The state of a redaction burn that is running in the background.
 *
 * The burn cannot be an action's return value: a full re-encode takes minutes
 * and the framework gives an action sixty seconds. So the action validates,
 * starts the work and comes straight back, and the editor follows it here.
 *
 * Deliberately in process memory rather than in the database. It is written
 * several times a second, it is worthless once the burn is over, and the
 * reader is a poll from the browser tab that started it — persisting it buys
 * nothing and puts session scoping and whatever else is queued between the
 * number and the person waiting for it. A restart mid-burn loses the
 * reporting, which is honest: the burn is lost too.
 */

export type BurnStatus = "running" | "done" | "failed";

interface BurnState {
  status: BurnStatus;
  percent: number;
  updatedAt: number;
  error?: string;
}

/** Forget a burn nothing has reported on for this long. */
const STALE_MS = 30 * 60 * 1000;
/** How long an outcome stays readable, so the editor can pick it up. */
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
    // Never 100 until it is actually done: a bar sitting at 100% while work
    // continues is worse than one sitting at 99%.
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
