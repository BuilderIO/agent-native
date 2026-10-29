import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(new URL("../package.json", import.meta.url))(
  "@electric-sql/pglite",
);

import { triageDecisions, triageItems } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/lib/factory-ids.js";
import { GitHubRequestError } from "../server/triage/github-client.js";
import { stableId } from "../server/triage/ids.js";
import type { ReviewCommentObservation } from "../server/triage/pr-babysit.js";
import type { PullRequestReviewObservation } from "../server/triage/pr-monitor.js";
import { FACTORY_APPROVAL_BODY_MARKER } from "../server/triage/pr-policy.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const getDbMock = vi.hoisted(() => vi.fn());
const resolveFactoryRepositoryMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());
const createGitHubClientMock = vi.hoisted(() => vi.fn());
const parseTriageMetadataMock = vi.hoisted(() => vi.fn());
const serializeTriageMetadataMock = vi.hoisted(() => vi.fn());

const governanceDecisionId = (headSha = "head-sha-1") =>
  stableId("pr-governance", "org-1", "item-1", headSha);
const manualDispositionId = (headSha = "head-sha-1") =>
  stableId("pr-governance-manual", "org-1", "item-1", headSha);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (
    message: string,
    options?: { errorCode?: string; statusCode?: number },
  ) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("../server/db/index.js", () => ({ getDb: getDbMock }));
vi.mock("../server/lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: resolveFactoryRepositoryMock,
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireFactoryAutomationMock,
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));
vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: recordFactoryAuditMock,
}));
vi.mock("../server/triage/github-client.js", () => ({
  GitHubRequestError: class GitHubRequestError extends Error {
    constructor(
      message: string,
      readonly requestAttempted: boolean,
      readonly status: number | null = null,
      readonly rateLimited = false,
    ) {
      super(message);
    }
  },
  createGitHubClient: createGitHubClientMock,
}));
vi.mock("../server/triage/metadata.js", () => ({
  parseTriageMetadata: parseTriageMetadataMock,
  serializeTriageMetadata: serializeTriageMetadataMock,
}));

import { pullRequestSummary } from "../server/lib/factory-pull-request.fixture.js";
import action, {
  hasSafeFinalApprovalGateEvidence,
} from "./govern-factory-pull-request.js";

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.test",
};

beforeEach(async () => {
  vi.clearAllMocks();
  client = await PGlite.create("memory://");
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE factory_items (
      id text PRIMARY KEY,
      source text NOT NULL,
      external_id text NOT NULL,
      source_url text,
      title text NOT NULL,
      summary text,
      status text NOT NULL,
      risk text NOT NULL,
      confidence text NOT NULL,
      channel_id text,
      thread_ts text,
      repository text,
      pull_request_number integer,
      head_sha text,
      coverage text NOT NULL,
      dedupe_key text NOT NULL,
      metadata_json text NOT NULL,
      payload_json text NOT NULL,
      text_ref text,
      last_seen_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      factory_id text
    );
    CREATE TABLE factory_decisions (
      id text PRIMARY KEY,
      item_id text NOT NULL,
      rule_id text,
      mode text NOT NULL,
      outcome text NOT NULL,
      reason text NOT NULL,
      guard_results_json text NOT NULL,
      model text,
      prompt_version integer,
      created_at text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      factory_id text
    );
    CREATE TABLE factory_runs (
      item_id text NOT NULL,
      provider text,
      provider_task_id text,
      status text NOT NULL,
      org_id text,
      factory_id text
    );
  `);
  getDbMock.mockReturnValue(db);
  resolveFactoryRepositoryMock.mockResolvedValue("BuilderIO/agent-native");
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.test",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue(context);
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  parseTriageMetadataMock.mockReturnValue({});
  serializeTriageMetadataMock.mockReturnValue("{}");
});

afterEach(async () => {
  await client.close();
});

async function seedItem(
  status: string,
  includeClaim = false,
  factoryId = "factory-1",
) {
  await db.insert(triageItems).values({
    id: "item-1",
    source: "github",
    externalId: "BuilderIO/agent-native#42",
    title: "Review pull request",
    status,
    risk: "unknown",
    confidence: "unknown",
    repository: "BuilderIO/agent-native",
    pullRequestNumber: 42,
    coverage: "complete",
    dedupeKey: "BuilderIO/agent-native#42",
    metadataJson: "{}",
    payloadJson: "{}",
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    factoryId,
  });
  if (!includeClaim) return;
  await db.insert(triageDecisions).values({
    id: governanceDecisionId(),
    itemId: "item-1",
    ruleId: null,
    mode: "automation",
    outcome: "auto_approval_claimed",
    reason: "Approval was claimed before revalidation.",
    guardResultsJson: "[]",
    model: "factory-pr-governance",
    promptVersion: 1,
    createdAt: "2026-10-28T12:00:00.000Z",
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    factoryId,
  });
}

function governanceGitHub(input: {
  currentApproval?: boolean;
  reviewEvents?: readonly PullRequestReviewObservation[];
  changedFiles?: string[];
  headRepository?: string | null;
  assignees?: Array<{ id: number; login: string }>;
  assigneeMember?: boolean;
  reviewerMembership?: boolean;
  internalMember?: boolean;
  authorMemberships?: boolean[];
  passingChecks?: boolean;
  comments?: ReviewCommentObservation[];
  initialSummary?: Record<string, unknown>;
  revalidatedSummary?: Record<string, unknown>;
  finalPreApprovalSummary?: Record<string, unknown>;
  postApprovalSummary?: Record<string, unknown>;
  beforeEvidenceReturn?: (callNumber: number) => Promise<void>;
  afterApprovalReturn?: () => Promise<void>;
  approvalError?: unknown;
  postApprovalSummaryError?: Error;
  beforeSummaryReturn?: (callNumber: number) => Promise<void>;
}) {
  const initialSummary = pullRequestSummary({
    number: 42,
    userId: 123,
    userType: "User",
    userLogin: input.internalMember ? "internal-author" : "external-author",
    headRepository:
      input.headRepository === undefined
        ? "BuilderIO/agent-native"
        : input.headRepository,
    baseRepository: "BuilderIO/agent-native",
    assignees: input.assignees ?? [],
    ...(input.internalMember
      ? { body: "Factory item: item-1", headRef: "factory/item-1" }
      : {}),
    ...(input.initialSummary ?? {}),
  });
  const reviewEvents =
    input.reviewEvents ??
    (input.currentApproval ? [memberApprovalReview()] : []);
  let summaryCalls = 0;
  let evidenceCalls = 0;
  let authorMembershipCalls = 0;
  return {
    getPullRequestSummary: vi.fn(async () => {
      summaryCalls += 1;
      if (summaryCalls === 5) await input.afterApprovalReturn?.();
      await input.beforeSummaryReturn?.(summaryCalls);
      if (summaryCalls === 5 && input.postApprovalSummaryError) {
        throw input.postApprovalSummaryError;
      }
      const summaryOverrides =
        summaryCalls === 2
          ? input.revalidatedSummary
          : summaryCalls === 4
            ? input.finalPreApprovalSummary
            : summaryCalls === 5
              ? input.postApprovalSummary
              : undefined;
      return summaryOverrides
        ? pullRequestSummary({ ...initialSummary, ...summaryOverrides })
        : initialSummary;
    }),
    getPullRequestEvidence: vi.fn(async () => {
      evidenceCalls += 1;
      await input.beforeEvidenceReturn?.(evidenceCalls);
      return {
        comments: input.comments ?? [],
        commentsTruncated: false,
        reviews: reviewEvents,
        reviewsTruncated: false,
        checks: input.passingChecks
          ? [{ name: "CI", state: "passed", observedAt: "now" }]
          : [],
        checksCoverage: "complete",
      };
    }),
    listPullRequestChangedFiles: vi
      .fn()
      .mockResolvedValue(input.changedFiles ?? []),
    checkOrganizationMemberById: vi.fn(
      async (_organization: string, userId: number, username: string) => {
        const reviewer = reviewEvents.find(
          (review) => review.authorId === userId,
        );
        const isAuthor = userId === 123;
        const authorMembership =
          input.authorMemberships?.[authorMembershipCalls];
        if (isAuthor) authorMembershipCalls += 1;
        return {
          username,
          isMember: isAuthor
            ? (authorMembership ?? input.internalMember ?? false)
            : reviewer
              ? (input.reviewerMembership ?? true)
              : (input.assigneeMember ?? false),
        };
      },
    ),
    getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "factory-bot" }),
    createPullRequestReview: vi.fn(),
    approvePullRequest: vi.fn(async () => {
      if (input.approvalError !== undefined) throw input.approvalError;
      return {
        htmlUrl: "https://github.test/BuilderIO/agent-native/pull/42",
      };
    }),
  };
}

function memberApprovalReview(
  overrides: Partial<PullRequestReviewObservation> = {},
): PullRequestReviewObservation {
  return {
    author: "maintainer",
    authorId: 789,
    state: "approved",
    commitSha: "head-sha-1",
    authorAssociation: "MEMBER",
    authorType: "User",
    observedAt: "2026-10-28T12:00:00.000Z",
    ...overrides,
  };
}

async function runGovernance(
  github: ReturnType<typeof governanceGitHub>,
  factoryId = "factory-1",
  clearBug = false,
) {
  createGitHubClientMock.mockReturnValue(github);
  return action.run(
    {
      factoryId,
      repo: "BuilderIO/agent-native",
      pullRequestNumber: 42,
      itemId: "item-1",
      clearBug,
      productUxImplications: false,
      reason: "Review the pull request.",
    },
    context,
  );
}

async function seedInternalApprovalPath(
  includeClaim = false,
  status = "pr_observed",
) {
  await seedItem(status, includeClaim, DEFAULT_FACTORY_ID);
  await client.exec(`
    INSERT INTO factory_runs (item_id, provider, provider_task_id, status, org_id, factory_id)
    VALUES ('item-1', 'builder-http', 'task-1', 'completed', 'org-1', '${DEFAULT_FACTORY_ID}')
  `);
}

async function seedFinalizedApproval() {
  await seedItem("auto_approved", false, DEFAULT_FACTORY_ID);
  await db.insert(triageDecisions).values({
    id: governanceDecisionId(),
    itemId: "item-1",
    ruleId: null,
    mode: "automation",
    outcome: "auto_approve",
    reason: "Factory approval was finalized earlier.",
    guardResultsJson: "[]",
    model: "factory-pr-governance",
    promptVersion: 1,
    createdAt: "2026-10-28T12:00:00.000Z",
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    factoryId: DEFAULT_FACTORY_ID,
  });
}

describe("govern-factory-pull-request final check evidence", () => {
  it("uses distinct governance identities for different PR heads", () => {
    expect(governanceDecisionId("head-sha-2")).not.toBe(governanceDecisionId());
    expect(manualDispositionId("head-sha-2")).not.toBe(manualDispositionId());
  });

  it.each([
    ["a bot-authored pull request", { userType: "Bot" }],
    ["the exact steve8708 login", { userLogin: "steve8708" }],
  ])("skips %s before evidence or state changes", async (_label, author) => {
    await seedItem("pr_observed");
    const github = governanceGitHub({ initialSummary: author });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions)
      .where(eq(triageDecisions.itemId, "item-1"));

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("pr_observed");
    expect(decisions).toEqual([]);
    expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
    expect(github.listPullRequestChangedFiles).not.toHaveBeenCalled();
    expect(github.checkOrganizationMemberById).not.toHaveBeenCalled();
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "Organization"])(
    "fails closed before evidence when the author type is missing or unsupported: %s",
    async (userType) => {
      await seedItem("pr_observed");
      const github = governanceGitHub({
        initialSummary: { userType },
      });

      await expect(runGovernance(github)).rejects.toThrow(
        "author type is missing or unsupported",
      );
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];

      expect(item.status).toBe("pr_observed");
      expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
      expect(github.listPullRequestChangedFiles).not.toHaveBeenCalled();
      expect(github.checkOrganizationMemberById).not.toHaveBeenCalled();
      expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    },
  );

  it("does not start a new approval while the Factory item is on manual hold", async () => {
    await seedInternalApprovalPath(false, "needs_manual");
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ outcome: triageDecisions.outcome })
      .from(triageDecisions)
      .where(eq(triageDecisions.itemId, "item-1"));

    expect(result).toMatchObject({
      ok: true,
      action: "needs_manual",
      reason: expect.stringContaining("manual hold"),
    });
    expect(item.status).toBe("needs_manual");
    expect(decisions).toEqual([]);
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("does not reclaim an ambiguous approval when the item already needs manual disposition", async () => {
    await seedInternalApprovalPath(true, "needs_manual");
    await db
      .update(triageDecisions)
      .set({
        outcome: "needs_manual",
        reason:
          "GitHub approval request outcome is ambiguous; reconciliation is required before retrying.",
      })
      .where(eq(triageDecisions.id, governanceDecisionId()));
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(item.status).toBe("needs_manual");
    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(decision).toEqual({
      outcome: "needs_manual",
      reason:
        "GitHub approval request outcome is ambiguous; reconciliation is required before retrying.",
    });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("preserves a manual hold when a non-approval run updates the item", async () => {
    await seedInternalApprovalPath(false, "needs_manual");
    const github = governanceGitHub({
      internalMember: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("needs_manual");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("requires membership at both gates and complete check coverage", () => {
    const membership = { afterClaim: true, beforeApproval: true };
    const failedChecks = {
      checks: [{ name: "Build", state: "failed", observedAt: "now" }],
      checksCoverage: "complete",
    } as const;
    const pendingChecks = {
      checks: [{ name: "Build", state: "in_progress", observedAt: "now" }],
      checksCoverage: "complete",
    } as const;
    const incompleteEvidence = {
      checks: [{ name: "Build", state: "failed", observedAt: "now" }],
      checksCoverage: "partial",
    } as const;

    expect(hasSafeFinalApprovalGateEvidence(failedChecks, membership)).toBe(
      true,
    );
    expect(hasSafeFinalApprovalGateEvidence(pendingChecks, membership)).toBe(
      true,
    );
    expect(
      hasSafeFinalApprovalGateEvidence(incompleteEvidence, membership),
    ).toBe(false);
    expect(
      hasSafeFinalApprovalGateEvidence(failedChecks, {
        afterClaim: true,
        beforeApproval: false,
      }),
    ).toBe(false);
    expect(
      hasSafeFinalApprovalGateEvidence(
        {
          checks: [{ name: "Build", state: "passed", observedAt: "now" }],
          checksCoverage: "complete",
        },
        { afterClaim: true, beforeApproval: false },
      ),
    ).toBe(false);
  });

  it.each([
    ["closed", { state: "closed" }],
    ["draft", { draft: true }],
  ])(
    "preserves finalized auto-approved state when the pull request is %s",
    async (_state, initialSummary) => {
      await seedItem("auto_approved");
      const github = governanceGitHub({ initialSummary });

      const result = await runGovernance(github);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "skipped" });
      expect(item.status).toBe("auto_approved");
      expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["closed", { state: "closed" }],
    ["draft", { draft: true }],
  ])(
    "preserves manual handling when the pull request is %s",
    async (_state, initialSummary) => {
      await seedItem("needs_manual");
      const github = governanceGitHub({ initialSummary });

      const result = await runGovernance(github);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "skipped" });
      expect(item.status).toBe("needs_manual");
      expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
    },
  );

  it("skips duplicate governance only for a current-head BuilderIO member approval", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [memberApprovalReview()],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining("current non-dismissed approval"),
    });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
      "BuilderIO",
      789,
      "maintainer",
    );
  });

  it.each([
    [
      "a later blocking review",
      {
        reviewEvents: [
          memberApprovalReview(),
          memberApprovalReview({
            author: "reviewer-two",
            authorId: 790,
            state: "changes_requested",
            observedAt: "2026-10-28T13:00:00.000Z",
          }),
        ],
      },
    ],
    [
      "an unanswered review comment",
      {
        currentApproval: true,
        comments: [
          {
            id: "comment-1",
            author: "reviewer-two",
            inReplyToId: null,
            body: "Please update the naming before this is ready.",
            createdAt: "2026-10-28T13:00:00.000Z",
          },
        ],
      },
    ],
  ])(
    "routes a finalized approval to manual handling when %s appears",
    async (_evidence, evidence) => {
      await seedFinalizedApproval();
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        ...evidence,
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decisions = await db
        .select({ id: triageDecisions.id, outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.itemId, "item-1"));

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(item.status).toBe("needs_manual");
      expect(github.approvePullRequest).not.toHaveBeenCalled();
      expect(decisions).toContainEqual({
        id: governanceDecisionId(),
        outcome: "auto_approve",
      });
      expect(decisions).toContainEqual({
        id: manualDispositionId(),
        outcome: "needs_manual",
      });
    },
  );

  it.each(["merged", "resolved", "dismissed"] as const)(
    "does not approve a terminal %s Factory item",
    async (status) => {
      await seedItem(status, false, DEFAULT_FACTORY_ID);
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

      expect(result).toMatchObject({
        ok: true,
        action: "skipped",
        reason: expect.stringContaining(`already ${status}`),
      });
      expect(github.getPullRequestSummary).not.toHaveBeenCalled();
      expect(github.approvePullRequest).not.toHaveBeenCalled();
    },
  );

  it("recovers an attributed Factory approval without requiring it to be a human member approval", async () => {
    await seedInternalApprovalPath(true);
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("auto_approved");
    expect(decision.outcome).toBe("auto_approve");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.getAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "provider timeout",
      () => new GitHubRequestError("approval timed out", true),
      "approval timed out",
    ],
    [
      "unrecognized response failure",
      () => new Error("approval response was invalid"),
      "approval response was invalid",
    ],
  ])(
    "reconciles an ambiguous %s without posting a duplicate",
    async (_label, createError, message) => {
      await seedInternalApprovalPath();
      const firstAttempt = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        approvalError: createError(),
      });

      await expect(
        runGovernance(firstAttempt, DEFAULT_FACTORY_ID, true),
      ).rejects.toThrow(message);

      const itemAfterError = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decisionAfterError = (
        await db
          .select({
            outcome: triageDecisions.outcome,
            reason: triageDecisions.reason,
          })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];
      expect(itemAfterError.status).toBe("reconciliation_required");
      expect(decisionAfterError).toEqual({
        outcome: "needs_manual",
        reason:
          "GitHub approval request outcome is ambiguous; reconciliation is required before retrying.",
      });

      const retry = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
      });
      await expect(
        runGovernance(retry, DEFAULT_FACTORY_ID, true),
      ).rejects.toThrow(
        "A pull-request approval intent already exists; reconcile the provider result before retrying.",
      );
      const itemAfterRetry = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decisionAfterRetry = (
        await db
          .select({
            outcome: triageDecisions.outcome,
            reason: triageDecisions.reason,
          })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(itemAfterRetry.status).toBe("reconciliation_required");
      expect(decisionAfterRetry).toEqual(decisionAfterError);
      expect(firstAttempt.approvePullRequest).toHaveBeenCalledTimes(1);
      expect(retry.approvePullRequest).not.toHaveBeenCalled();
    },
  );

  it("releases an approval claim when its transaction fails before the GitHub request", async () => {
    await seedInternalApprovalPath();
    const failure = new Error("approval transaction could not start");
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      beforeSummaryReturn: async (callNumber) => {
        if (callNumber === 4) {
          vi.spyOn(db, "transaction").mockRejectedValueOnce(failure);
        }
      },
    });

    await expect(
      runGovernance(github, DEFAULT_FACTORY_ID, true),
    ).rejects.toThrow(failure.message);

    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(item.status).toBe("pr_observed");
    expect(decision).toEqual({
      outcome: "needs_manual",
      reason:
        "The approval attempt failed before the GitHub request was attempted: approval transaction could not start",
    });
  });

  it("does not downgrade a concurrently finalized approval in the manual path", async () => {
    await seedInternalApprovalPath(true);
    const github = governanceGitHub({
      changedFiles: ["src/change.ts"],
      beforeSummaryReturn: async () => {
        await db
          .update(triageItems)
          .set({ status: "auto_approved" })
          .where(eq(triageItems.id, "item-1"));
        await db
          .update(triageDecisions)
          .set({ outcome: "auto_approve" })
          .where(eq(triageDecisions.id, governanceDecisionId()));
      },
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("auto_approved");
    expect(decision.outcome).toBe("auto_approve");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("recovers a late attributed approval after an ambiguous provider result", async () => {
    await seedInternalApprovalPath();
    const firstAttempt = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      approvalError: new GitHubRequestError("approval timed out", true),
    });
    await expect(
      runGovernance(firstAttempt, DEFAULT_FACTORY_ID, true),
    ).rejects.toThrow("approval timed out");

    const lateApproval = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });
    const result = await runGovernance(lateApproval, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision.outcome).toBe("auto_approve");
    expect(lateApproval.approvePullRequest).not.toHaveBeenCalled();
  });

  it("recovers an accepted approval after the post-approval summary read fails", async () => {
    await seedInternalApprovalPath();
    const firstAttempt = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      postApprovalSummaryError: new Error("summary read unavailable"),
    });

    await expect(
      runGovernance(firstAttempt, DEFAULT_FACTORY_ID, true),
    ).rejects.toThrow("summary read unavailable");

    const itemAfterError = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisionAfterError = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];
    expect(itemAfterError.status).toBe("reconciliation_required");
    expect(decisionAfterError).toEqual({
      outcome: "needs_manual",
      reason:
        "GitHub accepted the approval, but live state could not be revalidated afterward; reconciliation is required.",
    });

    const retryWithoutVisibleApproval = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
    });
    await expect(
      runGovernance(retryWithoutVisibleApproval, DEFAULT_FACTORY_ID, true),
    ).rejects.toThrow(
      "A pull-request approval intent already exists; reconcile the provider result before retrying.",
    );

    const lateApproval = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });
    serializeTriageMetadataMock.mockClear();
    const recoveredResult = await runGovernance(
      lateApproval,
      DEFAULT_FACTORY_ID,
      true,
    );
    const itemAfterRecovery = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisionAfterRecovery = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(recoveredResult).toMatchObject({ ok: true, action: "skipped" });
    expect(itemAfterRecovery.status).toBe("reconciliation_required");
    expect(decisionAfterRecovery.outcome).toBe("auto_approve");
    expect(firstAttempt.approvePullRequest).toHaveBeenCalledTimes(1);
    expect(
      retryWithoutVisibleApproval.approvePullRequest,
    ).not.toHaveBeenCalled();
    expect(lateApproval.approvePullRequest).not.toHaveBeenCalled();
    expect(serializeTriageMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprovalHeadSha: "head-sha-1",
        autoApprovalUrl: expect.any(String),
        autoApprovedAt: expect.any(String),
      }),
    );
  });

  it("does not recover a marked approval from an unrelated manual decision", async () => {
    await seedInternalApprovalPath(true);
    await db
      .update(triageDecisions)
      .set({ outcome: "needs_manual", reason: "A reviewer requested a hold." })
      .where(eq(triageDecisions.id, governanceDecisionId()));
    await db
      .update(triageItems)
      .set({ status: "reconciliation_required" })
      .where(eq(triageItems.id, "item-1"));
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision).toEqual({
      outcome: "needs_manual",
      reason: "A reviewer requested a hold.",
    });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("preserves a terminal item when approval recovery races with its disposition", async () => {
    await seedInternalApprovalPath(true);
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
      beforeSummaryReturn: async (callNumber) => {
        if (callNumber !== 2) return;
        await db
          .update(triageItems)
          .set({ status: "merged" })
          .where(eq(triageItems.id, "item-1"));
      },
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("merged");
    expect(decision.outcome).toBe("needs_manual");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("records an external Factory-bot approval as manual instead of recovering it", async () => {
    await seedItem("pr_observed", true);
    const github = governanceGitHub({
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id, outcome: triageDecisions.outcome })
      .from(triageDecisions)
      .where(eq(triageDecisions.itemId, "item-1"));

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decisions).toContainEqual({
      id: governanceDecisionId(),
      outcome: "needs_manual",
    });
    expect(decisions).toContainEqual({
      id: manualDispositionId(),
      outcome: "needs_manual",
    });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.getAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "a non-member",
      reviewOverrides: { authorAssociation: "NONE" },
      reviewerMembership: false,
    },
    {
      label: "a bot",
      reviewOverrides: { authorType: "Bot" },
      reviewerMembership: true,
    },
    {
      label: "a reviewer with an unknown account type",
      reviewOverrides: { authorType: "Unknown" },
      reviewerMembership: true,
    },
    {
      label: "the pull-request author",
      reviewOverrides: { author: "internal-author" },
      reviewerMembership: true,
    },
  ])(
    "does not treat a current-head approval from $label as sufficient",
    async ({ reviewOverrides, reviewerMembership }) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        internalMember: true,
        reviewerMembership,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        reviewEvents: [memberApprovalReview(reviewOverrides)],
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

      expect(result).toMatchObject({ ok: true, action: "approved" });
      expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("relies on live membership when a BuilderIO member is listed as a collaborator", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      reviewerMembership: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "Maintainer",
          authorAssociation: "COLLABORATOR",
        }),
      ],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
      "BuilderIO",
      789,
      "Maintainer",
    );
  });

  it("does not reuse an approval from a reviewer outside BuilderIO", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      reviewerMembership: false,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [memberApprovalReview()],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    expect(result).toMatchObject({ ok: true, action: "approved" });
    expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
      "BuilderIO",
      789,
      "maintainer",
    );
    expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a current approval has no reviewer ID", async () => {
    await seedInternalApprovalPath();
    const missingIdReview = memberApprovalReview();
    delete missingIdReview.authorId;
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [missingIdReview],
    });

    await expect(
      runGovernance(github, DEFAULT_FACTORY_ID, true),
    ).rejects.toThrow("missing a verified GitHub user ID");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("uses a later dismissal to invalidate an older member approval", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          state: "dismissed",
          observedAt: "2026-10-28T13:00:00.000Z",
        }),
        memberApprovalReview({ observedAt: "2026-10-28T12:00:00.000Z" }),
      ],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    expect(result).toMatchObject({ ok: true, action: "approved" });
    expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps a current member approval after a later comment by the same reviewer", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          state: "commented",
          observedAt: "2026-10-28T13:00:00.000Z",
        }),
        memberApprovalReview({ observedAt: "2026-10-28T12:00:00.000Z" }),
      ],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);

    expect(result).toMatchObject({ ok: true, action: "skipped" });
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("records a decision for an existing reconciliation-required item with an external approval", async () => {
    await seedItem("reconciliation_required");
    const github = governanceGitHub({
      currentApproval: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, manualDispositionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision).toMatchObject({
      outcome: "needs_manual",
      reason: expect.stringContaining("does not approve external authors"),
    });
    expect(github.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("keeps a claimed approval recoverable while recording its manual disposition", async () => {
    await seedItem("pr_observed", true);
    const github = governanceGitHub({
      currentApproval: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, manualDispositionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision).toMatchObject({
      outcome: "needs_manual",
      reason: expect.stringContaining("does not approve external authors"),
    });
    expect(github.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("skips an external fork assigned to a verified BuilderIO member before fetching evidence", async () => {
    await seedItem("pr_observed");
    const github = governanceGitHub({
      headRepository: "contributor/fork",
      assignees: [{ id: 456, login: "builder-assignee" }],
      assigneeMember: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining(
        "assigned to a verified BuilderIO member",
      ),
    });
    expect(github.checkOrganizationMemberById).toHaveBeenCalledTimes(2);
    expect(github.checkOrganizationMemberById).toHaveBeenNthCalledWith(
      1,
      "BuilderIO",
      123,
      "external-author",
    );
    expect(github.checkOrganizationMemberById).toHaveBeenNthCalledWith(
      2,
      "BuilderIO",
      456,
      "builder-assignee",
    );
    expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
    expect(github.listPullRequestChangedFiles).not.toHaveBeenCalled();
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
    expect(item.status).toBe("pr_observed");
  });

  it("skips a fork assigned to a verified BuilderIO member during evidence review", async () => {
    await seedItem("pr_observed");
    const github = governanceGitHub({
      headRepository: "contributor/fork",
      currentApproval: true,
      changedFiles: ["src/change.ts"],
      revalidatedSummary: {
        assignees: [{ id: 456, login: "builder-assignee" }],
      },
      assigneeMember: true,
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining(
        "assigned to a verified BuilderIO member",
      ),
    });
    expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
      "BuilderIO",
      456,
      "builder-assignee",
    );
    expect(github.getPullRequestSummary).toHaveBeenCalledTimes(2);
    expect(github.getPullRequestEvidence).toHaveBeenCalledTimes(1);
    expect(decisions).toEqual([]);
    expect(item.status).toBe("pr_observed");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("preserves an approval claim when an external fork gains a verified assignee", async () => {
    await seedItem("pr_observed", true);
    const github = governanceGitHub({
      headRepository: "contributor/fork",
      currentApproval: true,
      changedFiles: ["src/change.ts"],
      revalidatedSummary: {
        assignees: [{ id: 456, login: "builder-assignee" }],
      },
      assigneeMember: true,
    });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id, outcome: triageDecisions.outcome })
      .from(triageDecisions)
      .where(eq(triageDecisions.itemId, "item-1"));

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining(
        "assigned to a verified BuilderIO member",
      ),
    });
    expect(item.status).toBe("pr_observed");
    expect(decisions).toEqual([
      { id: governanceDecisionId(), outcome: "auto_approval_claimed" },
    ]);
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it.each(["merged", "resolved", "dismissed"] as const)(
    "reports a terminal %s item as skipped when changed-file evidence is missing",
    async (status) => {
      await seedItem(status);
      const result = await runGovernance(
        governanceGitHub({ changedFiles: [] }),
      );
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decisions = await db
        .select({ id: triageDecisions.id })
        .from(triageDecisions);

      expect(result).toMatchObject({
        ok: true,
        action: "skipped",
        reason: expect.stringContaining(`already ${status}`),
      });
      expect(item.status).toBe(status);
      expect(decisions).toEqual([]);
    },
  );

  it("does not report a terminal external item as needing disposition", async () => {
    await seedItem("merged");
    const result = await runGovernance(
      governanceGitHub({
        currentApproval: true,
        changedFiles: ["src/change.ts"],
      }),
    );
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining("already merged"),
    });
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
  });

  it.each([
    ["a changed head", { headSha: "new-head-sha" }],
    ["a closed pull request", { state: "closed", merged: true }],
    ["a draft pull request", { draft: true }],
  ])(
    "does not record an external disposition after %s",
    async (_label, summary) => {
      await seedItem("pr_observed");
      const github = governanceGitHub({
        currentApproval: true,
        changedFiles: ["src/change.ts"],
        revalidatedSummary: summary,
      });

      const result = await runGovernance(github);
      const decisions = await db
        .select({ id: triageDecisions.id })
        .from(triageDecisions);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(github.getPullRequestSummary).toHaveBeenCalledTimes(2);
      expect(decisions).toEqual([]);
      expect(item.status).toBe("pr_observed");
    },
  );

  it.each([
    ["a changed head", { headSha: "new-head-sha" }],
    ["a closed pull request", { state: "closed", merged: true }],
    ["a draft pull request", { draft: true }],
  ])(
    "does not record a no-approval disposition after %s",
    async (_label, summary) => {
      await seedItem("pr_observed");
      const github = governanceGitHub({
        currentApproval: false,
        changedFiles: ["src/change.ts"],
        revalidatedSummary: summary,
      });

      const result = await runGovernance(github);
      const decisions = await db
        .select({ id: triageDecisions.id })
        .from(triageDecisions);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(github.getPullRequestSummary).toHaveBeenCalledTimes(2);
      expect(recordFactoryAuditMock).not.toHaveBeenCalled();
      expect(decisions).toEqual([]);
      expect(item.status).toBe("pr_observed");
    },
  );

  it("skips a no-approval fork newly assigned to a verified BuilderIO member", async () => {
    await seedItem("pr_observed");
    const github = governanceGitHub({
      headRepository: "contributor/fork",
      currentApproval: false,
      changedFiles: ["src/change.ts"],
      revalidatedSummary: {
        assignees: [{ id: 456, login: "builder-assignee" }],
      },
      assigneeMember: true,
    });

    const result = await runGovernance(github);
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining(
        "assigned to a verified BuilderIO member",
      ),
    });
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
    expect(item.status).toBe("pr_observed");
  });

  it("skips an internal-author fork newly assigned to a verified BuilderIO member", async () => {
    await seedItem("pr_observed");
    const github = governanceGitHub({
      headRepository: "contributor/fork",
      internalMember: true,
      passingChecks: false,
      changedFiles: ["src/change.ts"],
      revalidatedSummary: {
        assignees: [{ id: 456, login: "builder-assignee" }],
      },
      assigneeMember: true,
    });

    const result = await runGovernance(github);
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: expect.stringContaining(
        "assigned to a verified BuilderIO member",
      ),
    });
    expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
      "BuilderIO",
      456,
      "builder-assignee",
    );
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
    expect(item.status).toBe("pr_observed");
  });

  it.each([
    [
      "after the approval claim",
      {
        revalidatedSummary: {
          assignees: [{ id: 456, login: "builder-assignee" }],
        },
      },
    ],
    [
      "at the final approval check",
      {
        finalPreApprovalSummary: {
          assignees: [{ id: 456, login: "builder-assignee" }],
        },
      },
    ],
  ])(
    "does not approve a fork assigned to a BuilderIO member %s",
    async (_timing, summary) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        headRepository: "contributor/fork",
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        assigneeMember: true,
        ...summary,
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decision = (
        await db
          .select({ outcome: triageDecisions.outcome })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(result).toMatchObject({
        ok: true,
        action: "needs_manual",
        reason: expect.stringContaining("assigned to this fork"),
      });
      expect(item.status).toBe("reconciliation_required");
      expect(decision.outcome).toBe("needs_manual");
      expect(github.checkOrganizationMemberById).toHaveBeenCalledWith(
        "BuilderIO",
        456,
        "builder-assignee",
      );
      expect(github.approvePullRequest).not.toHaveBeenCalled();
    },
  );

  it("rechecks author membership before recording a no-approval disposition", async () => {
    await seedItem("pr_observed");
    const github = governanceGitHub({
      currentApproval: false,
      changedFiles: ["src/change.ts"],
      authorMemberships: [false, true],
    });

    const result = await runGovernance(github);
    const decisions = await db
      .select({ id: triageDecisions.id })
      .from(triageDecisions);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];

    expect(result).toMatchObject({
      ok: true,
      action: "needs_manual",
      reason: expect.stringContaining(
        "membership changed during evidence review",
      ),
    });
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
    expect(item.status).toBe("pr_observed");
  });

  it("reopens a finalized approval when an external author needs manual disposition", async () => {
    await seedItem("auto_approved");
    await db.insert(triageDecisions).values({
      id: governanceDecisionId(),
      itemId: "item-1",
      ruleId: null,
      mode: "automation",
      outcome: "auto_approve",
      reason: "Factory approval was finalized earlier.",
      guardResultsJson: "[]",
      model: "factory-pr-governance",
      promptVersion: 1,
      createdAt: "2026-10-28T12:00:00.000Z",
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      factoryId: "factory-1",
    });
    const github = governanceGitHub({
      currentApproval: true,
      changedFiles: ["src/change.ts"],
    });

    await runGovernance(github);
    await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decisions = await db
      .select({ id: triageDecisions.id, outcome: triageDecisions.outcome })
      .from(triageDecisions)
      .where(eq(triageDecisions.itemId, "item-1"));

    expect(item.status).toBe("needs_manual");
    expect(decisions).toHaveLength(2);
    expect(decisions).toContainEqual({
      id: governanceDecisionId(),
      outcome: "auto_approve",
    });
    expect(decisions).toContainEqual({
      id: manualDispositionId(),
      outcome: "needs_manual",
    });
  });

  it("records missing changed-file evidence without clearing reconciliation state", async () => {
    await seedItem("reconciliation_required");
    const github = governanceGitHub({ currentApproval: false });

    const result = await runGovernance(github);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({
          outcome: triageDecisions.outcome,
          reason: triageDecisions.reason,
        })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, manualDispositionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision).toMatchObject({
      outcome: "needs_manual",
      reason: expect.stringContaining(
        "Changed-file evidence is missing or invalid",
      ),
    });
    expect(github.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("preserves reconciliation-required status when governance declines approval", async () => {
    await seedItem("reconciliation_required", false, DEFAULT_FACTORY_ID);
    const github = governanceGitHub({
      currentApproval: false,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
  });

  it("finalizes an eligible approval and its Factory state together", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "approved" });
    expect(item.status).toBe("auto_approved");
    expect(decision.outcome).toBe("auto_approve");
    expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
  });

  it.each(["merged", "reconciliation_required", "needs_manual"] as const)(
    "does not post an approval when the item becomes %s during final evidence checks",
    async (status) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        beforeEvidenceReturn: async (callNumber) => {
          if (callNumber !== 3) return;
          await db
            .update(triageItems)
            .set({ status })
            .where(eq(triageItems.id, "item-1"));
        },
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decision = (
        await db
          .select({ outcome: triageDecisions.outcome })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(result).toMatchObject({
        ok: true,
        action: status === "merged" ? "skipped" : "needs_manual",
      });
      expect(item.status).toBe(status);
      expect(decision.outcome).toBe("needs_manual");
      expect(github.approvePullRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["closed", { state: "closed", merged: true }],
    ["draft", { draft: true }],
  ])(
    "does not post an approval when the final pre-approval snapshot is %s",
    async (_state, finalPreApprovalSummary) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        finalPreApprovalSummary,
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decision = (
        await db
          .select({ outcome: triageDecisions.outcome })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(item.status).toBe("reconciliation_required");
      expect(decision.outcome).toBe("needs_manual");
      expect(github.approvePullRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["closed", { state: "closed", merged: true }],
    ["draft", { draft: true }],
  ])(
    "does not finalize an approval after the PR becomes %s",
    async (_state, postApprovalSummary) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        postApprovalSummary,
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decision = (
        await db
          .select({ outcome: triageDecisions.outcome })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(item.status).toBe("reconciliation_required");
      expect(decision.outcome).toBe("needs_manual");
      expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["reconciliation_required", "merged", "needs_manual"] as const)(
    "preserves a concurrent %s item state after GitHub accepts the approval",
    async (status) => {
      await seedInternalApprovalPath();
      const github = governanceGitHub({
        internalMember: true,
        passingChecks: true,
        changedFiles: ["src/change.ts"],
        afterApprovalReturn: async () => {
          await db
            .update(triageItems)
            .set({ status })
            .where(eq(triageItems.id, "item-1"));
        },
      });

      const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
      const item = (
        await db
          .select({ status: triageItems.status })
          .from(triageItems)
          .where(eq(triageItems.id, "item-1"))
      )[0];
      const decision = (
        await db
          .select({
            outcome: triageDecisions.outcome,
            reason: triageDecisions.reason,
          })
          .from(triageDecisions)
          .where(eq(triageDecisions.id, governanceDecisionId()))
      )[0];

      expect(result).toMatchObject({ ok: true, action: "needs_manual" });
      expect(item.status).toBe(status);
      expect(decision).toEqual({
        outcome: "needs_manual",
        reason:
          "GitHub accepted the approval, but the Factory item changed before finalization; reconciliation is required.",
      });
    },
  );

  it("recovers a confirmed approval after a manual item hold without clearing the hold", async () => {
    await seedInternalApprovalPath();
    const firstAttempt = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      afterApprovalReturn: async () => {
        await db
          .update(triageItems)
          .set({ status: "needs_manual" })
          .where(eq(triageItems.id, "item-1"));
      },
    });

    const firstResult = await runGovernance(
      firstAttempt,
      DEFAULT_FACTORY_ID,
      true,
    );
    const retryWithoutVisibleApproval = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
    });
    const retryResult = await runGovernance(
      retryWithoutVisibleApproval,
      DEFAULT_FACTORY_ID,
      true,
    );

    const lateApproval = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      reviewEvents: [
        memberApprovalReview({
          author: "factory-bot",
          authorType: "Bot",
          body: `${FACTORY_APPROVAL_BODY_MARKER}${governanceDecisionId()}; recovered`,
        }),
      ],
    });
    serializeTriageMetadataMock.mockClear();
    const recoveredResult = await runGovernance(
      lateApproval,
      DEFAULT_FACTORY_ID,
      true,
    );
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(firstResult).toMatchObject({ ok: true, action: "needs_manual" });
    expect(retryResult).toMatchObject({ ok: true, action: "needs_manual" });
    expect(
      retryWithoutVisibleApproval.approvePullRequest,
    ).not.toHaveBeenCalled();
    expect(recoveredResult).toMatchObject({ ok: true, action: "skipped" });
    expect(item.status).toBe("needs_manual");
    expect(decision.outcome).toBe("auto_approve");
    expect(firstAttempt.approvePullRequest).toHaveBeenCalledTimes(1);
    expect(
      retryWithoutVisibleApproval.approvePullRequest,
    ).not.toHaveBeenCalled();
    expect(lateApproval.approvePullRequest).not.toHaveBeenCalled();
    expect(serializeTriageMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprovalHeadSha: "head-sha-1",
        autoApprovalUrl: expect.any(String),
        autoApprovedAt: expect.any(String),
      }),
    );
  });

  it("does not finalize an approval when another path already released its claim", async () => {
    await seedInternalApprovalPath();
    const github = governanceGitHub({
      internalMember: true,
      passingChecks: true,
      changedFiles: ["src/change.ts"],
      afterApprovalReturn: async () => {
        await db
          .update(triageDecisions)
          .set({ outcome: "needs_manual" })
          .where(eq(triageDecisions.id, governanceDecisionId()));
        await db
          .update(triageItems)
          .set({ status: "reconciliation_required" })
          .where(eq(triageItems.id, "item-1"));
      },
    });

    const result = await runGovernance(github, DEFAULT_FACTORY_ID, true);
    const item = (
      await db
        .select({ status: triageItems.status })
        .from(triageItems)
        .where(eq(triageItems.id, "item-1"))
    )[0];
    const decision = (
      await db
        .select({ outcome: triageDecisions.outcome })
        .from(triageDecisions)
        .where(eq(triageDecisions.id, governanceDecisionId()))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision.outcome).toBe("needs_manual");
  });
});
