export function isClaimedSlackReactionName(
  name: string | null | undefined,
): boolean {
  const normalized = name?.trim().toLowerCase();
  return normalized === "eyes";
}

const STARTED_STATUSES: ReadonlySet<string> = new Set([
  "automation_started",
  "evidence_ready",
]);

export function slackFeedbackLeavesReviewWindow(input: {
  status: string;
  slackReactionName?: string | null;
}): boolean {
  return (
    STARTED_STATUSES.has(input.status) ||
    isClaimedSlackReactionName(input.slackReactionName)
  );
}
