import { assessThreadDispositions } from "./babysit-thread-closure.js";
import type { TriageCoverage } from "./contracts.js";
import { metadataString, type TriageMetadata } from "./metadata.js";
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
  isResolved?: boolean;
  isOutdated?: boolean;
  threadId?: string;
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
  issueComments?: readonly {
    body: string;
    author: string;
    createdAt: string;
  }[];
  lastCommentAtMs?: number | null;
}

export interface BabysitProposal {
  unansweredComments: ReviewCommentObservation[];
  unansweredBotComments: ReviewCommentObservation[];
  failingChecks: PullRequestCheckObservation[];
  informationalChecks: PullRequestCheckObservation[];
  missingChangesetPackages: string[];
  pendingChecks: PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
  commentsTruncated: boolean;
  reviewsTruncated: boolean;
  humanReviewBodyKeys: string[];
  botReviewBodyKeys: string[];
  isClean: boolean;
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

export function botReviewBodyKeys(
  comments: readonly ReviewCommentObservation[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
): string[] {
  const repliedToIds = new Set(
    comments
      .map((comment) => comment.inReplyToId)
      .filter((id): id is string => id !== null),
  );
  return comments
    .filter(
      (comment) =>
        comment.inReplyToId === null &&
        isBabysitBotAuthor(comment.author, botAuthors) &&
        !isAnswered(comment, repliedToIds),
    )
    .map((comment) => `${comment.id}:${comment.body.slice(0, 120)}`)
    .sort();
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

export const PARKED_BABYSIT_STATES = [
  "waiting",
  "quiet",
  "clean",
  "stuck",
  "defer",
  "closed-or-draft",
  "merged",
] as const;

export function babysitLeavesReviewWindow(
  state: string | null | undefined,
): boolean {
  return PARKED_BABYSIT_STATES.some((parked) => parked === state);
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
  storedBotReviewBodyKeys?: readonly string[];
  nextBotReviewBodyKeys?: readonly string[];
}

export function hasNewBotReviewWork(input: {
  storedBotReviewBodyKeys?: readonly string[];
  nextBotReviewBodyKeys?: readonly string[];
}): boolean {
  const stored = new Set(input.storedBotReviewBodyKeys ?? []);
  for (const key of input.nextBotReviewBodyKeys ?? []) {
    if (!stored.has(key)) return true;
  }
  return (input.nextBotReviewBodyKeys?.length ?? 0) > stored.size;
}

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

export function deferBabysitQuietWindowExpired(
  metadata: TriageMetadata,
  nowMs: number,
): boolean {
  if (metadataString(metadata, "prBabysitState") !== "defer") return false;
  const until = metadataString(metadata, "prBabysitBuilderActiveUntil");
  if (!until) return false;
  const untilMs = Date.parse(until);
  return Number.isFinite(untilMs) && nowMs >= untilMs;
}

export function shouldReopenParkedBabysit(
  input: HumanReviewWorkComparison & {
    parked: boolean;
    parkedState?: string | null;
    newDefiniteMergeConflict: boolean;
    botErrorAfterPing?: boolean;
  },
): boolean {
  if (!input.parked) return false;
  if (input.botErrorAfterPing && input.parkedState !== "stuck") return true;
  if (hasNewBotReviewWork(input)) return true;
  if (input.parkedState !== "stuck" && input.newDefiniteMergeConflict) {
    return true;
  }
  return hasNewHumanReviewWork(input);
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

function isAnswered(
  comment: ReviewCommentObservation,
  repliedToIds: ReadonlySet<string>,
): boolean {
  if (repliedToIds.has(comment.id)) return true;
  if (comment.isOutdated === true) return true;
  if (comment.isResolved !== undefined) return comment.isResolved;
  return false;
}

export function reconcileBabysitState(input: BabysitInput): BabysitProposal {
  const botAuthors = new Set(input.botAuthors ?? []);
  const checksCoverage = input.checksCoverage ?? "unknown";
  const repliedToIds = new Set(
    input.comments
      .map((comment) => comment.inReplyToId)
      .filter((id): id is string => id !== null),
  );

  const threadAssessment = input.issueComments
    ? assessThreadDispositions({
        comments: input.comments,
        issueComments: input.issueComments,
        lastCommentAtMs: input.lastCommentAtMs,
        botAuthors: input.botAuthors,
      })
    : null;
  const rootBlocksMergeable = (comment: ReviewCommentObservation): boolean => {
    if (comment.inReplyToId !== null) return false;
    if (threadAssessment) {
      const thread = threadAssessment.threads.find(
        (entry) => entry.rootCommentId === comment.id,
      );
      return thread?.blocksMergeable ?? true;
    }
    return !isAnswered(comment, repliedToIds);
  };
  const unansweredComments = input.comments.filter(
    (comment) =>
      comment.inReplyToId === null &&
      rootBlocksMergeable(comment) &&
      !isBabysitBotAuthor(comment.author, [...botAuthors]),
  );
  const unansweredBotComments = input.comments.filter(
    (comment) =>
      comment.inReplyToId === null &&
      rootBlocksMergeable(comment) &&
      isBabysitBotAuthor(comment.author, [...botAuthors]),
  );
  const failingChecks = input.checks.filter(
    (check) => check.state === "failed" || check.state === "cancelled",
  );
  const informationalChecks = input.checks.filter(
    (check) => check.state === "informational",
  );
  const pendingChecks = input.checks.filter(
    (check) => check.state === "queued" || check.state === "in_progress",
  );
  const missingChangesetPackages = parseMissingChangesetPackages(
    input.failingJobLog,
  );

  const commentsTruncated = input.commentsTruncated === true;
  const reviewsTruncated = input.reviewsTruncated === true;
  const reviewBots = input.botAuthors ?? [...DEFAULT_BABYSIT_BOT_AUTHORS];
  const reviewBodyKeys = humanReviewBodyKeys(input.reviews ?? [], reviewBots);
  const botBodyKeys = botReviewBodyKeys(input.comments, reviewBots);

  return {
    unansweredComments,
    unansweredBotComments,
    failingChecks,
    informationalChecks,
    missingChangesetPackages,
    pendingChecks,
    checksCoverage,
    commentsTruncated,
    reviewsTruncated,
    humanReviewBodyKeys: reviewBodyKeys,
    botReviewBodyKeys: botBodyKeys,
    isClean:
      hasCompletePassingChecks(input) &&
      !commentsTruncated &&
      !hasHumanReviewWork(input.reviews, reviewsTruncated, reviewBots) &&
      unansweredComments.length === 0 &&
      unansweredBotComments.length === 0 &&
      failingChecks.length === 0 &&
      missingChangesetPackages.length === 0 &&
      pendingChecks.length === 0,
  };
}

const BOT_FAILURE_AFTER_PING_PATTERNS: readonly RegExp[] = [
  /\brequest failed\b/i,
  /\bfailed to\b/i,
  /\bcould not\b/i,
  /\bunable to\b/i,
  /\bplease try again\b/i,
  /\bsomething went wrong\b/i,
  /\bproblem with your request\b/i,
  /\bservice unavailable\b/i,
  /\bunexpected error\b/i,
  /\ban error occurred\b/i,
  /\berror id:\s*\S+/i,
  /\bexception\b/i,
  /\btimed out\b/i,
  /\btimeout\b/i,
];

export type BabysitPingWatchComment = {
  author: string;
  body: string;
  createdAt: string;
};

export function stripCodeContextForBotErrorScan(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ");
}

export function commentBodyLooksLikeBotFailureAfterPing(body: string): boolean {
  const prose = stripCodeContextForBotErrorScan(body);
  return BOT_FAILURE_AFTER_PING_PATTERNS.some((pattern) => pattern.test(prose));
}

function botErrorAfterPingInComments(
  comments: readonly BabysitPingWatchComment[],
  lastCommentAtMs: number,
  bots: readonly string[],
): boolean {
  return comments.some(
    (comment) =>
      isBabysitBotAuthor(comment.author, bots) &&
      Date.parse(comment.createdAt) >= lastCommentAtMs &&
      commentBodyLooksLikeBotFailureAfterPing(comment.body),
  );
}

export function detectBotErrorAfterPing(input: {
  comments: readonly ReviewCommentObservation[];
  issueComments?: readonly BabysitPingWatchComment[];
  lastCommentAtMs: number | null;
  botAuthors?: readonly string[];
}): boolean {
  if (input.lastCommentAtMs === null) return false;
  const bots = input.botAuthors ?? DEFAULT_BABYSIT_BOT_AUTHORS;
  if (
    botErrorAfterPingInComments(input.comments, input.lastCommentAtMs, bots)
  ) {
    return true;
  }
  if (input.issueComments?.length) {
    return botErrorAfterPingInComments(
      input.issueComments,
      input.lastCommentAtMs,
      bots,
    );
  }
  return false;
}
