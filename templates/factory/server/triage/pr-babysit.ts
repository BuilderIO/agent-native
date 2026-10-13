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

export const BABYSIT_BUILDER_QUIET_WINDOW_MS = 20 * 60_000;

export type BabysitRecommendation =
  | "ping"
  | "defer"
  | "already_asked"
  | "stuck"
  | "clean";

export type BabysitAgentDecision = "ping" | "defer" | "already_asked" | "stuck";

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

export const BABYSIT_COMMENT_V2_PREFIX = "<!-- factory-babysit-v2 -->";

export const BABYSIT_COMMENT_V2 = `${BABYSIT_COMMENT_V2_PREFIX}
@builderio-bot look at the latest PR feedback and fix anything you agree with. Be skeptical.

Reply in each **open inline thread** with exactly one of:
- \`Required — fixed: …\`
- \`Required — not fixing: …\`
- \`Optional — skipping: …\`

Or resolve the thread in GitHub. Outdated threads after new commits do not need a new reply.

Get CI green and keep the branch mergeable.`;

export const CURRENT_BABYSIT_COMMENT_VERSION = 2;

export function babysitCommentBodyForVersion(
  version: number | undefined,
): string {
  return version === 1 ? DEFAULT_BABYSIT_PR_COMMENT : BABYSIT_COMMENT_V2;
}

export function isFactoryBabysitCommentBody(
  body: string,
  version?: number,
): boolean {
  const trimmed = body.trim();
  if (version === 1) return trimmed === DEFAULT_BABYSIT_PR_COMMENT.trim();
  if (trimmed === DEFAULT_BABYSIT_PR_COMMENT.trim()) return true;
  return trimmed.startsWith(BABYSIT_COMMENT_V2_PREFIX);
}

export const MIN_BABYSIT_COMMENT_INTERVAL_MS = 90_000;

export function countBabysitComments(
  comments: readonly { body: string }[],
  body: string = DEFAULT_BABYSIT_PR_COMMENT,
): number {
  const target = body.trim();
  return comments.filter((comment) => comment.body.trim() === target).length;
}

export function countFactoryBabysitComments(
  comments: readonly { body: string; author: string }[],
  factoryAuthorLogin: string | null | undefined,
  commentVersion: number = CURRENT_BABYSIT_COMMENT_VERSION,
): number {
  const factoryAuthor = factoryAuthorLogin?.trim().toLowerCase();
  if (!factoryAuthor) return 0;
  return comments.filter(
    (comment) =>
      comment.author.trim().toLowerCase() === factoryAuthor &&
      isFactoryBabysitCommentBody(comment.body, commentVersion),
  ).length;
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

export function summarizeReviewThreads(
  comments: readonly ReviewCommentObservation[],
  botAuthors: readonly string[] = DEFAULT_BABYSIT_BOT_AUTHORS,
  limit = 3,
): { human: string[]; bot: string[] } {
  const repliedToIds = new Set(
    comments
      .map((comment) => comment.inReplyToId)
      .filter((id): id is string => id !== null),
  );
  const human: string[] = [];
  const bot: string[] = [];
  for (const comment of comments) {
    if (comment.inReplyToId !== null) continue;
    if (isAnswered(comment, repliedToIds)) continue;
    const summary = comment.body.trim().slice(0, 160);
    if (!summary) continue;
    if (isBabysitBotAuthor(comment.author, botAuthors)) {
      if (bot.length < limit) bot.push(summary);
    } else if (human.length < limit) {
      human.push(summary);
    }
  }
  return { human, bot };
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

export type BabysitPingReason =
  | "first-ask"
  | "new-human-work"
  | "new-bot-work"
  | "new-definite-conflict"
  | "comment-scan-truncated"
  | "too-soon"
  | "duplicate-comment"
  | "mergeability-uncomputed"
  | "already-asked"
  | "builder-active"
  | "head-sha-changed";

export interface BabysitPingDecision {
  allowed: boolean;
  reason: BabysitPingReason;
}

export function decideBabysitPing(input: {
  previousState: string | null | undefined;
  lastCommentAtMs: number | null;
  nowMs: number;
  minCommentIntervalMs: number;
  existingFactoryBabysitCommentCount: number;
  commentScanTruncated: boolean;
  newHumanWork: boolean;
  newBotWork: boolean;
  newDefiniteMergeConflict: boolean;
  mergeabilityComputed: boolean;
  builderActive?: boolean;
  headShaChangedSinceLastPing?: boolean;
}): BabysitPingDecision {
  if (input.commentScanTruncated) {
    return { allowed: false, reason: "comment-scan-truncated" };
  }
  if (input.builderActive) {
    return { allowed: false, reason: "builder-active" };
  }
  if (
    input.lastCommentAtMs !== null &&
    input.nowMs - input.lastCommentAtMs < input.minCommentIntervalMs
  ) {
    return { allowed: false, reason: "too-soon" };
  }
  const alreadyAskedOnGitHub = input.existingFactoryBabysitCommentCount > 0;
  const neverAskedThisEpisode =
    input.lastCommentAtMs === null || input.previousState === "clean";
  if (neverAskedThisEpisode && !alreadyAskedOnGitHub) {
    return { allowed: true, reason: "first-ask" };
  }
  if (input.newHumanWork) return { allowed: true, reason: "new-human-work" };
  if (input.newBotWork) return { allowed: true, reason: "new-bot-work" };
  if (input.newDefiniteMergeConflict) {
    return { allowed: true, reason: "new-definite-conflict" };
  }
  if (alreadyAskedOnGitHub && !input.headShaChangedSinceLastPing) {
    return { allowed: false, reason: "duplicate-comment" };
  }
  if (input.headShaChangedSinceLastPing) {
    return { allowed: true, reason: "head-sha-changed" };
  }
  if (!input.mergeabilityComputed) {
    return { allowed: false, reason: "mergeability-uncomputed" };
  }
  return { allowed: false, reason: "already-asked" };
}

export function shouldVetoDuplicateBabysitComment(input: {
  existingFactoryBabysitCommentCount: number;
  newHumanWork: boolean;
  newBotWork: boolean;
  newDefiniteMergeConflict: boolean;
  headShaChangedSinceLastPing?: boolean;
}): boolean {
  if (input.existingFactoryBabysitCommentCount === 0) return false;
  if (input.headShaChangedSinceLastPing) return false;
  if (
    input.newHumanWork ||
    input.newBotWork ||
    input.newDefiniteMergeConflict
  ) {
    return false;
  }
  return true;
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

export function hasChangesRequested(
  reviewStates: readonly string[] | undefined,
): boolean {
  return (reviewStates ?? []).includes("changes_requested");
}

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
    botReviewBodyKeys: input.snapshot.botReviewBodyKeys,
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

export function detectBuilderActive(input: {
  checks: readonly PullRequestCheckObservation[];
  lastBuilderActivityAtMs?: number | null;
  nowMs: number;
  quietWindowMs?: number;
}): { active: boolean; untilMs: number | null } {
  const quietWindowMs = input.quietWindowMs ?? BABYSIT_BUILDER_QUIET_WINDOW_MS;
  const ciRunning = input.checks.some(
    (check) => check.state === "queued" || check.state === "in_progress",
  );
  const activityMs = ciRunning
    ? input.nowMs
    : (input.lastBuilderActivityAtMs ?? null);
  if (activityMs === null) return { active: false, untilMs: null };
  const untilMs = activityMs + quietWindowMs;
  return { active: input.nowMs < untilMs, untilMs };
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

export function formatBabysitMergeableAuditSummary(
  pullRequestNumber: number | null | undefined,
  mergeableAtIso: string,
): string {
  const label =
    typeof pullRequestNumber === "number" && pullRequestNumber > 0
      ? `#${pullRequestNumber}`
      : "Item";
  return `${label} in mergeable condition as of ${mergeableAtIso}; no further Builder ping.`;
}

export function babysitOutOfScopeClause(author: string | null): string {
  return author
    ? `skipped; author ${author} is out of scope.`
    : "skipped; out of scope.";
}

const BABYSIT_PING_REASON_CLAUSES: Record<BabysitPingReason, string> = {
  "first-ask": "this is the first request of the episode",
  "new-human-work": "there is new human review feedback",
  "new-bot-work": "there is new unresolved bot review feedback",
  "new-definite-conflict": "a merge conflict appeared on a clean branch",
  "comment-scan-truncated":
    "the comment list was capped, so an earlier request cannot be ruled out",
  "too-soon": "the minimum interval since the last request has not elapsed",
  "duplicate-comment":
    "Factory already posted the same request on this branch head",
  "mergeability-uncomputed": "GitHub has not finished computing mergeability",
  "already-asked": "Factory already asked and there is no new review feedback",
  "builder-active":
    "Builder is still active on the pull request within the quiet window",
  "head-sha-changed": "the branch head changed since the last Factory request",
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

export function babysitDeferClause(): string {
  return "deferred; Builder is active, so Factory is holding the request.";
}
