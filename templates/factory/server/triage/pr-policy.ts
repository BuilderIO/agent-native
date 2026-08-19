import type { GuardResult } from "./contracts.js";

export type OwnerOwnedArea = "clips" | "design" | "content";

export type PullRequestOwnerException =
  | "alice-content"
  | "nick-slides"
  | "enzo-factory"
  | "sid-design"
  | "docs-only";

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
  ownerException: PullRequestOwnerException | null;
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
  const ownerException = detectPullRequestOwnerException(input);
  const internalEvidenceException =
    input.internalBuilderMember || ownerException !== null;
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
      passed: input.clearBug || ownerException !== null,
      reason:
        input.clearBug || ownerException !== null
          ? "The automation classified this as a clear bug with a concrete failure signal."
          : "The automation did not establish a clear bug; product requests and guesses stay manual.",
    },
    {
      code: "security",
      passed: internalEvidenceException || input.checksPassed,
      reason: input.checksPassed
        ? "All observed CI checks passed."
        : internalEvidenceException
          ? "CI is failing, cancelled, pending, or unavailable; the verified internal-author exception does not treat that state as clean."
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
      passed: internalEvidenceException || input.reviewFeedbackHandled,
      reason: input.reviewFeedbackHandled
        ? "All observed review feedback is fixed, resolved, replied to, or outdated."
        : internalEvidenceException
          ? "Review feedback is unanswered, unresolved, truncated, or otherwise unknown; the verified internal-author exception does not treat that state as clean."
          : "Review feedback is unanswered, unresolved, truncated, or otherwise unknown.",
    },
  ];

  if (
    ownerOwnedArea &&
    !ownerExceptionCoversArea(ownerException, ownerOwnedArea)
  ) {
    gates.push({
      code: "owner_owned",
      passed: false,
      reason: `${ownerOwnedArea} is owner-managed and is never auto-approved, auto-merged, or dispatched by this Factory.`,
    });
  }
  if (input.productUxImplications && ownerException === null) {
    gates.push({
      code: "unknown_change",
      passed: false,
      reason: "Product or UX implications require the owning human to decide.",
    });
  }

  const baseEligible = gates.every((gate) => gate.passed);
  const autoApprove = baseEligible;
  const autoMerge = false;
  const reason = autoApprove
    ? ownerException
      ? `Verified ${ownerException} owner exception; approval is safe to automate while ordinary check and review states remain recorded.`
      : "Clear internal bug fix with verified membership; approval is safe to automate while ordinary check and review states remain recorded."
    : gates
        .filter((gate) => !gate.passed)
        .map((gate) => gate.reason)
        .join(" ");

  return {
    ownerOwnedArea,
    ownerException,
    autoApprove,
    autoMerge,
    reason,
    guardResults: gates,
  };
}

export function detectPullRequestOwnerException(
  input: Pick<PullRequestGovernanceInput, "author" | "changedFiles">,
): PullRequestOwnerException | null {
  const author = input.author.trim().toLowerCase();
  const changedFiles = input.changedFiles.map(normalizePath);

  if (author === "3mdistal" && isAppScoped(changedFiles, "content", true)) {
    return "alice-content";
  }
  if (author === "nkoech123" && isAppScoped(changedFiles, "slides", true)) {
    return "nick-slides";
  }
  if (author === "enzoames" && isFactoryScoped(changedFiles)) {
    return "enzo-factory";
  }
  if (author === "sidmohanty11" && isAppScoped(changedFiles, "design", true)) {
    return "sid-design";
  }
  if (
    (author === "kapunahelewong" || author === "bwreid") &&
    isDocsOnly(changedFiles)
  ) {
    return "docs-only";
  }
  return null;
}

export function hasCurrentPullRequestApproval(
  reviews: readonly {
    author: string;
    state: string;
    observedAt: string;
  }[],
): boolean {
  const latestByAuthor = new Map<
    string,
    { state: string; observedAt: string; order: number }
  >();
  reviews.forEach((review, order) => {
    const author = review.author.trim().toLowerCase();
    if (!author) return;
    const previous = latestByAuthor.get(author);
    if (
      !previous ||
      Date.parse(review.observedAt) > Date.parse(previous.observedAt) ||
      (review.observedAt === previous.observedAt && order > previous.order)
    ) {
      latestByAuthor.set(author, {
        state: review.state,
        observedAt: review.observedAt,
        order,
      });
    }
  });
  return [...latestByAuthor.values()].some(
    (review) => review.state === "approved",
  );
}

export function isDocsOnly(changedFiles: readonly string[]): boolean {
  return (
    changedFiles.length > 0 &&
    changedFiles.every((file) => {
      const normalized = normalizePath(file);
      return (
        normalized.startsWith("docs/") ||
        normalized.startsWith("packages/docs/") ||
        normalized.startsWith("packages/core/docs/") ||
        normalized.startsWith(".agents/skills/") ||
        normalized.endsWith("/agents.md") ||
        normalized.endsWith("/claude.md") ||
        normalized === "agents.md" ||
        normalized === "claude.md" ||
        (normalized.startsWith(".changeset/") && normalized.endsWith(".md")) ||
        normalized.endsWith(".mdx")
      );
    })
  );
}

function ownerExceptionCoversArea(
  exception: PullRequestOwnerException | null,
  area: OwnerOwnedArea,
): boolean {
  return (
    (exception === "alice-content" && area === "content") ||
    (exception === "sid-design" && area === "design")
  );
}

function isAppScoped(
  changedFiles: readonly string[],
  app: "content" | "slides" | "design",
  allowSharedSupport: boolean,
): boolean {
  const appPrefix = `templates/${app}/`;
  const hasAppPath = changedFiles.some((file) => file.startsWith(appPrefix));
  if (!hasAppPath) return false;
  return changedFiles.every(
    (file) =>
      file.startsWith(appPrefix) ||
      (allowSharedSupport && isSharedSupportPath(file)) ||
      isChangeset(file),
  );
}

function isFactoryScoped(changedFiles: readonly string[]): boolean {
  const hasFactoryPath = changedFiles.some((file) =>
    file.startsWith("templates/factory/"),
  );
  return (
    hasFactoryPath &&
    changedFiles.every(
      (file) => file.startsWith("templates/factory/") || isChangeset(file),
    )
  );
}

function isSharedSupportPath(file: string): boolean {
  return (
    file.startsWith("packages/core/") ||
    file.startsWith("packages/desktop-app/") ||
    file.startsWith("packages/code-agents-ui/")
  );
}

function isChangeset(file: string): boolean {
  return file.startsWith(".changeset/") && file.endsWith(".md");
}

function normalizePath(file: string): string {
  return file.trim().split("\\").join("/").toLowerCase();
}
