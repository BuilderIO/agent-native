export interface TriageReviewSnapshot {
  title?: string | null;
  summary?: string | null;
  sourceUrl?: string | null;
  coverage?: string | null;
  lastSeenAt?: string | null;
  headSha?: string | null;
}

/** Reopen an item only when the provider evidence changed since the last poll. */
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

// `sourceChanged` ignores GitHub's updatedAt, but it also ignores comments, so
// a needs_manual babysit decision has to be preserved explicitly or the next
// poll flips it back to pr_observed and the Inbox status flaps.
const STICKY_BABYSIT_STATES = new Set([
  "out-of-scope",
  "closed-or-draft",
  "owner-managed",
  "stuck",
]);

function sameGitHubLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Keep a babysit skip out of pr_observed until author or draft/open state can change the decision. */
export function statusAfterPullRequestPoll(input: {
  existingStatus?: string;
  existingAuthor?: string;
  nextAuthor: string;
  existingBabysitState?: string;
  babysitReopened?: boolean;
  nextDraft: boolean;
  sourceChanged: boolean;
}): string {
  // The babysit layer found new human review work, which GitHub's title, body,
  // and head SHA do not reflect. Without this a reopened item keeps its
  // needs_manual status and never returns to the review window.
  if (input.babysitReopened) return "pr_observed";
  const sticky =
    input.existingStatus === "needs_manual" &&
    Boolean(input.existingBabysitState) &&
    STICKY_BABYSIT_STATES.has(input.existingBabysitState!);
  if (sticky) {
    const authorChanged =
      Boolean(input.existingAuthor?.trim()) &&
      !sameGitHubLogin(input.existingAuthor ?? "", input.nextAuthor);
    const reopenedFromClosedOrDraft =
      input.existingBabysitState === "closed-or-draft" && !input.nextDraft;
    if (authorChanged || reopenedFromClosedOrDraft) return "pr_observed";
    return "needs_manual";
  }
  return statusAfterTriageSourceUpdate(
    input.existingStatus,
    input.sourceChanged,
    "pr_observed",
  );
}
