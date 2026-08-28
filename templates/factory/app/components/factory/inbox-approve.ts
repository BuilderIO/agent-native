const BLOCKED_ITEM_STATUSES = new Set([
  "automation_started",
  "auto_approved",
  "merged",
  "classified",
]);

const BLOCKED_RUN_STATUSES = new Set([
  "submitted",
  "acknowledged",
  "running",
  "completed",
]);

export function canStartFactoryApproval({
  hasDecision,
  itemStatus,
  runs,
}: {
  hasDecision: boolean;
  itemStatus?: string | null;
  runs: Array<{ status?: string | null }>;
}): boolean {
  if (!hasDecision) return false;
  if (BLOCKED_ITEM_STATUSES.has((itemStatus ?? "").toLowerCase())) return false;
  return !runs.some((run) =>
    BLOCKED_RUN_STATUSES.has((run.status ?? "").toLowerCase()),
  );
}
