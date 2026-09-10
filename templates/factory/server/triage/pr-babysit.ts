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

export interface HumanReviewObservation {
  author: string;
  state: string;
  body?: string | null;
  htmlUrl?: string | null;
}

export interface BabysitInput {
  comments: readonly ReviewCommentObservation[];
  checks: readonly PullRequestCheckObservation[];
  checksCoverage?: TriageCoverage;
  failingJobLog?: string;
  botAuthors?: readonly string[];
  commentsTruncated?: boolean;
  reviews?: readonly HumanReviewObservation[];
  reviewsTruncated?: boolean;
}

export interface BabysitProposal {
  unansweredComments: ReviewCommentObservation[];
  failingChecks: PullRequestCheckObservation[];
  missingChangesetPackages: string[];
  pendingChecks: PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
  commentsTruncated: boolean;
  reviewsTruncated: boolean;
  humanReviewBodyKeys: string[];
  isClean: boolean;
}

/**
 * `mergeConflict` is the caller's resolved answer, not a raw GitHub reading.
 * Deriving it here would let an uncomputed read flip a conflicted branch to
 * clean, which restarts the episode and earns the pull request another ping.
 */
export interface BabysitWorkSignal {
  mergeConflict: boolean;
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
  return input.mergeConflict || !input.snapshot.isClean;
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

/** Shared by the read-only briefing and the write action so their verdicts cannot diverge. */
export const MIN_BABYSIT_COMMENT_INTERVAL_MS = 90_000;

/** How many times Factory's own hardcoded request is already on the pull request. */
export function countBabysitComments(
  comments: readonly { body: string }[],
  body: string = DEFAULT_BABYSIT_PR_COMMENT,
): number {
  const target = body.trim();
  return comments.filter((comment) => comment.body.trim() === target).length;
}

export function mergeabilityComputed(input: {
  mergeable: boolean | null;
  mergeableState: string | null;
}): boolean {
  return input.mergeable !== null && input.mergeableState !== "unknown";
}

export interface StoredMergeability {
  mergeConflict: boolean | null | undefined;
  mergeabilityComputed: boolean | null | undefined;
}

/**
 * GitHub computes mergeability lazily, so the first read of a pull request
 * answers null and a later read answers for real. Holding the last definite
 * reading keeps that computation from looking like a changed branch. The two
 * fields move together: overwriting the conflict bit while dropping the
 * definite flag would erase the basis every rising-edge check depends on.
 */
export function resolveStickyMergeability(
  stored: StoredMergeability,
  live: { mergeable: boolean | null; mergeableState: string | null },
): { mergeConflict: boolean; mergeabilityComputed: boolean } {
  if (mergeabilityComputed(live)) {
    return {
      mergeConflict: hasMergeConflict(live),
      mergeabilityComputed: true,
    };
  }
  return {
    mergeConflict: stored.mergeConflict === true,
    mergeabilityComputed: stored.mergeabilityComputed === true,
  };
}

/**
 * A conflict that appeared after a definite no-conflict reading. A stored
 * reading that was never definite cannot produce a rising edge, so GitHub
 * finishing its first computation is adoption rather than new work — including
 * on rows written before `prBabysitMergeabilityComputed` existed.
 */
export function hasNewDefiniteMergeConflict(input: {
  storedMergeConflict: boolean | null | undefined;
  storedMergeabilityComputed: boolean | null | undefined;
  mergeable: boolean | null;
  mergeableState: string | null;
}): boolean {
  return (
    mergeabilityComputed(input) &&
    hasMergeConflict(input) &&
    input.storedMergeabilityComputed === true &&
    input.storedMergeConflict !== true
  );
}

export type BabysitPingReason =
  | "first-ask"
  | "new-human-work"
  | "new-definite-conflict"
  | "comment-scan-truncated"
  | "too-soon"
  | "duplicate-comment"
  | "mergeability-uncomputed"
  | "already-asked";

export interface BabysitPingDecision {
  allowed: boolean;
  reason: BabysitPingReason;
}

/**
 * The only gate on posting the hardcoded comment. The agent classifies, this
 * decides whether the classification may reach GitHub, so the read-only
 * briefing and the write action both call it instead of re-deriving the rule.
 */
export function decideBabysitPing(input: {
  previousState: string | null | undefined;
  lastCommentAtMs: number | null;
  nowMs: number;
  minCommentIntervalMs: number;
  existingBabysitCommentCount: number;
  commentScanTruncated: boolean;
  newHumanWork: boolean;
  newDefiniteMergeConflict: boolean;
  mergeabilityComputed: boolean;
}): BabysitPingDecision {
  // A capped page cannot prove the hardcoded comment is absent, and absence is
  // what authorizes a first ask.
  if (input.commentScanTruncated) {
    return { allowed: false, reason: "comment-scan-truncated" };
  }
  if (
    input.lastCommentAtMs !== null &&
    input.nowMs - input.lastCommentAtMs < input.minCommentIntervalMs
  ) {
    return { allowed: false, reason: "too-soon" };
  }
  const alreadyAskedOnGitHub = input.existingBabysitCommentCount > 0;
  const neverAskedThisEpisode =
    input.lastCommentAtMs === null || input.previousState === "clean";
  if (neverAskedThisEpisode && !alreadyAskedOnGitHub) {
    return { allowed: true, reason: "first-ask" };
  }
  if (input.newHumanWork) return { allowed: true, reason: "new-human-work" };
  if (input.newDefiniteMergeConflict) {
    return { allowed: true, reason: "new-definite-conflict" };
  }
  if (alreadyAskedOnGitHub) {
    return { allowed: false, reason: "duplicate-comment" };
  }
  if (!input.mergeabilityComputed) {
    return { allowed: false, reason: "mergeability-uncomputed" };
  }
  return { allowed: false, reason: "already-asked" };
}

/** POST-path duplicate scans must follow the same new-work override as decideBabysitPing. */
export function shouldVetoDuplicateBabysitComment(input: {
  existingBabysitCommentCount: number;
  newHumanWork: boolean;
  newDefiniteMergeConflict: boolean;
}): boolean {
  if (input.existingBabysitCommentCount === 0) return false;
  if (input.newHumanWork || input.newDefiniteMergeConflict) return false;
  return true;
}

/**
 * `quiet` is no longer written, because posting parks straight to `waiting`.
 * Rows stored before that change still carry it, and dropping the string here
 * would put every one of them back into needsReview for another ping.
 */
export const PARKED_BABYSIT_STATES = [
  "waiting",
  "quiet",
  "clean",
  "stuck",
] as const;

export function babysitLeavesReviewWindow(
  state: string | null | undefined,
): boolean {
  return PARKED_BABYSIT_STATES.some((parked) => parked === state);
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

function isHumanReviewFeedback(
  review: HumanReviewObservation,
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): boolean {
  if (isBabysitBotAuthor(review.author, botAuthors)) return false;
  if (review.state === "changes_requested" || review.state === "pending") {
    return true;
  }
  return review.state === "commented" && Boolean(review.body?.trim());
}

export function humanReviewBodyKeys(
  reviews: readonly HumanReviewObservation[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): string[] {
  return reviews
    .filter(
      (review) =>
        (review.state === "commented" ||
          review.state === "changes_requested") &&
        Boolean(review.body?.trim()) &&
        !isBabysitBotAuthor(review.author, botAuthors),
    )
    .map(
      (review) => review.htmlUrl?.trim() || `${review.author}:${review.body}`,
    )
    .sort();
}

export function countHumanReviewBodies(
  reviews: readonly HumanReviewObservation[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): number {
  return humanReviewBodyKeys(reviews, botAuthors).length;
}

export function hasHumanReviewWork(
  reviews: readonly HumanReviewObservation[] | undefined,
  reviewsTruncated: boolean,
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): boolean {
  if (reviewsTruncated) return true;
  return (reviews ?? []).some((review) =>
    isHumanReviewFeedback(review, botAuthors),
  );
}

export interface HumanReviewWorkComparison {
  storedChangesRequested: boolean;
  nextChangesRequested: boolean;
  storedCommentsTruncated: boolean;
  storedHumanReviewCommentCount: number | null | undefined;
  nextHumanReviewCommentCount: number | null | undefined;
  storedHumanReviewBodyCount?: number | null | undefined;
  nextHumanReviewBodyCount?: number | null | undefined;
  storedReviewsTruncated?: boolean;
  nextReviewsTruncated?: boolean;
}

/** New top-level human review work. Author replies, bot replies, and truncated totals do not count. */
export function hasNewHumanReviewWork(
  input: HumanReviewWorkComparison,
): boolean {
  if (input.nextChangesRequested && !input.storedChangesRequested) return true;
  if (
    !input.storedReviewsTruncated &&
    !input.nextReviewsTruncated &&
    typeof input.nextHumanReviewBodyCount === "number" &&
    typeof input.storedHumanReviewBodyCount === "number" &&
    input.nextHumanReviewBodyCount > input.storedHumanReviewBodyCount
  ) {
    return true;
  }
  if (input.storedCommentsTruncated) return false;
  return (
    typeof input.nextHumanReviewCommentCount === "number" &&
    typeof input.storedHumanReviewCommentCount === "number" &&
    input.nextHumanReviewCommentCount > input.storedHumanReviewCommentCount
  );
}

/**
 * New human review work, or a conflict that rose on a parked state that still
 * reopens for one. Takes the rising edge rather than the raw conflict bits, so
 * reopen and the ping veto cannot disagree about what counts as a new conflict.
 */
export function shouldReopenParkedBabysit(
  input: HumanReviewWorkComparison & {
    parked: boolean;
    parkedState?: string | null;
    newDefiniteMergeConflict: boolean;
  },
): boolean {
  if (!input.parked) return false;
  // `stuck` is the agent's judgement that another ask cannot help, so a
  // conflict appearing on it is not news. Only a human reopens it.
  if (input.parkedState !== "stuck" && input.newDefiniteMergeConflict) {
    return true;
  }
  return hasNewHumanReviewWork(input);
}

/** Work that may start another GitHub poke. SHA, CI flicker, and uncomputed mergeability do not. */
export function babysitFingerprint(input: {
  headSha?: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  storedMergeConflict?: boolean | null;
  snapshot: BabysitProposal;
  reviewStates?: readonly string[];
}): string {
  return JSON.stringify({
    unansweredComments: input.snapshot.unansweredComments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      isResolved: comment.isResolved ?? null,
    })),
    mergeConflict: resolveStickyMergeability(
      {
        mergeConflict: input.storedMergeConflict,
        mergeabilityComputed: undefined,
      },
      input,
    ).mergeConflict,
    commentsTruncated: input.snapshot.commentsTruncated,
    reviewsTruncated: input.snapshot.reviewsTruncated,
    humanReviewBodyKeys: input.snapshot.humanReviewBodyKeys,
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
  const reviewsTruncated = input.reviewsTruncated === true;
  const reviewBots = input.botAuthors ?? [...DEFAULT_BABYSIT_BOT_AUTHORS];
  const reviewBodyKeys = humanReviewBodyKeys(input.reviews ?? [], reviewBots);

  return {
    unansweredComments,
    failingChecks,
    missingChangesetPackages,
    pendingChecks,
    checksCoverage,
    commentsTruncated,
    reviewsTruncated,
    humanReviewBodyKeys: reviewBodyKeys,
    isClean:
      hasCompletePassingChecks(input) &&
      !commentsTruncated &&
      !hasHumanReviewWork(input.reviews, reviewsTruncated, reviewBots) &&
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

const BABYSIT_PING_REASON_CLAUSES: Record<BabysitPingReason, string> = {
  "first-ask": "this is the first request of the episode",
  "new-human-work": "there is new human review feedback",
  "new-definite-conflict": "a merge conflict appeared on a clean branch",
  "comment-scan-truncated":
    "the comment list was capped, so an earlier request cannot be ruled out",
  "too-soon": "the minimum interval since the last request has not elapsed",
  "duplicate-comment": "the same request is already on the pull request",
  "mergeability-uncomputed": "GitHub has not finished computing mergeability",
  "already-asked": "Factory already asked and there is no new human feedback",
};

export function babysitPingReasonClause(reason: BabysitPingReason): string {
  return BABYSIT_PING_REASON_CLAUSES[reason];
}

export function babysitHeldPingClause(reason: BabysitPingReason): string {
  return `waiting; held the request because ${babysitPingReasonClause(reason)}.`;
}

export function babysitAlreadyAskedClause(): string {
  return "waiting; already asked and no new human feedback.";
}

export function babysitStuckClause(): string {
  return "stuck; another request cannot unblock it, so it needs a human.";
}
