import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(new URL("../package.json", import.meta.url))(
  "@electric-sql/pglite",
);

import { triageDecisions, triageItems } from "../server/db/schema.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const getDbMock = vi.hoisted(() => vi.fn());
const resolveFactoryRepositoryMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());
const createGitHubClientMock = vi.hoisted(() => vi.fn());
const stableIdMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
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
  GitHubRequestError: class GitHubRequestError extends Error {},
  createGitHubClient: createGitHubClientMock,
}));
vi.mock("../server/triage/ids.js", () => ({ stableId: stableIdMock }));
vi.mock("../server/triage/metadata.js", () => ({
  parseTriageMetadata: vi.fn(),
  serializeTriageMetadata: vi.fn(),
}));

import {
  approvedReview,
  pullRequestSummary,
} from "../server/lib/factory-pull-request.fixture.js";
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
  `);
  getDbMock.mockReturnValue(db);
  resolveFactoryRepositoryMock.mockResolvedValue("BuilderIO/agent-native");
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.test",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue(context);
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  stableIdMock.mockReturnValue("decision-1");
});

afterEach(async () => {
  await client.close();
});

async function seedItem(status: string, includeClaim = false) {
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
    factoryId: "factory-1",
  });
  if (!includeClaim) return;
  await db.insert(triageDecisions).values({
    id: "decision-1",
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
    factoryId: "factory-1",
  });
}

function governanceGitHub(input: {
  currentApproval?: boolean;
  changedFiles?: string[];
}) {
  return {
    getPullRequestSummary: vi.fn().mockResolvedValue(
      pullRequestSummary({
        number: 42,
        userId: 123,
        userLogin: "external-author",
        headRepository: "BuilderIO/agent-native",
      }),
    ),
    getPullRequestEvidence: vi.fn().mockResolvedValue({
      comments: [],
      commentsTruncated: false,
      reviews: input.currentApproval ? [approvedReview()] : [],
      reviewsTruncated: false,
      checks: [],
      checksCoverage: "complete",
    }),
    listPullRequestChangedFiles: vi
      .fn()
      .mockResolvedValue(input.changedFiles ?? []),
    checkOrganizationMemberById: vi.fn().mockResolvedValue({
      isMember: false,
    }),
    createPullRequestReview: vi.fn(),
  };
}

async function runGovernance(github: ReturnType<typeof governanceGitHub>) {
  createGitHubClientMock.mockReturnValue(github);
  return action.run(
    {
      factoryId: "factory-1",
      repo: "BuilderIO/agent-native",
      pullRequestNumber: 42,
      itemId: "item-1",
      clearBug: false,
      productUxImplications: false,
      reason: "Review the pull request.",
    },
    context,
  );
}

describe("govern-factory-pull-request final check evidence", () => {
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
        .where(eq(triageDecisions.id, "decision-1"))
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
        .where(eq(triageDecisions.id, "decision-1"))
    )[0];

    expect(result).toMatchObject({ ok: true, action: "needs_manual" });
    expect(item.status).toBe("reconciliation_required");
    expect(decision).toMatchObject({
      outcome: "needs_manual",
      reason: expect.stringContaining("does not approve external authors"),
    });
    expect(github.createPullRequestReview).not.toHaveBeenCalled();
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
        .where(eq(triageDecisions.id, "decision-1"))
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
});
