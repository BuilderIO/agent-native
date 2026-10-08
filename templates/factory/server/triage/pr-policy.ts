import type { GuardResult, TriageCoverage } from "./contracts.js";

export type OwnerOwnedArea = "clips" | "design" | "content";

export type PullRequestOwnerException =
  | "alice-content"
  | "nick-slides"
  | "enzo-factory"
  | "sid-design"
  | "shomix"
  | "docs-only";

export type PullRequestTrustException = "liamdebeasi";

const LIAMDEBEASI_USER_ID = 2721089;
const SHOMIX_USER_ID = 100691266;
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
  checksCoverage?: TriageCoverage;
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

export function hasAcceptableGovernanceCheckEvidence(input: {
  checksPassed: boolean;
  checksCoverage: TriageCoverage;
  internalBuilderMember: boolean;
}): boolean {
  return (
    input.checksCoverage === "complete" &&
    (input.internalBuilderMember || input.checksPassed)
  );
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
    input.factoryTriggered &&
    !ultraScary;
  const ownerException = detectPullRequestOwnerException(input);
  const verifiedOwnerException =
    input.internalBuilderMember && !ultraScary ? ownerException : null;
  const internalEvidenceException = input.internalBuilderMember;
  const checksCoverage = input.checksCoverage ?? "complete";
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
      passed: hasAcceptableGovernanceCheckEvidence({
        checksPassed: input.checksPassed,
        checksCoverage,
        internalBuilderMember: internalEvidenceException,
      }),
      reason:
        checksCoverage !== "complete"
          ? `CI check evidence is ${checksCoverage}; complete check coverage is required before autonomous approval.`
          : input.checksPassed
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
  input: Pick<
    PullRequestGovernanceInput,
    "author" | "authorId" | "repository" | "changedFiles"
  >,
): PullRequestOwnerException | null {
  const author = input.author.trim().toLowerCase();
  const changedFiles = input.changedFiles.map(normalizePath);

  if (
    author === "shomix" &&
    input.authorId === SHOMIX_USER_ID &&
    input.repository.trim().toLowerCase() === "builderio/agent-native"
  ) {
    return "shomix";
  }
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
    commitSha?: string | null;
    observedAt: string;
  }[],
  headSha: string,
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
      if (
        (review.state === "approved" || review.state === "dismissed") &&
        review.commitSha === headSha
      ) {
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
    const normalized = normalizePath(file).replace(
      /\.(?:spec|test)(?=\.[^.]+$)/,
      "",
    );
    const securityPath = file
      .trim()
      .split("\\")
      .join("/")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase();
    const factorySecurityPath =
      normalized.startsWith("templates/factory/server/triage/") ||
      /^templates\/factory\/(?:server\/lib\/(?:require-factory-automation|factory-automation-(?:resources|caller|config|history|repair)|factory-scope|provider-api|github-repository|pr-babysit-prompt|slack-feedback-prompt|factory-config-reconcile|factory-poll-cursors|factory-audit-report|audit-cursor|source-reaction|safe-http-url)|server\/plugins\/factory-scheduler-job|actions\/(?:run|save|create)-factory-automation|actions\/(?:get|list|restore)-factory-automation-(?:version|versions)|actions\/list-factory-automations|actions\/(?:get-factory-automation-health|list-factory-automation-templates|govern-factory-pull-request|create-factory|(?:save|get)-factory-graph|(?:get|list|restore)-factory-graph-version(?:s)?|(?:get|save)-triage-config|save-triage-rule|get-triage-item|list-triage-items|list-factory-comments|list-triage-rules|evaluate-triage-item|factory-graph-history|provider-api-request|poll-(?:github-sources|slack-channel|sentry-errors)|dispatch-factory-item|list-factory-audit|babysit-factory-pull-request|propose-pr-babysit-status|get-slack-feedback-context))\./.test(
        normalized,
      ) ||
      normalized.startsWith("templates/factory/server/factory-graph/") ||
      normalized.startsWith("templates/factory/app/lib/safe-http-url.");
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
      normalized.endsWith("/govern-factory-pull-request.ts") ||
      normalized.includes("/require-workspace-member.") ||
      normalized.endsWith("/start-builder-for-item.ts") ||
      normalized.endsWith("/agent-chat.ts") ||
      normalized.endsWith("/builder-executor.ts") ||
      normalized.startsWith("packages/core/src/server/builder-browser.") ||
      normalized.startsWith("packages/core/src/server/core-routes-plugin.") ||
      normalized.startsWith("packages/core/src/server/open-route.") ||
      normalized.startsWith(
        "packages/core/src/server/agent-chat/browser-team-tools.",
      ) ||
      normalized.startsWith(
        "packages/core/src/server/builder-preview-relay.",
      ) ||
      normalized.startsWith("packages/core/src/server/agent-chat-plugin.") ||
      normalized.startsWith("packages/core/src/server/action-routes.") ||
      normalized.startsWith(
        "packages/core/src/server/hosted-harness-policy.",
      ) ||
      normalized.startsWith("packages/core/src/cli/workspace-skill-policy.") ||
      normalized.startsWith("packages/core/src/triggers/routes.") ||
      normalized.startsWith("packages/core/src/collab/routes.") ||
      normalized.startsWith("packages/core/src/collab/struct-routes.") ||
      normalized.startsWith("packages/core/src/notifications/routes.") ||
      normalized.startsWith("packages/core/src/notifications/") ||
      normalized.startsWith("packages/core/src/jobs/") ||
      normalized.startsWith("packages/core/src/triggers/") ||
      normalized.startsWith("packages/core/src/automations/") ||
      normalized.startsWith("packages/core/src/server/collab-plugin.") ||
      normalized.startsWith("packages/core/src/server/origin-allowlist.") ||
      normalized.startsWith("packages/core/src/server/prompts/") ||
      normalized.startsWith("packages/core/src/guards/no-unscoped-queries.") ||
      normalized.startsWith("templates/mail/app/lib/sanitize-html.") ||
      normalized.startsWith("templates/analytics/app/components/markdown.") ||
      normalized.startsWith("templates/design/app/lib/figma-svg-copy.") ||
      normalized.startsWith(
        "templates/design/app/pages/design-editor/commands/pasted-svg.",
      ) ||
      normalized.startsWith("templates/plan/server/plan-content.") ||
      normalized.startsWith(
        "templates/design/server/routes/api/qa-figma-import-assets/",
      ) ||
      normalized.startsWith(
        "packages/core/src/client/chat/markdown-renderer.",
      ) ||
      normalized.startsWith("packages/docs/app/components/markdownrenderer.") ||
      normalized.startsWith("templates/slides/app/lib/sanitize-slide-html.") ||
      normalized.startsWith(
        "templates/slides/app/components/deck/sliderenderer.",
      ) ||
      normalized.startsWith("templates/design/shared/capture-sanitize.") ||
      normalized.startsWith(
        "templates/brain/server/lib/capture-sanitization.",
      ) ||
      normalized.startsWith("templates/brain/actions/resanitize-captures.") ||
      normalized.startsWith(
        "templates/plan/app/components/plan/wireframe/sanitize-html.",
      ) ||
      normalized.startsWith(
        "templates/calendar/app/lib/sanitize-description.",
      ) ||
      normalized.endsWith("/migrate-production.ts") ||
      normalized === ".claude/settings.json" ||
      normalized.startsWith("scripts/hooks/") ||
      /(^|\/)db\/schema(?:-[^/]+)?\.tsx?$/.test(normalized) ||
      /(^|\/)actions\/(?:[a-z0-9]+-)*(?:delete|remove|purge|erase|destroy|drop|reset)-[^/]+\.(?:ts|tsx)$/.test(
        normalized,
      ) ||
      /(^|\/)actions\/migrate-[^/]+\.(?:ts|tsx)$/.test(normalized) ||
      /(^|\/)codeowners$/.test(normalized) ||
      /^scripts\/guard-[^/]+\.(?:ts|tsx|mjs|js)$/.test(normalized) ||
      /(^|\/)(?:amplify|netlify|wrangler|cloudflare|vercel|fly|render)\.(?:ya?ml|toml|jsonc?)$/i.test(
        normalized,
      ) ||
      normalized.endsWith("/framework-route-prefix.ts") ||
      normalized.endsWith("/framework-route-prefix.spec.ts") ||
      normalized.endsWith("/recap.ts") ||
      normalized.includes("/browser-context/") ||
      normalized.startsWith("packages/core/src/client/host-bridge.") ||
      normalized.startsWith("packages/core/src/client/frame.") ||
      normalized.startsWith("packages/core/src/client/builder-frame.") ||
      normalized.startsWith("packages/core/src/client/blocks/library/html.") ||
      normalized.startsWith(
        "packages/core/src/client/blocks/library/diagram.",
      ) ||
      normalized.startsWith(
        "packages/core/src/client/blocks/library/wireframe.",
      ) ||
      normalized.includes("/pr-policy.") ||
      factorySecurityPath ||
      normalized.startsWith("packages/core/src/automation/") ||
      normalized.startsWith("packages/core/src/client/mcp-apps/") ||
      normalized.startsWith("packages/core/src/mcp/embed-app.") ||
      normalized.startsWith("packages/core/src/mcp/mount-mcp.") ||
      normalized.startsWith("packages/core/src/mcp/build-server.") ||
      normalized.includes("/scripts/db/") ||
      normalized.startsWith(
        "packages/core/src/client/blocks/library/sanitize-html.",
      ) ||
      normalized.startsWith(".github/workflows/") ||
      normalized.startsWith(".github/actions/") ||
      /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|pnpm-workspace\.yaml|\.npmrc|\.yarnrc(?:\.yml)?|turbo\.jsonc?|nx\.json|lerna\.json|dockerfile(?:\..*)?|docker-compose(?:\..*)?|\.nvmrc|\.node-version|vite\.config\..*|webpack\.config\..*|rollup\.config\..*|esbuild\.config\..*|tsconfig(?:\..*)?\.json|makefile)$/i.test(
        normalized,
      ) ||
      /(^|[\/_\.-])(?:auth|authorize|authentication|authorization|identity|passwords?|credentials?|secrets?|keys?|sessions?|permissions?|access|members?|membership|roles?|groups?|grants?|approvals?|scopes?|csrf|cors|dependabot|renovate|federation|orgs?|a2a|webmcp|mcp|tenant|tenants|isolation|security|execution|sandbox|payments?|subscriptions?|billing|deploy|deployment|netlify|publish|release|migrations?|oauth|embed(?:ded|ding)?|iframeembed|iframe[-_]?bridge|agentnativeembedded|mcp-app-host|connect(?:ion|or)?s?|integrations?|extensions?|safe[-_]?native[-_]?preview|preview[-_]?execution|rendered[-_]?page|service[-_]tokens?|short[-_]lived[-_]tokens?|realtime[-_]tokens?|internal[-_]tokens?|ssrf|url[-_]?safety|fetch[-_]?tool|db[-_]?admin|webhooks?)([\/_-]|\.|$)/.test(
        securityPath,
      )
    );
  });
}

const SAFETY_FINDING_PATTERN =
  /\b(auth|authentication|authorization|credential|secret|api[- ]keys?|api[- ]tokens?|webhook[- ]tokens?|(?:access|refresh|bearer|session|service|signing|oauth|auth)[- ]tokens?|tokens?\s+(?:(?:is|are|was|were)\s+)?(?:exposed|leaked|returned|sent|logged|stolen|disclosed)|passwords?|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|unsafe|bypass|data loss|xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|oauth|cors|redirects?|open redirect|(?:untrusted|raw|unsafe|unsanitized|unescaped)\s+html|event[- ]handlers?|script(?:s|[- ]tags?|[- ]execution|[- ]injection)|sanitiz(?:e|ers?|ations?|ed|ing))\b/i;
const HTML_TAINT_SOURCE_PATTERN = String.raw`(?:(?:(?:user|attacker)[- ](?:controlled|supplied|provided|generated|injected)|malicious|arbitrary|raw|untrusted(?:\s+(?:user|attacker))?|external|remote|uploaded|webhook|third[- ]party|request[- ]body|api[- ]response|comment|unsanitized|unescaped)\s+(?:html|markup|svg|input|content|value)|(?:html|markup|svg)\s+(?:supplied|provided|generated|injected)\s+by\s+(?:(?:the|a)\s+)?(?:user|attacker)|(?:html|markup|svg)\s+(?:from\s+(?:the\s+)?(?:pr\s+(?:body|description)|request[- ]body|api[- ]response|comment|untrusted\s+source|user\s+input))|(?:user|attacker)\s+input)`;
const HTML_SINK_PATTERN = String.raw`(?:innerhtml|dangerouslysetinnerhtml|(?:render|insert|assign|reflect|pass|put)\w*\b.{0,50}\b(?:dom|html\s+rendering))`;
const HTML_EVENT_HANDLER_ACTION_PATTERN = String.raw`(?:execute|run|fire|trigger|call|invok|evaluat|eval|perform|fetch|post|request|redirect|navigat|access|open|load|write|beacon|emit|message|stor|mutat|modif|alter|leak|exfiltrat|steal|read|send|transmit|disclos|expos|capture|harvest)\w*`;
const HTML_EVENT_HANDLER_COOKIE_ACTION_PATTERN = String.raw`(?:set|update)\w*\b.{0,30}\bdocument\s*\.\s*cookie\b`;
const HTML_EVENT_HANDLER_LOCATION_ACTION_PATTERN = String.raw`(?:set|update|assign|reassign|change|replace|overwrite|modify|alter|write)\w*\b.{0,30}\b(?:(?:window\s*\.\s*)?location(?:\s*\.\s*(?:href|hash|pathname|search))?)`;
const HTML_EVENT_HANDLER_REFERENCE_PATTERN = String.raw`(?:\bon[a-z]+(?:\s*(?:=|\s+(?:handler(?:\s+attribute)?|event(?:\s+attribute)?|attribute)))?|\b(?:event[- ]?)?handler\b)`;
const HTML_UNSAFE_SIGNAL_PATTERN = String.raw`(?:unescaped|unsanitized|without\s+(?:proper\s+)?(?:escaping|encoding|sanitiz(?:ation|ing))|(?:not|never|isn't|is\s+not)\s+(?:properly\s+)?(?:escaped|encoded|sanitized|sanitised)|no\s+(?:proper\s+)?(?:escaping|encoding|sanitiz(?:ation|ing))|(?:execute|run)\w*\b.{0,20}\b(?:javascript|scripts?)|(?:${HTML_EVENT_HANDLER_REFERENCE_PATTERN}.{0,50}\b${HTML_EVENT_HANDLER_ACTION_PATTERN}|\b${HTML_EVENT_HANDLER_ACTION_PATTERN}.{0,50}${HTML_EVENT_HANDLER_REFERENCE_PATTERN}|${HTML_EVENT_HANDLER_REFERENCE_PATTERN}.{0,50}\b${HTML_EVENT_HANDLER_COOKIE_ACTION_PATTERN}|\b${HTML_EVENT_HANDLER_COOKIE_ACTION_PATTERN}.{0,50}${HTML_EVENT_HANDLER_REFERENCE_PATTERN}|${HTML_EVENT_HANDLER_REFERENCE_PATTERN}.{0,50}\b${HTML_EVENT_HANDLER_LOCATION_ACTION_PATTERN}|\b${HTML_EVENT_HANDLER_LOCATION_ACTION_PATTERN}.{0,50}${HTML_EVENT_HANDLER_REFERENCE_PATTERN}))`;
const UNSAFE_HTML_SINK_FINDING_PATTERN = new RegExp(
  [
    String.raw`\b${HTML_TAINT_SOURCE_PATTERN}\b.{0,100}\b(?:${HTML_SINK_PATTERN}|${HTML_UNSAFE_SIGNAL_PATTERN})\b`,
    String.raw`\b${HTML_SINK_PATTERN}\b.{0,80}\b${HTML_TAINT_SOURCE_PATTERN}\b`,
    String.raw`\b${HTML_UNSAFE_SIGNAL_PATTERN}\b.{0,80}\b${HTML_TAINT_SOURCE_PATTERN}\b(?:.{0,80}\b${HTML_SINK_PATTERN}\b)?`,
    String.raw`\b${HTML_TAINT_SOURCE_PATTERN}\b.{0,80}\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>]+)(?:.{0,80}\b${HTML_SINK_PATTERN}\b)?`,
    String.raw`\battacker\b.{0,30}\binject\w*\s+(?:html|markup)\b.{0,60}\b(?:dom|${HTML_UNSAFE_SIGNAL_PATTERN})\b`,
    String.raw`\bhtml\b.{0,50}\bfrom\s+(?:the\s+)?(?:pr\s+body|user(?:[- ]controlled)?\s+input|(?:an?\s+)?untrusted\s+source)\b.{0,50}\b(?:insert|assign|render)\w*\b.{0,30}\b(?:directly|unescaped)\b`,
    String.raw`\bhtml\b.{0,50}\b(?:render|insert)\w*\b.{0,20}\bunescaped\b.{0,50}\bfrom\s+(?:an?\s+)?untrusted\s+source\b`,
  ].join("|"),
  "i",
);
const SAFE_HTML_HANDLING_PATTERN =
  /\b(?:(?:render|insert)\w*\s+safely|safely\s+(?:render|insert)\w*)\b/i;
const SAFE_HTML_PRE_SINK_PATTERN =
  /\b(?:sanitiz\w*|escap\w*|encod\w*|set\w*\s+to\s+(?:null|undefined))\b.{0,30}\b(?:and\s+then|before|prior\s+to|then)\b.{0,30}$/i;
const NEGATED_SAFE_HTML_HANDLING_PATTERN =
  /\b(?:(?:not|never|isn't|is\s+not|does\s+not)\b.{0,24}\b(?:sanitiz\w*|escap\w*|encod\w*|safely)\b|no\s+(?:proper\s+)?(?:sanitiz\w*|escap\w*|encod\w*))\b/i;
function isSafeHtmlHandlingAt(
  sentence: string,
  start: number,
  end: number,
  hasExplicitUnsafeHtmlSignal: boolean,
): boolean {
  if (hasExplicitUnsafeHtmlSignal) return false;

  const finding = sentence.slice(start, end);
  const sinks = Array.from(
    finding.matchAll(new RegExp(HTML_SINK_PATTERN, "gi")),
  );
  const lastSink = sinks[sinks.length - 1];
  if (!lastSink) return false;

  const previousSink = sinks[sinks.length - 2];
  const flowStart = previousSink
    ? start + (previousSink.index ?? 0) + previousSink[0].length
    : start;
  const sinkStart = lastSink.index ?? 0;
  const safeHandlingBeforeSink = sentence.slice(flowStart, start + sinkStart);
  const safeSink = SAFE_HTML_HANDLING_PATTERN.test(lastSink[0]);
  if (
    !NEGATED_SAFE_HTML_HANDLING_PATTERN.test(
      `${safeHandlingBeforeSink} ${lastSink[0]}`,
    ) &&
    (safeSink || SAFE_HTML_PRE_SINK_PATTERN.test(safeHandlingBeforeSink))
  ) {
    return true;
  }

  const flowEnd = start + sinkStart + lastSink[0].length;
  return /^\s*(?:,?\s*(?:but|and)\s+)?only\s+after\s+(?:proper\s+)?(?:escaping|encoding|sanitiz\w*)\b/i.test(
    sentence.slice(flowEnd, flowEnd + 80),
  );
}
const COMPOUND_SAFETY_FINDING_PATTERN =
  /\b(?:auth(?:entication)?\s+bypass|(?:xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|ssrf|rce|sanitiz(?:e|ers?|ations?|ed|ing))(?:['’]s)?\s+vulnerabilit(?:y|ies)|api[- ](?:keys?|tokens?)\s+vulnerabilit(?:y|ies)|(?:xss|csrf|csp)(?:(?:\s*,\s*|\s*,?\s+(?:and|or)\s+)(?:xss|csrf|csp|auth(?:entication)?|authorization)){1,3}\s+vulnerabilit(?:y|ies)|csp\s+(?:and|&)\s+auth(?:entication)?\s+bypass|oauth(?:\s+callback)?\s+redirects?|cors\s+vulnerabilit(?:y|ies)|tenant\s+isolation|access\s+control|privilege\s+escalation)\b/i;
const NEGATED_SAFETY_TOPIC_PATTERN = String.raw`(?:auth(?:entication|orization)?(?:\s+bypass)?|credential|secret|api[- ]keys?|api[- ]tokens?|webhook[- ]tokens?|(?:access|refresh|bearer|session|service|signing|oauth|auth)[- ]tokens?|tokens?|passwords?|permissions?|access\s+control|privilege\s+escalation|tenant(?:\s+isolation)?|isolation|security|execution|sandbox|payments?|billing|deployment|ssrf|rce|injection|vulnerabilit(?:y|ies)|exploits?|unsafe|bypass|data\s+loss|xss|cross-site\s+scripting|csrf|cross-site\s+request\s+forgery|csp|content[- ]security[- ]policy|oauth(?:\s+callback)?(?:\s+redirect)?|cors|redirects?|open\s+redirect|(?:untrusted|raw|unsafe|unsanitized|unescaped)\s+html|event[- ]handlers?|script(?:s|[- ]tags?|[- ]execution|[- ]injection)|sanitiz(?:e|ers?|ations?|ed|ing))`;
const NEGATED_SAFETY_TOPIC_LIST_PATTERN = String.raw`${NEGATED_SAFETY_TOPIC_PATTERN}(?:(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)${NEGATED_SAFETY_TOPIC_PATTERN})*`;
const NEGATED_FINDING_PATTERN = new RegExp(
  String.raw`\b(?:no|none|zero)\s+(?:known\s+)?(?:active\s+)?${NEGATED_SAFETY_TOPIC_LIST_PATTERN}\s+(?:(?:security\s+)?(?:issues?|findings?|concerns?|risks?|vulnerabilit(?:y|ies)|exploits?)\b(?:\s+(?:were|was|are|is)\s+(?:found|identified|reported|present)\b)?|(?:were|was|are|is)\s+(?:found|identified|reported|present)\b)(?=\s*(?:[,.;!?]|\b(?:and|but|however|while)\b|$))`,
  "i",
);
const NEGATED_HTML_EVENT_HANDLER_COOKIE_PATTERN = new RegExp(
  String.raw`\bno\s+(?:${HTML_TAINT_SOURCE_PATTERN}\s+)?${HTML_EVENT_HANDLER_REFERENCE_PATTERN}.{0,50}\b${HTML_EVENT_HANDLER_COOKIE_ACTION_PATTERN}(?=\s*(?:to\s+(?:an?\s+)?(?:attacker|external|remote)\s+(?:endpoint|url))?(?:[,.;!?]|\b(?:and|but|however|while)\b|$))`,
  "i",
);
const NEGATED_HTML_EVENT_HANDLER_LOCATION_PATTERN = new RegExp(
  String.raw`\bno\s+(?:${HTML_TAINT_SOURCE_PATTERN}\s+)?${HTML_EVENT_HANDLER_REFERENCE_PATTERN}.{0,50}\b${HTML_EVENT_HANDLER_LOCATION_ACTION_PATTERN}(?=\s*(?:to\s+(?:an?\s+)?(?:attacker|external|remote|untrusted)(?:[- ]controlled)?\s+(?:page|url|site|domain|origin))?(?:[,.;!?]|\b(?:and|but|however|while)\b|$))`,
  "i",
);
const SAFE_HTML_HANDLER_REMOVAL_PATTERN = new RegExp(
  String.raw`\b(?:${HTML_TAINT_SOURCE_PATTERN}\s+)?${HTML_EVENT_HANDLER_REFERENCE_PATTERN}\b.{0,160}?\b(?:removed|stripped|sanitized|sanitised|set\s+to\s+(?:null|undefined))\b.{0,40}?\b(?:before|prior\s+to)\s+(?:insertion|rendering|execution)\b`,
  "i",
);
const NON_FINDING_PATTERN =
  /(?:\b(?:no|none|zero)\s+(?:known\s+)?(?:active\s+)?(?:(?:api[- ]keys?|tokens?|xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|(?:html\s+)?sanitiz(?:e|ers?|ations?|ed|ing))\s+(?:or|and)\s+)*(?:(?:api[- ]keys?|tokens?|xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|(?:html\s+)?sanitiz(?:e|ers?|ations?|ed|ing))\s+)?(?:security\s+(?:issues?|findings?|concerns?|risks?|vulnerabilit(?:y|ies))|issues?|findings?|concerns?|risks?|vulnerabilit(?:y|ies)|exploits?)\b(?:\s+(?:were|was|are|is))?\s+(?:found|identified|reported|present)\b)|(?:\b(?:not|isn't|is not)\s+(?:an?\s+)?(?:auth|authentication|authorization|credential|secret|api[- ]keys?|tokens?|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|data loss|xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|(?:html\s+)?sanitiz(?:e|ers?|ations?|ed|ing))\s+(?:change|issue|finding|concern|risk)\b)|(?:\b(?:auth|authentication|authorization|credential|secret|api[- ]keys?|tokens?|permission|access control|privilege escalation|tenant|isolation|security|execution|sandbox|payment|billing|deployment|ssrf|rce|injection|vulnerability|exploit|data loss|xss|cross-site scripting|csrf|cross-site request forgery|csp|content[- ]security[- ]policy|(?:html\s+)?sanitiz(?:e|ers?|ations?|ed|ing))\b.{0,50}\b(?:resolved|fixed|mitigated|safe|secure|good|clear|clean|false positive)\b)/i;

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
    body.split(/(?:[.!?]\s+|\r?\n+)/i).some((sentence) => {
      const unsafeHtmlFindings = Array.from(
        sentence.matchAll(
          new RegExp(UNSAFE_HTML_SINK_FINDING_PATTERN.source, "gi"),
        ),
      );
      const hasExplicitUnsafeHtmlSignal = new RegExp(
        HTML_UNSAFE_SIGNAL_PATTERN,
        "i",
      ).test(sentence);
      const safetyTerms = [
        ...sentence.matchAll(new RegExp(SAFETY_FINDING_PATTERN.source, "gi")),
        ...unsafeHtmlFindings.filter(
          (finding) =>
            !isSafeHtmlHandlingAt(
              sentence,
              finding.index ?? 0,
              (finding.index ?? 0) + finding[0].length,
              hasExplicitUnsafeHtmlSignal,
            ),
        ),
      ].filter((term) => {
        if (!/^(?:untrusted|raw)\s+html$|^sanitiz\w*$/i.test(term[0])) {
          return true;
        }

        const start = term.index ?? 0;
        const linkedFinding = unsafeHtmlFindings.find((finding) => {
          const findingStart = finding.index ?? 0;
          const findingEnd = findingStart + finding[0].length;
          const termIsWithinFinding =
            start >= findingStart && start < findingEnd;
          const termIsSafeTail =
            /^sanitiz\w*$/i.test(term[0]) &&
            start >= findingEnd &&
            start < findingEnd + 80 &&
            isSafeHtmlHandlingAt(
              sentence,
              findingStart,
              findingEnd,
              hasExplicitUnsafeHtmlSignal,
            );
          return termIsWithinFinding || termIsSafeTail;
        });
        return (
          !linkedFinding ||
          !isSafeHtmlHandlingAt(
            sentence,
            linkedFinding.index ?? 0,
            (linkedFinding.index ?? 0) + linkedFinding[0].length,
            hasExplicitUnsafeHtmlSignal,
          )
        );
      });
      if (safetyTerms.length === 0) return false;

      const safeHandlerRemovals = Array.from(
        sentence.matchAll(
          new RegExp(SAFE_HTML_HANDLER_REMOVAL_PATTERN.source, "gi"),
        ),
      ).filter((match) => {
        const handlerReference = new RegExp(
          HTML_EVENT_HANDLER_REFERENCE_PATTERN,
          "i",
        ).exec(match[0]);
        const removal =
          /\b(?:removed|stripped|sanitized|sanitised|set\s+to\s+(?:null|undefined))\b/i.exec(
            match[0],
          );
        if (!handlerReference || !removal) return false;

        const betweenHandlerAndRemoval = match[0].slice(
          (handlerReference.index ?? 0) + handlerReference[0].length,
          removal.index,
        );
        const removalIsTiedToHandler =
          /^\s*(?:(?:is|was|has\s+been)\s+)?$/i.test(
            betweenHandlerAndRemoval,
          ) ||
          /\b(?:(?:the|this|that|same)\s+)?(?:event[- ]?)?handler(?:\s+itself)?\s+(?:(?:is|was|has\s+been)\s+)?$/i.test(
            betweenHandlerAndRemoval,
          );
        const afterRemoval = match[0].slice(removal.index + removal[0].length);
        return (
          removalIsTiedToHandler &&
          !/\b(?:another|other|separate|different|second|additional)\b/i.test(
            betweenHandlerAndRemoval,
          ) &&
          !/\b(?:not|never|isn't|wasn't|aren't|weren't|doesn't|don't|didn't|hasn't|haven't|cannot|can't|without|no longer)\b.{0,40}$/i.test(
            match[0].slice(0, removal.index),
          ) &&
          !/\bfail(?:s|ed)?\s+to(?:\s+be)?\b.{0,30}$/i.test(
            match[0].slice(0, removal.index),
          ) &&
          !/\bafter\s+(?:insertion|rendering|execution)\b.{0,40}\b(?:before|prior\s+to)\s+(?:insertion|rendering|execution)\b/i.test(
            afterRemoval,
          )
        );
      });
      const nonFindings = [
        ...sentence.matchAll(new RegExp(NON_FINDING_PATTERN.source, "gi")),
        ...sentence.matchAll(new RegExp(NEGATED_FINDING_PATTERN.source, "gi")),
        ...sentence.matchAll(
          new RegExp(NEGATED_HTML_EVENT_HANDLER_COOKIE_PATTERN.source, "gi"),
        ),
        ...sentence.matchAll(
          new RegExp(NEGATED_HTML_EVENT_HANDLER_LOCATION_PATTERN.source, "gi"),
        ),
        ...safeHandlerRemovals,
      ];
      return safetyTerms.some((safetyTerm) => {
        const index = safetyTerm.index ?? 0;
        const coveringNonFinding = nonFindings.find((match) => {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          const termEnd = index + safetyTerm[0].length;
          const coversTerm = index >= start && termEnd <= end;
          const coveredTerms = safetyTerms.filter((term) => {
            const termIndex = term.index ?? 0;
            return termIndex >= start && termIndex + term[0].length <= end;
          });
          const compound = COMPOUND_SAFETY_FINDING_PATTERN.exec(match[0]);
          const compoundStart = start + (compound?.index ?? 0);
          const compoundEnd = compoundStart + (compound?.[0].length ?? 0);
          return (
            coversTerm &&
            (/^\b(?:no|none|zero)\b/i.test(match[0]) ||
              safeHandlerRemovals.includes(match) ||
              coveredTerms.length === 1 ||
              (compound !== null &&
                coveredTerms.every((term) => {
                  const termIndex = term.index ?? 0;
                  return termIndex >= compoundStart && termIndex < compoundEnd;
                })))
          );
        });
        return (
          !coveringNonFinding ||
          /\b(?:not|isn't|is not|never)\b.{0,20}\b(?:resolved|fixed|mitigated|safe|secure)\b/i.test(
            coveringNonFinding[0],
          )
        );
      });
    });
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
    exception === "shomix" ||
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
