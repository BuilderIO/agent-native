import type { BabysitMechanicalVerdict } from "./babysit-evidence.js";
import type { BabysitRecommendationResult } from "./babysit-recommendation.js";
import {
  type BabysitAgentDecision,
  type BabysitProposal,
  type BabysitRecommendation,
  summarizeReviewThreads,
} from "./pr-babysit.js";
import type { ReviewCommentObservation } from "./pr-babysit.js";

const MAX_THREAD_SUMMARIES = 3;

export interface BabysitAuditDetailsInput {
  headSha: string;
  proposal: BabysitProposal;
  mechanical: BabysitMechanicalVerdict;
  recommendation: BabysitRecommendation;
  because: string;
  decision?: BabysitAgentDecision | null;
  veto?: string | null;
  pingReason?: string | null;
  builderActive?: boolean;
  builderActiveUntil?: string | null;
  factoryPingCount?: number;
  lastFactoryPingAt?: string | null;
  comments: readonly ReviewCommentObservation[];
  commentUrl?: string | null;
}

export function buildBabysitAuditDetails(
  input: BabysitAuditDetailsInput,
): Record<string, unknown> {
  const threads = summarizeReviewThreads(
    input.comments,
    undefined,
    MAX_THREAD_SUMMARIES,
  );
  const agentMatched =
    input.decision !== undefined &&
    input.decision !== null &&
    input.decision === input.recommendation;

  return {
    recommendation: input.recommendation,
    because: input.because,
    ...(input.decision ? { decision: input.decision } : {}),
    ...(input.decision ? { agentMatchedRecommendation: agentMatched } : {}),
    ...(input.veto ? { veto: input.veto } : {}),
    ...(input.pingReason ? { pingReason: input.pingReason } : {}),
    builderActive: input.builderActive ?? false,
    ...(input.builderActiveUntil
      ? { builderActiveUntil: input.builderActiveUntil }
      : {}),
    openBotThreads: input.proposal.unansweredBotComments.length,
    openHumanThreads: input.proposal.unansweredComments.length,
    botThreadSummaries: threads.bot,
    humanThreadSummaries: threads.human,
    ciBlockingFailed: input.proposal.failingChecks.length,
    ciInformational: input.proposal.informationalChecks.length,
    ciPending: input.proposal.pendingChecks.length,
    headSha: input.headSha,
    factoryPingCount: input.factoryPingCount ?? 0,
    ...(input.lastFactoryPingAt
      ? { lastFactoryPingAt: input.lastFactoryPingAt }
      : {}),
    reviewFeedbackClean: input.proposal.isClean,
    needsWork: input.mechanical.needsWork,
    ...(input.commentUrl ? { commentUrl: input.commentUrl } : {}),
  };
}

export function formatBabysitBriefingSummary(
  pullRequestNumber: number | null | undefined,
  result: Pick<BabysitRecommendationResult, "recommendation" | "because">,
): string {
  const label =
    typeof pullRequestNumber === "number" && pullRequestNumber > 0
      ? `#${pullRequestNumber}`
      : "Item";
  return `${label} briefing: recommend ${result.recommendation} — ${result.because}`;
}
