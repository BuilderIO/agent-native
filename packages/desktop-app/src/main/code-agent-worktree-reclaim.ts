export type CodeAgentWorktreeReclaimOutcome =
  | { status: "reclaimed" }
  | { status: "retry"; error?: string; nextAttemptAt?: string }
  | { status: "permanently-failed"; error: string };

export const CODE_AGENT_WORKTREE_RECLAIM_RETRY_BASE_MS = 5 * 60 * 1000;
export const CODE_AGENT_WORKTREE_RECLAIM_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

export function isPermanentCodeAgentWorktreeReclaimError(
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ambiguous argument|unknown revision|bad object|not a valid object name|refusing to clean up|unexpected branch|another repository|source repository/i.test(
    message,
  );
}

export function nextCodeAgentWorktreeReclaimAttempt(
  now: Date,
  previousAttempts: unknown,
): { attempts: number; nextAttemptAt: string } {
  const previous = Number(previousAttempts);
  const attempts =
    Number.isFinite(previous) && previous >= 0 ? Math.floor(previous) + 1 : 1;
  const delay = Math.min(
    CODE_AGENT_WORKTREE_RECLAIM_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 20),
    CODE_AGENT_WORKTREE_RECLAIM_RETRY_MAX_MS,
  );
  return {
    attempts,
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
}
