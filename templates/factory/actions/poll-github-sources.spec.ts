import { beforeEach, describe, expect, it, vi } from "vitest";

const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireFactoryAutomationMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: (context: unknown) => context,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../server/lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn(),
}));

vi.mock("../server/triage/github-client.js", () => ({
  createGitHubClient: vi.fn(),
}));

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
    role: "owner",
  });
  requireFactoryAutomationMock.mockRejectedValue(new Error("gated"));
});

describe("poll-github-sources action", () => {
  it("gates GitHub polling to githubPolling automations", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    const context = {
      caller: "automation" as const,
      userEmail: "owner@example.com",
      orgId: "org-1",
    };

    await expect(
      action.run(
        {
          factoryId: "enzo-test-factory-3",
          includeIssues: false,
          includePullRequests: true,
        },
        context,
      ),
    ).rejects.toThrow("gated");

    expect(requireFactoryAutomationMock).toHaveBeenCalledWith(
      context,
      { userEmail: "owner@example.com", orgId: "org-1" },
      "githubPolling",
      "enzo-test-factory-3",
    );
  });
});
