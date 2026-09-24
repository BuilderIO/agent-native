import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/db/schema.js", () => ({
  triageDecisions: {},
  triageItems: {},
  triageRuns: {},
}));
vi.mock("../server/factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "product-feedback",
}));
vi.mock("../server/lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: vi.fn(),
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: vi.fn(),
}));
vi.mock("../server/triage/audit.js", () => ({ recordFactoryAudit: vi.fn() }));
vi.mock("../server/triage/github-client.js", () => ({
  GitHubRequestError: class GitHubRequestError extends Error {},
  createGitHubClient: vi.fn(),
}));
vi.mock("../server/triage/ids.js", () => ({ stableId: vi.fn() }));
vi.mock("../server/triage/metadata.js", () => ({
  parseTriageMetadata: vi.fn(),
  serializeTriageMetadata: vi.fn(),
}));

import { hasSafeFinalApprovalGateEvidence } from "./govern-factory-pull-request.js";

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
});
