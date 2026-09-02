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

vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: vi.fn().mockResolvedValue(null),
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

describe("selectParkedRowsForRecheck", () => {
  it("keeps the current-repo open page and a bounded extra set", async () => {
    const { selectParkedRowsForRecheck } =
      await import("./poll-github-sources.js");
    const rows = [
      {
        pullRequestNumber: 1,
        repository: "acme/current",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        pullRequestNumber: 2,
        repository: "acme/old",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        pullRequestNumber: 3,
        repository: "acme/current",
        updatedAt: "2026-09-03T00:00:00.000Z",
      },
      {
        pullRequestNumber: 4,
        repository: "acme/current",
        updatedAt: "2026-09-04T00:00:00.000Z",
      },
      {
        pullRequestNumber: 5,
        repository: "acme/current",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ];
    expect(
      selectParkedRowsForRecheck(rows, {
        configuredRepository: "acme/current",
        listedOpenPrNumbers: new Set([1]),
        extraLimit: 2,
      }).map((row) => row.pullRequestNumber),
    ).toEqual([1, 5, 4]);
  });

  it("drops parked rows from another repository", async () => {
    const { selectParkedRowsForRecheck } =
      await import("./poll-github-sources.js");
    expect(
      selectParkedRowsForRecheck(
        [
          {
            pullRequestNumber: 9,
            repository: "acme/old",
            updatedAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        {
          configuredRepository: "acme/current",
          listedOpenPrNumbers: new Set(),
        },
      ),
    ).toEqual([]);
  });
});

describe("mapWithConcurrency", () => {
  it("never runs more workers than the limit", async () => {
    const { mapWithConcurrency } = await import("./poll-github-sources.js");
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      seen.push(value);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(seen.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5]);
  });
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
