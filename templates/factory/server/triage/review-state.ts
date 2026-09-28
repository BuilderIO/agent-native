export interface TriageReviewSnapshot {
  title?: string | null;
  summary?: string | null;
  sourceUrl?: string | null;
  coverage?: string | null;
  lastSeenAt?: string | null;
  headSha?: string | null;
}

export function hasTriageSourceChanged(
  existing: TriageReviewSnapshot | undefined,
  next: TriageReviewSnapshot,
): boolean {
  if (!existing) return true;
  return (
    (next.title !== undefined && existing.title !== next.title) ||
    (next.summary !== undefined && existing.summary !== next.summary) ||
    (next.sourceUrl !== undefined && existing.sourceUrl !== next.sourceUrl) ||
    (next.coverage !== undefined && existing.coverage !== next.coverage) ||
    (next.lastSeenAt !== undefined &&
      existing.lastSeenAt !== next.lastSeenAt) ||
    (next.headSha !== undefined && existing.headSha !== next.headSha)
  );
}

export function statusAfterTriageSourceUpdate(
  existingStatus: string | undefined,
  sourceChanged: boolean,
  reviewStatus: string,
): string {
  return sourceChanged ? reviewStatus : (existingStatus ?? reviewStatus);
}

const STICKY_BABYSIT_STATES = new Set([
  "out-of-scope",
  "closed-or-draft",
  "merged",
  "owner-managed",
  "stuck",
]);

function sameGitHubLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function statusAfterPullRequestPoll(input: {
  existingStatus?: string;
  existingAuthor?: string;
  nextAuthor: string;
  existingBabysitState?: string;
  babysitReopened?: boolean;
  nextState: string;
  nextDraft: boolean;
  sourceChanged: boolean;
}): string {
  if (
    input.existingStatus === "merged" ||
    input.existingBabysitState === "merged"
  ) {
    return input.nextState === "open" && !input.nextDraft
      ? "pr_observed"
      : "merged";
  }
  if (input.babysitReopened) return "pr_observed";
  const sticky =
    (input.existingStatus === "needs_manual" ||
      input.existingStatus === "merged") &&
    Boolean(input.existingBabysitState) &&
    STICKY_BABYSIT_STATES.has(input.existingBabysitState!);
  if (sticky) {
    const authorChanged =
      Boolean(input.existingAuthor?.trim()) &&
      !sameGitHubLogin(input.existingAuthor ?? "", input.nextAuthor);
    const reopenedFromClosedOrDraft =
      input.existingBabysitState === "closed-or-draft" &&
      input.nextState === "open" &&
      !input.nextDraft;
    if (authorChanged || reopenedFromClosedOrDraft) return "pr_observed";
    return input.existingStatus === "merged" ? "merged" : "needs_manual";
  }
  return statusAfterTriageSourceUpdate(
    input.existingStatus,
    input.sourceChanged,
    "pr_observed",
  );
}
