import type { BabysitMechanicalVerdict } from "./babysit-evidence.js";
import {
  detectBotErrorAfterPing,
  detectBuilderActive,
  type BabysitProposal,
  type BabysitRecommendation,
} from "./pr-babysit.js";
import type { ReviewCommentObservation } from "./pr-babysit.js";
import type { PullRequestCheckObservation } from "./pr-monitor.js";

export interface BabysitRecommendationInput {
  proposal: BabysitProposal;
  mechanical: BabysitMechanicalVerdict;
  checks: readonly PullRequestCheckObservation[];
  comments: readonly ReviewCommentObservation[];
  lastCommentAtMs: number | null;
  lastPingHeadSha: string | null | undefined;
  headSha: string;
  nowMs: number;
}

export interface BabysitRecommendationResult {
  recommendation: BabysitRecommendation;
  because: string;
  builderActive: boolean;
  builderActiveUntil: string | null;
  botErrorAfterPing: boolean;
}

export function computeBabysitRecommendation(
  input: BabysitRecommendationInput,
): BabysitRecommendationResult {
  const botErrorAfterPing = detectBotErrorAfterPing({
    comments: input.comments,
    lastCommentAtMs: input.lastCommentAtMs,
  });
  const builder = detectBuilderActive({
    checks: input.checks,
    lastBuilderActivityAtMs: input.lastCommentAtMs,
    nowMs: input.nowMs,
  });
  const openBot = input.proposal.unansweredBotComments.length;
  const openHuman = input.proposal.unansweredComments.length;
  const blockingFailed = input.proposal.failingChecks.length;
  const headShaChanged =
    Boolean(input.lastPingHeadSha) && input.lastPingHeadSha !== input.headSha;

  if (botErrorAfterPing) {
    return {
      recommendation: "stuck",
      because:
        "A bot error reply appeared after Factory's last request, so another ping is unlikely to help.",
      builderActive: builder.active,
      builderActiveUntil: builder.untilMs
        ? new Date(builder.untilMs).toISOString()
        : null,
      botErrorAfterPing: true,
    };
  }

  if (builder.active) {
    return {
      recommendation: "defer",
      because: `Builder is still active within the ${Math.round(
        (builder.untilMs ?? input.nowMs) - input.nowMs,
      )}ms quiet window after recent activity or running CI.`,
      builderActive: true,
      builderActiveUntil: builder.untilMs
        ? new Date(builder.untilMs).toISOString()
        : null,
      botErrorAfterPing: false,
    };
  }

  if (!input.mechanical.needsWork && input.proposal.isClean) {
    return {
      recommendation: "clean",
      because:
        "CI is green and there is no unresolved human or bot review feedback.",
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  if (
    !input.mechanical.ping.allowed &&
    input.mechanical.ping.reason === "duplicate-comment"
  ) {
    return {
      recommendation: "already_asked",
      because:
        "Factory already posted the feedback-fix request on this branch head and there is no new review work.",
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  if (
    !input.mechanical.ping.allowed &&
    input.mechanical.ping.reason === "already-asked"
  ) {
    return {
      recommendation: "already_asked",
      because:
        "Factory already asked during this episode and there is no new human or bot review work.",
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  if (blockingFailed > 0) {
    const names = input.proposal.failingChecks
      .slice(0, 3)
      .map((check) => check.name)
      .join(", ");
    return {
      recommendation: "ping",
      because: `Blocking CI is failing (${names || blockingFailed} check${
        blockingFailed === 1 ? "" : "s"
      }); ping Builder once feedback is actionable.`,
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  if (openBot > 0 || openHuman > 0) {
    const parts: string[] = [];
    if (openBot > 0)
      parts.push(`${openBot} open bot thread${openBot === 1 ? "" : "s"}`);
    if (openHuman > 0) {
      parts.push(`${openHuman} open human thread${openHuman === 1 ? "" : "s"}`);
    }
    if (headShaChanged) {
      parts.push("head SHA changed since the last Factory ping");
    }
    return {
      recommendation: "ping",
      because: `Unresolved review feedback remains (${parts.join(", ")}).`,
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  if (input.mechanical.ping.allowed) {
    return {
      recommendation: "ping",
      because: `Mechanical gates allow a ping (${input.mechanical.ping.reason.replace(/-/g, " ")}).`,
      builderActive: false,
      builderActiveUntil: null,
      botErrorAfterPing: false,
    };
  }

  return {
    recommendation: "already_asked",
    because: `Held: ${input.mechanical.ping.reason.replace(/-/g, " ")}.`,
    builderActive: false,
    builderActiveUntil: null,
    botErrorAfterPing: false,
  };
}
