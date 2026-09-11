import type { GitHubRepositoryRef } from "../lib/github-repository.js";
import type { TriageCoverage } from "./contracts.js";
import type {
  GitHubIssueCommentPage,
  GitHubPullRequestEvidence,
  GitHubPullRequestSummary,
} from "./github-client.js";
import {
  metadataBoolean,
  metadataNumber,
  metadataString,
  type TriageMetadata,
} from "./metadata.js";
import {
  type BabysitPingDecision,
  type BabysitProposal,
  botReviewBodyKeys,
  countFactoryBabysitComments,
  decideBabysitPing,
  detectBuilderActive,
  hasNewBotReviewWork,
  hasNewDefiniteMergeConflict,
  hasNewHumanReviewWork,
  type HumanReviewObservation,
  MIN_BABYSIT_COMMENT_INTERVAL_MS,
  resolveStickyMergeability,
  type ReviewCommentObservation,
  shouldRequestBabysitWork,
} from "./pr-babysit.js";
import type { PullRequestCheckObservation } from "./pr-monitor.js";

export interface BabysitEvidenceDetails {
  comments: readonly ReviewCommentObservation[];
  commentsTruncated: boolean;
  reviews: readonly HumanReviewObservation[];
  reviewsTruncated: boolean;
  checks: readonly PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
  factoryBabysitCommentCount: number;
  babysitCommentScanTruncated: boolean;
  issueComments: readonly {
    body: string;
    author: string;
    createdAt: string;
    htmlUrl: string;
  }[];
}

/**
 * Closed and draft pull requests stop at the summary. Nothing downstream may
 * infer evidence from its absence, so the two cases are separate shapes rather
 * than one shape with empty arrays.
 */
export type BabysitEvidenceRead =
  | { open: false; summary: GitHubPullRequestSummary }
  | {
      open: true;
      summary: GitHubPullRequestSummary;
      details: BabysitEvidenceDetails;
    };

export interface BabysitEvidenceClient {
  getPullRequestSummary(
    repository: GitHubRepositoryRef,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestSummary>;
  getPullRequestEvidence(
    repository: GitHubRepositoryRef,
    pullRequestNumber: number,
    headSha: string,
  ): Promise<GitHubPullRequestEvidence>;
  listIssueComments(
    repository: GitHubRepositoryRef,
    issueNumber: number,
  ): Promise<GitHubIssueCommentPage>;
}

export async function readBabysitEvidence(
  client: BabysitEvidenceClient,
  repository: GitHubRepositoryRef,
  pullRequestNumber: number,
): Promise<BabysitEvidenceRead> {
  const summary = await client.getPullRequestSummary(
    repository,
    pullRequestNumber,
  );
  if (summary.state !== "open" || summary.draft) {
    return { open: false, summary };
  }
  const [evidence, issueComments] = await Promise.all([
    client.getPullRequestEvidence(
      repository,
      pullRequestNumber,
      summary.headSha,
    ),
    client.listIssueComments(repository, pullRequestNumber),
  ]);
  return {
    open: true,
    summary,
    details: {
      comments: evidence.comments,
      commentsTruncated: evidence.commentsTruncated,
      reviews: evidence.reviews,
      reviewsTruncated: evidence.reviewsTruncated,
      checks: evidence.checks,
      checksCoverage: evidence.checksCoverage,
      factoryBabysitCommentCount: countFactoryBabysitComments(
        issueComments.comments,
        undefined,
      ),
      babysitCommentScanTruncated: issueComments.truncated,
      issueComments: issueComments.comments,
    },
  };
}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface BabysitStoredState {
  babysitState: string | undefined;
  lastCommentAt: string | undefined;
  lastCommentAtMs: number | null;
  lastCommentUrl: string | undefined;
  fingerprint: string | undefined;
  mergeConflict: boolean | undefined;
  mergeabilityComputed: boolean | undefined;
  humanReviewCommentCount: number | undefined;
  humanReviewBodyCount: number | undefined;
  commentsTruncated: boolean;
  reviewsTruncated: boolean;
  changesRequested: boolean;
  /** Poll set this when reopening on new human work; write clears it after acting. */
  pendingReopen: boolean;
  factoryAuthor: string | undefined;
  lastPingHeadSha: string | undefined;
  botReviewBodyKeys: readonly string[];
}

export function readBabysitStoredState(
  metadata: TriageMetadata,
): BabysitStoredState {
  const lastCommentAt = metadataString(metadata, "prBabysitLastCommentAt");
  return {
    babysitState: metadataString(metadata, "prBabysitState"),
    lastCommentAt,
    lastCommentAtMs: parseTimestampMs(lastCommentAt),
    lastCommentUrl: metadataString(metadata, "prBabysitLastCommentUrl"),
    fingerprint: metadataString(metadata, "prBabysitFingerprint"),
    mergeConflict: metadataBoolean(metadata, "prBabysitMergeConflict"),
    mergeabilityComputed: metadataBoolean(
      metadata,
      "prBabysitMergeabilityComputed",
    ),
    humanReviewCommentCount: metadataNumber(
      metadata,
      "prBabysitHumanReviewCommentCount",
    ),
    humanReviewBodyCount: metadataNumber(
      metadata,
      "prBabysitHumanReviewBodyCount",
    ),
    commentsTruncated:
      metadataBoolean(metadata, "prBabysitCommentsTruncated") === true,
    reviewsTruncated:
      metadataBoolean(metadata, "prBabysitReviewsTruncated") === true,
    changesRequested:
      metadataBoolean(metadata, "prBabysitChangesRequested") === true,
    pendingReopen: metadataBoolean(metadata, "prBabysitPendingReopen") === true,
    factoryAuthor: metadataString(metadata, "prBabysitFactoryAuthor"),
    lastPingHeadSha: metadataString(metadata, "prBabysitLastPingHeadSha"),
    botReviewBodyKeys: parseStringArray(metadata, "prBabysitBotReviewBodyKeys"),
  };
}

function parseStringArray(
  metadata: TriageMetadata,
  key: string,
): readonly string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export interface BabysitMechanicalVerdict {
  needsWork: boolean;
  isClean: boolean;
  mergeability: { mergeConflict: boolean; mergeabilityComputed: boolean };
  newHumanWork: boolean;
  newBotWork: boolean;
  newDefiniteMergeConflict: boolean;
  builderActive: boolean;
  builderActiveUntil: string | null;
  headShaChangedSinceLastPing: boolean;
  ping: BabysitPingDecision;
}

/**
 * One derivation of the ping veto, read by the briefing and enforced by the
 * write action. Two copies would let the agent be told a ping is allowed and
 * then have it refused, or worse, the reverse.
 */
export function babysitMechanicalVerdict(input: {
  stored: BabysitStoredState;
  summary: { mergeable: boolean | null; mergeableState: string | null };
  details: BabysitEvidenceDetails;
  proposal: BabysitProposal;
  nextHumanReviewCommentCount: number;
  nextHumanReviewBodyCount: number;
  nextChangesRequested: boolean;
  nowMs: number;
}): BabysitMechanicalVerdict {
  const nextBotReviewBodyKeys = botReviewBodyKeys(input.details.comments);
  const newHumanWork =
    input.stored.pendingReopen ||
    hasNewHumanReviewWork({
      storedChangesRequested: input.stored.changesRequested,
      nextChangesRequested: input.nextChangesRequested,
      storedCommentsTruncated: input.stored.commentsTruncated,
      storedHumanReviewCommentCount: input.stored.humanReviewCommentCount,
      nextHumanReviewCommentCount: input.nextHumanReviewCommentCount,
      storedHumanReviewBodyCount: input.stored.humanReviewBodyCount,
      nextHumanReviewBodyCount: input.nextHumanReviewBodyCount,
      storedReviewsTruncated: input.stored.reviewsTruncated,
      nextReviewsTruncated: input.details.reviewsTruncated,
      storedBotReviewBodyKeys: input.stored.botReviewBodyKeys,
      nextBotReviewBodyKeys,
    });
  const newBotWork =
    input.stored.pendingReopen ||
    hasNewBotReviewWork({
      storedBotReviewBodyKeys: input.stored.botReviewBodyKeys,
      nextBotReviewBodyKeys,
    });
  const newDefiniteMergeConflict = hasNewDefiniteMergeConflict({
    storedMergeConflict: input.stored.mergeConflict,
    storedMergeabilityComputed: input.stored.mergeabilityComputed,
    mergeable: input.summary.mergeable,
    mergeableState: input.summary.mergeableState,
  });
  const mergeability = resolveStickyMergeability(
    {
      mergeConflict: input.stored.mergeConflict,
      mergeabilityComputed: input.stored.mergeabilityComputed,
    },
    input.summary,
  );
  const factoryBabysitCommentCount = countFactoryBabysitComments(
    input.details.issueComments,
    input.stored.factoryAuthor,
  );
  const headShaChangedSinceLastPing =
    Boolean(input.stored.lastPingHeadSha) &&
    input.stored.lastPingHeadSha !== input.summary.headSha;
  const builder = detectBuilderActive({
    checks: input.details.checks,
    nowMs: input.nowMs,
  });
  return {
    // The sticky conflict, not the live one: letting an uncomputed read park a
    // conflicted branch as clean ends the episode and buys it a fresh ping.
    needsWork: shouldRequestBabysitWork({
      mergeConflict: mergeability.mergeConflict,
      snapshot: input.proposal,
    }),
    isClean: input.proposal.isClean,
    mergeability,
    newHumanWork,
    newBotWork,
    newDefiniteMergeConflict,
    builderActive: builder.active,
    builderActiveUntil: builder.untilMs
      ? new Date(builder.untilMs).toISOString()
      : null,
    headShaChangedSinceLastPing,
    ping: decideBabysitPing({
      previousState: input.stored.babysitState,
      lastCommentAtMs: input.stored.lastCommentAtMs,
      nowMs: input.nowMs,
      minCommentIntervalMs: MIN_BABYSIT_COMMENT_INTERVAL_MS,
      existingFactoryBabysitCommentCount: factoryBabysitCommentCount,
      commentScanTruncated: input.details.babysitCommentScanTruncated,
      newHumanWork,
      newBotWork,
      newDefiniteMergeConflict,
      mergeabilityComputed: mergeability.mergeabilityComputed,
      builderActive: builder.active,
      headShaChangedSinceLastPing,
    }),
  };
}
