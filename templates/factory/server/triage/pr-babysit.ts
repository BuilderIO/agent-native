import type { PullRequestCheckObservation } from "./pr-monitor.js";

export interface ReviewCommentObservation {
  id: string;
  author: string;
  inReplyToId: string | null;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  // Provider thread resolution. `undefined` means the provider could not tell
  // us — its lookup can fail or page out — so it is unknown, never resolved.
  isResolved?: boolean;
}

export interface BabysitInput {
  comments: readonly ReviewCommentObservation[];
  checks: readonly PullRequestCheckObservation[];
  failingJobLog?: string;
  botAuthors?: readonly string[];
  commentsTruncated?: boolean;
}

export interface BabysitProposal {
  unansweredComments: ReviewCommentObservation[];
  failingChecks: PullRequestCheckObservation[];
  missingChangesetPackages: string[];
  pendingChecks: PullRequestCheckObservation[];
  commentsTruncated: boolean;
  isClean: boolean;
}

const MISSING_CHANGESET_LINE = /^MISSING_CHANGESET_PACKAGES:\s*(.*)$/m;

function parseMissingChangesetPackages(log: string | undefined): string[] {
  const match = log ? MISSING_CHANGESET_LINE.exec(log) : null;
  if (!match) return [];
  return match[1]
    .split(",")
    .map((pkg) => pkg.trim())
    .filter((pkg) => pkg.length > 0);
}

// Provider resolution wins when the provider knows it. `undefined` falls back
// to reply state rather than clearing the thread: treating unknown as resolved
// would silently mark every open thread handled whenever the provider's
// resolution lookup fails.
function isAnswered(
  comment: ReviewCommentObservation,
  repliedToIds: ReadonlySet<string>,
): boolean {
  if (comment.isResolved !== undefined) return comment.isResolved;
  return repliedToIds.has(comment.id);
}

export function reconcileBabysitState(input: BabysitInput): BabysitProposal {
  const botAuthors = new Set(input.botAuthors ?? []);
  // Reply state, not a timestamp: a comment with any reply anywhere in the
  // set is answered, regardless of when it was posted relative to a prior
  // check. Filtering by "since" would re-hide an earlier unanswered round.
  const repliedToIds = new Set(
    input.comments
      .map((comment) => comment.inReplyToId)
      .filter((id): id is string => id !== null),
  );

  const unansweredComments = input.comments.filter(
    (comment) =>
      comment.inReplyToId === null &&
      !isAnswered(comment, repliedToIds) &&
      !botAuthors.has(comment.author),
  );
  const failingChecks = input.checks.filter(
    (check) => check.state === "failed",
  );
  const pendingChecks = input.checks.filter(
    (check) => check.state === "queued" || check.state === "in_progress",
  );
  const missingChangesetPackages = parseMissingChangesetPackages(
    input.failingJobLog,
  );

  // A capped comment page hides unanswered threads beyond it, which reads as
  // clean — the same false all-clear a "since" filter produces.
  const commentsTruncated = input.commentsTruncated === true;

  return {
    unansweredComments,
    failingChecks,
    missingChangesetPackages,
    pendingChecks,
    commentsTruncated,
    isClean:
      !commentsTruncated &&
      unansweredComments.length === 0 &&
      failingChecks.length === 0 &&
      missingChangesetPackages.length === 0 &&
      pendingChecks.length === 0,
  };
}
