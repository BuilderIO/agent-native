import type { GuardResult } from "./contracts.js";

export type OwnerOwnedArea = "clips" | "design" | "content";

export type PullRequestOwnerException =
  | "alice-content"
  | "nick-slides"
  | "enzo-factory"
  | "sid-design"
  | "docs-only";

export type PullRequestTrustException = "liamdebeasi";

const LIAMDEBEASI_USER_ID = 2721089;
export const FACTORY_APPROVAL_BODY_MARKER =
  "Factory auto-approved under decision ";

export interface PullRequestGovernanceInput {
  author: string;
  authorId: number;
  repository: string;
  title?: string;
  summary?: string | null;
  changedFiles: readonly string[];
  clearBug: boolean;
  productUxImplications: boolean;
  checksPassed: boolean;
  reviewFeedbackHandled: boolean;
  blockingReviewStatesClean: boolean;
  safetyFindingsClean: boolean;
  openNonDraft: boolean;
  internalBuilderMember: boolean;
  factoryTriggered: boolean;
}

export interface PullRequestGovernanceDecision {
  ownerOwnedArea: OwnerOwnedArea | null;
  ownerException: PullRequestOwnerException | null;
  trustException: PullRequestTrustException | null;
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
    /(^|\n)\s*clips(?:\s+app)?\s*[:-]/m.test(text) ||
    paths.some((path) => /(^|[/_-])clips([/_-]|$)/.test(path))
  ) {
    return "clips";
  }
  if (
    /(^|\b)(design app|design bug)\b/.test(text) ||
    /(^|\n)\s*design(?:\s+(?:app|generation))?\s*[:-]/m.test(text) ||
    paths.some((path) => /(^|[/_-])design([/_-]|$)/.test(path))
  ) {
    return "design";
  }
  if (
    /(^|\b)(content app|content bug)\b/.test(text) ||
    /(^|\n)\s*content(?:\s+app)?\s*[:-]/m.test(text) ||
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
  const ultraScary = isUltraScaryChange(input.changedFiles);
  const liamException =
    input.author.trim().toLowerCase() === "liamdebeasi" &&
    input.authorId === LIAMDEBEASI_USER_ID &&
    input.repository.trim().toLowerCase() === "builderio/agent-native" &&
    input.internalBuilderMember &&
    !ultraScary;
  const ownerException = detectPullRequestOwnerException(input);
  const verifiedOwnerException =
    input.internalBuilderMember && !ultraScary ? ownerException : null;
  const internalEvidenceException = input.internalBuilderMember;
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
      passed:
        input.clearBug || verifiedOwnerException !== null || liamException,
      reason:
        input.clearBug || verifiedOwnerException !== null || liamException
          ? "The automation classified this as a clear bug with a concrete failure signal."
          : "The automation did not establish a clear bug; product requests and guesses stay manual.",
    },
    {
      code: "security",
      passed: !ultraScary,
      reason: ultraScary
        ? "Security-sensitive auth, tenant-isolation, execution, payment, or deployment changes always require manual review."
        : "The changed paths do not match the ultra-scary manual-review categories.",
    },
    {
      code: "security",
      passed: input.safetyFindingsClean,
      reason: input.safetyFindingsClean
        ? "Fresh review evidence contains no active credible safety finding."
        : "An active credible safety finding requires manual review.",
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
      passed:
        input.blockingReviewStatesClean &&
        (internalEvidenceException || input.reviewFeedbackHandled),
      reason: !input.blockingReviewStatesClean
        ? "An active changes-requested or pending review remains blocking."
        : input.reviewFeedbackHandled
          ? "All observed review feedback is fixed, resolved, replied to, or outdated."
          : internalEvidenceException
            ? "Review feedback is unanswered, unresolved, truncated, or otherwise unknown; the verified internal-author exception does not treat that state as clean."
            : "Review feedback is unanswered, unresolved, truncated, or otherwise unknown.",
    },
  ];

  if (
    ownerOwnedArea &&
    !ownerExceptionCoversArea(verifiedOwnerException, ownerOwnedArea) &&
    !liamException
  ) {
    gates.push({
      code: "owner_owned",
      passed: false,
      reason: `${ownerOwnedArea} is owner-managed and is never auto-approved, auto-merged, or dispatched by this Factory.`,
    });
  }
  if (
    input.productUxImplications &&
    verifiedOwnerException === null &&
    !liamException
  ) {
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
    ? verifiedOwnerException
      ? `Verified ${verifiedOwnerException} owner exception; approval is safe to automate while ordinary check and review states remain recorded.`
      : liamException
        ? "Verified liamdebeasi exception; approval is safe to automate while ordinary check and review states remain recorded."
        : "Clear internal bug fix with verified membership; approval is safe to automate while ordinary check and review states remain recorded."
    : gates
        .filter((gate) => !gate.passed)
        .map((gate) => gate.reason)
        .join(" ");

  return {
    ownerOwnedArea,
    ownerException: verifiedOwnerException,
    trustException: liamException ? "liamdebeasi" : null,
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
    commitSha?: string | null;
    htmlUrl?: string | null;
    body?: string | null;
    observedAt: string;
  }[],
  headSha: string,
): boolean {
  return currentPullRequestApproval(reviews, headSha) !== null;
}

export function currentPullRequestApprovals(
  reviews: readonly {
    author: string;
    state: string;
    commitSha?: string | null;
    htmlUrl?: string | null;
    body?: string | null;
    observedAt: string;
  }[],
  headSha: string,
): {
  commitSha: string;
  htmlUrl?: string | null;
  reviewerLogin: string;
  body?: string | null;
}[] {
  const approvalByAuthor = new Map<
    string,
    {
      commitSha?: string | null;
      htmlUrl?: string | null;
      reviewerLogin: string;
      body?: string | null;
    }
  >();
  reviews
    .map((review, order) => ({ review, order }))
    .sort(
      (left, right) =>
        Date.parse(left.review.observedAt) -
          Date.parse(right.review.observedAt) || left.order - right.order,
    )
    .forEach(({ review }) => {
      const author = review.author.trim().toLowerCase();
      if (!author) return;
      if (review.state === "approved") {
        approvalByAuthor.set(author, {
          commitSha: review.commitSha,
          htmlUrl: review.htmlUrl,
          reviewerLogin: author,
          body: review.body,
        });
      } else if (
        review.state === "changes_requested" ||
        review.state === "dismissed"
      ) {
        approvalByAuthor.delete(author);
      }
    });
  if ([...approvalByAuthor.values()].some((review) => !review.commitSha)) {
    throw new Error(
      "Pull-request approval evidence is missing a commit SHA; reconciliation is required before approval.",
    );
  }
  return [...approvalByAuthor.values()].filter(
    (
      review,
    ): review is {
      commitSha: string;
      htmlUrl?: string | null;
      reviewerLogin: string;
      body?: string | null;
    } => review.commitSha === headSha,
  );
}

export function currentPullRequestApproval(
  reviews: Parameters<typeof currentPullRequestApprovals>[0],
  headSha: string,
) {
  return currentPullRequestApprovals(reviews, headSha)[0] ?? null;
}

export function hasCurrentBlockingPullRequestReview(
  reviews: readonly {
    author: string;
    state: string;
    observedAt: string;
  }[],
): boolean {
  const stateByAuthor = new Map<
    string,
    {
      blocking: boolean;
    }
  >();
  reviews
    .map((review, order) => ({ review, order }))
    .sort(
      (left, right) =>
        Date.parse(left.review.observedAt) -
          Date.parse(right.review.observedAt) || left.order - right.order,
    )
    .forEach(({ review }) => {
      const author = review.author.trim().toLowerCase();
      if (!author) return;
      const previous = stateByAuthor.get(author);
      if (review.state === "approved" || review.state === "dismissed") {
        stateByAuthor.set(author, { blocking: false });
      } else if (
        review.state === "changes_requested" ||
        review.state === "pending"
      ) {
        stateByAuthor.set(author, { blocking: true });
      } else if (previous?.blocking) {
        stateByAuthor.set(author, { blocking: true });
      }
    });
  return [...stateByAuthor.values()].some((review) => review.blocking);
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
        (normalized.endsWith(".mdx") &&
          (normalized.startsWith("docs/") ||
            normalized.startsWith(".agents/skills/") ||
            normalized.includes("/docs/")))
      );
    })
  );
}

export function isUltraScaryChange(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) => {
    const normalized = normalizePath(file);
    return (
      normalized === "agents.md" ||
      normalized === "claude.md" ||
      normalized.endsWith("/agents.md") ||
      normalized.endsWith("/claude.md") ||
      normalized.endsWith("/skill.md") ||
      normalized === ".agents/skills/review-prs/skill.md" ||
      normalized.includes("/review-skill-alignment.") ||
      normalized.endsWith("/govern-agent-native-pull-request.ts") ||
      normalized.endsWith("/github-client.ts") ||
      normalized.endsWith("/ai-services-git.ts") ||
      normalized.endsWith("/github-ingestion.ts") ||
      normalized.endsWith("/pr-monitor.ts") ||
      normalized.endsWith("/pr-babysit.ts") ||
      normalized.endsWith("/ingest-github-observation.ts") ||
      normalized.endsWith("/reconcile-triage-run.ts") ||
      normalized.endsWith("/approve-factory-item.ts") ||
      normalized.endsWith("/start-builder-for-item.ts") ||
      normalized.endsWith("/agent-chat.ts") ||
      normalized.endsWith("/builder-executor.ts") ||
      normalized.includes("/pr-policy.") ||
      normalized.endsWith("/factory-scheduler-job.ts") ||
      normalized.startsWith(".github/workflows/") ||
      normalized.startsWith(".github/actions/") ||
      /(^|\/)(auth|authentication|identity|credentials?|secrets?|sessions?|permissions?|tenant|tenants|isolation|security|execution|sandbox|payments?|billing|deploy|deployment|netlify|publish|release|migrations?)(\/|[-_.]|$)/.test(
        normalized,
      )
    );
  });
}

const SAFETY_FINDING_PATTERN =
  /\b(auth|authentication|authorization|credential|secret|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|unsafe|bypass|data loss|xss|cross-site scripting|csrf|cross-site request forgery)\b/i;
const NON_FINDING_PATTERN =
  /(?:\b(?:no|none|zero)\s+(?:known\s+)?(?:active\s+)?(?:auth|authentication|authorization|credential|secret|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|data loss|xss|cross-site scripting|csrf|cross-site request forgery)\b)|(?:\b(?:not|isn't|is not)\s+(?:an?\s+)?(?:auth|authentication|authorization|credential|secret|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|data loss|xss|cross-site scripting|csrf|cross-site request forgery)\s+(?:change|issue|finding|concern|risk)\b)|(?:\b(?:auth|authentication|authorization|credential|secret|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|data loss|xss|cross-site scripting|csrf|cross-site request forgery)\b.{0,50}\b(?:resolved|fixed|mitigated|safe|secure|good|clear|clean|false positive)\b)/i;

export function hasActiveCredibleSafetyFinding(
  reviews: readonly {
    author?: string;
    state: string;
    body?: string | null;
    observedAt?: string;
  }[],
  comments: readonly { body: string; isResolved?: boolean }[],
): boolean {
  const isFinding = (body: string) =>
    body
      .split(
        /(?:[.!?]\s+|;\s*|,\s*(?:but|however|while)\s+|\s+(?:but|however|while)\s+)/i,
      )
      .some(
        (sentence) =>
          SAFETY_FINDING_PATTERN.test(sentence) &&
          !NON_FINDING_PATTERN.test(sentence),
      );
  const latestReviewByAuthor = new Map<string, (typeof reviews)[number]>();
  reviews.forEach((review, index) => {
    const author = review.author?.trim().toLowerCase() || `review-${index}`;
    const previous = latestReviewByAuthor.get(author);
    if (!previous || (review.observedAt ?? "") >= (previous.observedAt ?? "")) {
      latestReviewByAuthor.set(author, review);
    }
  });
  return (
    reviews.some((review) => {
      const author = review.author?.trim().toLowerCase();
      const latest = author ? latestReviewByAuthor.get(author) : undefined;
      return (
        review.state !== "dismissed" &&
        typeof review.body === "string" &&
        isFinding(review.body) &&
        (latest?.state !== "approved" || latest === review)
      );
    }) ||
    comments.some(
      (comment) => comment.isResolved !== true && isFinding(comment.body),
    )
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
