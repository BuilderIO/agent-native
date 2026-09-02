import type { TriageCoverage } from "./contracts.js";
import type { PullRequestCheckObservation } from "./pr-monitor.js";

export const DEFAULT_BABYSIT_BOT_AUTHORS = [
  "builder-io-bot",
  "builder-io-bot[bot]",
  "builderio-bot",
  "builderio-bot[bot]",
  "builderio[bot]",
  "builder-io-integration",
  "builder-io-integration[bot]",
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
  checksCoverage?: TriageCoverage;
  failingJobLog?: string;
  botAuthors?: readonly string[];
  commentsTruncated?: boolean;
}

export interface BabysitProposal {
  unansweredComments: ReviewCommentObservation[];
  failingChecks: PullRequestCheckObservation[];
  missingChangesetPackages: string[];
  pendingChecks: PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
  commentsTruncated: boolean;
  isClean: boolean;
}

export interface BabysitWorkSignal {
  mergeable: boolean | null;
  mergeableState: string | null;
  snapshot: BabysitProposal;
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

export function shouldRequestBabysitWork(input: BabysitWorkSignal): boolean {
  return hasMergeConflict(input) || !input.snapshot.isClean;
}

export function hasCompletePassingChecks(input: {
  checks: readonly PullRequestCheckObservation[];
  checksCoverage?: TriageCoverage;
}): boolean {
  return (
    input.checksCoverage === "complete" &&
    input.checks.length > 0 &&
    input.checks.every((check) => check.state === "passed")
  );
}

export const DEFAULT_BABYSIT_PR_COMMENT =
  "@builderio-bot look at the latest PR feedback and fix anything you agree with. Be skeptical. Reply on each comment thread whether you fixed it and why. Get CI green and keep the branch mergeable.";

/** First unfinished episode, or new human feedback / real conflict. SHA and CI flicker are not a new episode. */
export function shouldPostBabysitComment(input: {
  previousFingerprint: string | null | undefined;
  fingerprint: string;
  previousState: string | null | undefined;
  lastCommentAtMs: number | null;
  nowMs: number;
  minCommentIntervalMs: number;
}): boolean {
  const intervalOk =
    input.lastCommentAtMs === null ||
    input.nowMs - input.lastCommentAtMs >= input.minCommentIntervalMs;
  if (!intervalOk) return false;
  const firstPokeForThisWork =
    input.lastCommentAtMs === null || input.previousState === "clean";
  return (
    firstPokeForThisWork || input.previousFingerprint !== input.fingerprint
  );
}

export const PARKED_BABYSIT_STATES = ["waiting", "quiet", "clean"] as const;

export function babysitLeavesReviewWindow(
  state: string | null | undefined,
): boolean {
  return state === "waiting" || state === "quiet" || state === "clean";
}

export function hasChangesRequested(
  reviewStates: readonly string[] | undefined,
): boolean {
  return (reviewStates ?? []).includes("changes_requested");
}

/** Record inbox/audit only when babysit state changes or a comment is posted. */
export function shouldRecordBabysitAudit(input: {
  previousState: string | null | undefined;
  nextState: string;
  posted: boolean;
}): boolean {
  return input.posted || input.previousState !== input.nextState;
}

export function isBabysitBotAuthor(
  author: string | null | undefined,
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): boolean {
  const login = author?.trim().toLowerCase();
  if (!login) return false;
  return botAuthors.some((bot) => bot.toLowerCase() === login);
}

export function countHumanReviewComments(
  comments: readonly { author: string; inReplyToId?: string | null }[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): number {
  return comments.filter(
    (comment) =>
      comment.inReplyToId == null &&
      !isBabysitBotAuthor(comment.author, botAuthors),
  ).length;
}

export function hasHumanChangesRequested(
  reviews: readonly { author: string; state: string }[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): boolean {
  return reviews.some(
    (review) =>
      review.state === "changes_requested" &&
      !isBabysitBotAuthor(review.author, botAuthors),
  );
}

/** New top-level human review work or a real conflict. Author replies, bot replies, and truncated totals do not reopen. */
export function shouldReopenParkedBabysit(input: {
  parked: boolean;
  storedMergeConflict: boolean;
  nextMergeConflict: boolean;
  storedChangesRequested: boolean;
  nextChangesRequested: boolean;
  storedCommentsTruncated: boolean;
  storedHumanReviewCommentCount: number | null | undefined;
  nextHumanReviewCommentCount: number | null | undefined;
}): boolean {
  if (!input.parked) return false;
  if (input.nextMergeConflict && !input.storedMergeConflict) return true;
  if (input.nextChangesRequested && !input.storedChangesRequested) return true;
  if (input.storedCommentsTruncated) return false;
  if (
    typeof input.nextHumanReviewCommentCount === "number" &&
    typeof input.storedHumanReviewCommentCount === "number" &&
    input.nextHumanReviewCommentCount > input.storedHumanReviewCommentCount
  ) {
    return true;
  }
  return false;
}

/** Work that may start another GitHub poke. SHA, CI flicker, and uncomputed mergeability do not. */
export function babysitFingerprint(input: {
  headSha?: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  snapshot: BabysitProposal;
  reviewStates?: readonly string[];
}): string {
  return JSON.stringify({
    unansweredComments: input.snapshot.unansweredComments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      isResolved: comment.isResolved ?? null,
    })),
    mergeConflict: hasMergeConflict({
      mergeable: input.mergeable,
      mergeableState: input.mergeableState,
    }),
    commentsTruncated: input.snapshot.commentsTruncated,
    changesRequested: hasChangesRequested(input.reviewStates),
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
  const checksCoverage = input.checksCoverage ?? "unknown";
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
    checksCoverage,
    commentsTruncated,
    isClean:
      hasCompletePassingChecks(input) &&
      !commentsTruncated &&
      unansweredComments.length === 0 &&
      failingChecks.length === 0 &&
      missingChangesetPackages.length === 0 &&
      pendingChecks.length === 0,
  };
}

export function formatBabysitAuditSummary(
  pullRequestNumber: number | null | undefined,
  clause: string,
): string {
  const label =
    typeof pullRequestNumber === "number" && pullRequestNumber > 0
      ? `#${pullRequestNumber}`
      : "Item";
  return `${label} ${clause}`;
}

export function babysitOutOfScopeClause(author: string | null): string {
  return author
    ? `skipped; author ${author} is out of scope.`
    : "skipped; out of scope.";
}
