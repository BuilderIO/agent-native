import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());
const resolveRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: resolveRepositoryMock,
}));
vi.mock("../server/triage/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/triage/github-client.js")
  >()),
  createGitHubClient: createClientMock,
}));

import {
  approvedReview,
  fakeGitHub,
  observedAt,
} from "../server/lib/factory-pull-request.fixture.js";
import action from "./get-factory-merge-gate.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const input = { repo: "acme/app", number: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  resolveRepositoryMock.mockResolvedValue("acme/app");
  createClientMock.mockReturnValue(fakeGitHub());
});

describe("get-factory-merge-gate", () => {
  it("answers eligible for a Builder pull request that clears every rule", async () => {
    await expect(action.run(input, context)).resolves.toMatchObject({
      ok: true,
      eligible: true,
      reasons: [],
      reasonCodes: [],
      repo: "acme/app",
      number: 7,
      headSha: "head-sha-1",
      approvals: {
        seen: 1,
        qualifying: 1,
        byAuthor: 0,
        fromBots: 0,
        fromNonCollaborators: 0,
        stale: 0,
      },
    });
    expect(action.readOnly).toBe(true);
  });

  it("answers not eligible, with every reason, and never merges", async () => {
    const github = fakeGitHub({
      getPullRequestChecks: vi.fn().mockResolvedValue({
        checks: [{ name: "tests", state: "failed", observedAt }],
        checksCoverage: "complete",
      }),
    });
    createClientMock.mockReturnValue(github);

    const result = (await action.run(input, context)) as Record<string, any>;

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toEqual(["checks_not_green"]);
    expect(result.reasons[0]).toContain("tests (failed)");
    expect(result.reasonText).toBe(result.reasons.join(" "));
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("says why an unapproved pull request is held: the code, the sentence a person reads, and the counts", async () => {
    createClientMock.mockReturnValue(
      fakeGitHub({
        listPullRequestReviews: vi.fn().mockResolvedValue({
          reviews: [
            approvedReview({ commitSha: "head-sha-0" }),
            approvedReview({ author: "stranger", authorAssociation: "NONE" }),
          ],
          reviewsTruncated: false,
        }),
      }),
    );

    const result = (await action.run(input, context)) as Record<string, any>;

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toEqual(["approval_required"]);
    expect(result.reasonText).toContain("1 approval on an earlier commit");
    expect(result.reasonText).toContain("not an owner, member or collaborator");
    expect(result.approvals).toEqual({
      seen: 2,
      qualifying: 0,
      byAuthor: 0,
      fromBots: 0,
      fromNonCollaborators: 1,
      stale: 1,
    });
  });

  it("resolves the factory's repository the way every GitHub gate does", async () => {
    resolveRepositoryMock.mockResolvedValue("acme/other");

    const result = (await action.run(input, context)) as Record<string, any>;

    expect(result).toMatchObject({
      eligible: false,
      reasonCodes: ["repository_not_allowed"],
      headSha: null,
    });
    expect(resolveRepositoryMock).toHaveBeenCalledWith(
      {},
      context,
      caller,
      "f1",
    );
  });

  it("records the check in the audit trail even though it only reads", () => {
    const audit = action.audit as {
      onRead: boolean;
      target: (args: unknown) => unknown;
      summary: (args: unknown, result: unknown) => string;
    };

    expect(audit.onRead).toBe(true);
    expect(audit.target(input)).toEqual({
      type: "github-pull-request",
      id: "acme/app#7",
      visibility: "org",
    });
    expect(audit.summary(input, { eligible: false })).toContain("not eligible");
  });

  it("does not read GitHub for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(action.run(input, context)).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
