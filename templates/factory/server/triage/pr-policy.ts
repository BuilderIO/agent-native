import type { GuardResult } from "./contracts.js";

export type OwnerOwnedArea = "clips" | "design" | "content";

export interface PullRequestGovernanceInput {
  author: string;
  repository: string;
  title?: string;
  summary?: string | null;
  changedFiles: readonly string[];
  clearBug: boolean;
  productUxImplications: boolean;
  checksPassed: boolean;
  reviewFeedbackHandled: boolean;
  openNonDraft: boolean;
  internalBuilderMember: boolean;
  factoryTriggered: boolean;
}

export interface PullRequestGovernanceDecision {
  ownerOwnedArea: OwnerOwnedArea | null;
  autoApprove: boolean;
  autoMerge: boolean;
  reason: string;
  guardResults: GuardResult[];
}

export function detectOwnerOwnedArea(
  values: readonly (string | null | undefined)[],
): OwnerOwnedArea | null {
  const text = values
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
  const paths = text.split(/\s+/).filter((value) => value.includes("/"));

  if (
    /(^|\b)(clips app|clips desktop|clips chrome extension|clips bug)\b/.test(
      text,
    ) ||
    /(^|\n)\s*clips(?:\s+app)?\s*[:\-]/m.test(text) ||
    paths.some((path) => /(^|[/_-])clips([/_-]|$)/.test(path))
  ) {
    return "clips";
  }
  if (
    /(^|\b)(design app|design bug)\b/.test(text) ||
    /(^|\n)\s*design(?:\s+(?:app|generation))?\s*[:\-]/m.test(text) ||
    paths.some((path) => /(^|[/_-])design([/_-]|$)/.test(path))
  ) {
    return "design";
  }
  if (
    /(^|\b)(content app|content bug)\b/.test(text) ||
    /(^|\n)\s*content(?:\s+app)?\s*[:\-]/m.test(text) ||
    paths.some((path) => /(^|[/_-])content([/_-]|$)/.test(path))
  ) {
    return "content";
  }
  return null;
}

export function decidePullRequestGovernance(
  input: PullRequestGovernanceInput,
): PullRequestGovernanceDecision {
  const ownerOwnedArea = detectOwnerOwnedArea([
    input.repository,
    input.title,
    input.summary,
    ...input.changedFiles,
  ]);
  const gates: GuardResult[] = [
    {
      code: "identity",
      passed: input.internalBuilderMember,
      reason: input.internalBuilderMember
        ? "The pull-request author is a member of the BuilderIO organization."
        : "The pull-request author is not verified as a BuilderIO organization member.",
    },
    {
      code: "unknown_change",
      passed: input.clearBug,
      reason: input.clearBug
        ? "The automation classified this as a clear bug with a concrete failure signal."
        : "The automation did not establish a clear bug; product requests and guesses stay manual.",
    },
    {
      code: "security",
      passed: input.checksPassed,
      reason: input.checksPassed
        ? "All observed CI checks passed."
        : "CI is failing, cancelled, pending, or unavailable.",
    },
    {
      code: "unknown_change",
      passed: input.openNonDraft,
      reason: input.openNonDraft
        ? "The pull request is open and ready for review."
        : "Draft or closed pull requests are not eligible for autonomous approval.",
    },
    {
      code: "unknown_change",
      passed: input.reviewFeedbackHandled,
      reason: input.reviewFeedbackHandled
        ? "All observed review feedback is fixed, resolved, replied to, or outdated."
        : "Review feedback is unanswered, unresolved, truncated, or otherwise unknown.",
    },
  ];

  if (ownerOwnedArea) {
    gates.push({
      code: "owner_owned",
      passed: false,
      reason: `${ownerOwnedArea} is owner-managed and is never auto-approved, auto-merged, or dispatched by this Factory.`,
    });
  }
  if (input.productUxImplications) {
    gates.push({
      code: "unknown_change",
      passed: false,
      reason: "Product or UX implications require the owning human to decide.",
    });
  }

  const baseEligible = gates.every((gate) => gate.passed);
  const autoApprove = baseEligible;
  const autoMerge = baseEligible && input.factoryTriggered;
  const reason = autoMerge
    ? "Clear internal bug fix, all CI and review gates are clean, and the PR came from the Factory Builder flow."
    : autoApprove
      ? "Clear internal bug fix with clean CI and review gates; approval is safe to automate."
      : gates
          .filter((gate) => !gate.passed)
          .map((gate) => gate.reason)
          .join(" ");

  return {
    ownerOwnedArea,
    autoApprove,
    autoMerge,
    reason,
    guardResults: gates,
  };
}
