import type { TriageItemStatus } from "./contracts.js";
import type { GitHubPullRequestSummary } from "./github-client.js";
import { metadataString, parseTriageMetadata } from "./metadata.js";
import { babysitLeavesReviewWindow } from "./pr-babysit.js";

export type ClosedPullRequestKind = "merged" | "draft" | "closed";

export type ClosedPullRequestSummary = Pick<
  GitHubPullRequestSummary,
  "state" | "draft" | "merged"
>;

export function closedPullRequestKind(
  summary: ClosedPullRequestSummary,
): ClosedPullRequestKind | null {
  if (summary.state === "open" && !summary.draft) return null;
  if (summary.draft) return "draft";
  if (summary.merged) return "merged";
  return "closed";
}

export function terminalItemStatusForClosedPullRequest(
  kind: ClosedPullRequestKind,
): TriageItemStatus {
  return kind === "merged" ? "merged" : "needs_manual";
}

export function terminalBabysitStateForClosedPullRequest(
  kind: ClosedPullRequestKind,
): string {
  return kind === "merged" ? "merged" : "closed-or-draft";
}

export function babysitSkipSummaryForClosedPullRequest(
  pullRequestNumber: number | null | undefined,
  kind: ClosedPullRequestKind,
): string {
  const label =
    typeof pullRequestNumber === "number" && pullRequestNumber > 0
      ? `#${pullRequestNumber} `
      : "";
  if (kind === "merged") {
    return `${label}merged on GitHub; no further babysitting.`.trim();
  }
  if (kind === "draft") {
    return `${label}skipped; pull request is a draft.`.trim();
  }
  return `${label}skipped; pull request is closed.`.trim();
}

export function closedPullRequestTerminalMetadataPatch(
  kind: ClosedPullRequestKind,
  checkedAt: string,
  summary?: Pick<GitHubPullRequestSummary, "mergedAt">,
): Record<string, unknown> {
  return {
    prBabysitState: terminalBabysitStateForClosedPullRequest(kind),
    prBabysitLastCheckedAt: checkedAt,
    prBabysitPendingReopen: false,
    prBabysitBuilderActiveUntil: null,
    ...(kind === "merged" && summary?.mergedAt
      ? { prBabysitMergedAt: summary.mergedAt }
      : {}),
  };
}

export function isTerminalBabysitState(
  state: string | null | undefined,
): boolean {
  return state === "merged" || state === "closed-or-draft";
}

export function pullRequestReopenedFromTerminal(input: {
  existingBabysitState?: string | null;
  nextState: string;
  nextDraft: boolean;
}): boolean {
  return (
    input.nextState === "open" &&
    !input.nextDraft &&
    isTerminalBabysitState(input.existingBabysitState)
  );
}

export function reopenedFromTerminalBabysitMetadataPatch(): Record<
  string,
  unknown
> {
  return {
    prBabysitState: null,
    prBabysitPendingReopen: false,
    prBabysitMergedAt: null,
    prBabysitBuilderActiveUntil: null,
  };
}

export function isTerminalBabysitMetadata(
  metadataJson: string,
  status?: string | null,
): boolean {
  if (status === "merged") return true;
  const babysitState = metadataString(
    parseTriageMetadata(metadataJson),
    "prBabysitState",
  );
  return isTerminalBabysitState(babysitState);
}

export function babysitStateLeavesReviewWindow(
  state: string | null | undefined,
): boolean {
  if (!state) return babysitLeavesReviewWindow(state);
  if (isTerminalBabysitState(state)) return true;
  return babysitLeavesReviewWindow(state);
}

export function readGitHubTerminalFromAuditDetails(
  details: Record<string, unknown> | undefined,
): ClosedPullRequestKind | null {
  if (!details) return null;
  if (details.merged === true) return "merged";
  if (details.draft === true) return "draft";
  if (details.state === "closed") return "closed";
  return null;
}
