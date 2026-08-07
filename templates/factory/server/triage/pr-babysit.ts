import type { PullRequestCheckObservation } from "./pr-monitor.js";

export const BUILDER_BOT_LOGINS = new Set([
  "builder-io-bot",
  "builder-io-bot[bot]",
  "builderio-bot",
  "builderio-bot[bot]",
  "builderio[bot]",
]);

export const DEFAULT_BABYSIT_BOT_AUTHORS = [
  "builder-io-bot",
  "builder-io-bot[bot]",
  "builderio-bot",
  "builderio-bot[bot]",
  "builderio[bot]",
  "github-actions",
  "github-actions[bot]",
  "dependabot[bot]",
] as const;

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

export interface BuilderBotBabysitSignal {
  author: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  snapshot: BabysitProposal;
}

export function isBuilderBotLogin(login: string): boolean {
  return BUILDER_BOT_LOGINS.has(login.trim().toLowerCase());
}

export function hasMergeConflict(input: {
  mergeable: boolean | null;
  mergeableState: string | null;
}): boolean {
  return (
    input.mergeable === false ||
    input.mergeableState === "dirty" ||
    input.mergeableState === "conflicting"
  );
}

export function shouldBabysitBuilderBotPullRequest(
  input: BuilderBotBabysitSignal,
): boolean {
  return (
    isBuilderBotLogin(input.author) &&
    (hasMergeConflict(input) || !input.snapshot.isClean)
  );
}

export function babysitFingerprint(input: {
  headSha: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  snapshot: BabysitProposal;
  reviewStates?: readonly string[];
}): string {
  return JSON.stringify({
    headSha: input.headSha,
    mergeable: input.mergeable,
    mergeableState: input.mergeableState,
    unansweredComments: input.snapshot.unansweredComments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      isResolved: comment.isResolved ?? null,
    })),
    failingChecks: input.snapshot.failingChecks.map((check) => check.name),
    pendingChecks: input.snapshot.pendingChecks.map((check) => check.name),
    missingChangesetPackages: input.snapshot.missingChangesetPackages,
    commentsTruncated: input.snapshot.commentsTruncated,
    reviewStates: input.reviewStates ?? [],
  });
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

// A reply is an explicit human response even when the provider still reports
// the thread as unresolved. That covers a deliberate "won't fix" explanation;
// provider resolution handles outdated threads with no reply.
function isAnswered(
  comment: ReviewCommentObservation,
  repliedToIds: ReadonlySet<string>,
): boolean {
  if (repliedToIds.has(comment.id)) return true;
  if (comment.isResolved !== undefined) return comment.isResolved;
  return false;
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
    (check) => check.state === "failed" || check.state === "cancelled",
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
