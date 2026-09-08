import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const readTriageConfigRowMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const createGitHubClientMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());

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
  getDb: getDbMock,
}));

vi.mock("../server/lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn(),
}));

vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));

vi.mock("../server/lib/factory-scope.js", () => ({
  factoryIdSchema: z.string(),
  orgFactoryItemFilter: vi.fn(),
  readTriageConfigRow: readTriageConfigRowMock,
  requireExistingFactory: vi.fn(),
}));

vi.mock("../server/triage/github-client.js", () => ({
  createGitHubClient: createGitHubClientMock,
  GitHubRequestError: class extends Error {},
}));

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: recordFactoryAuditMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
    role: "owner",
  });
  requireFactoryAutomationMock.mockRejectedValue(new Error("gated"));
  readCallingFactoryAutomationMock.mockResolvedValue(null);
  readTriageConfigRowMock.mockResolvedValue(null);
  insertMock.mockReturnValue({
    values: () => ({ onConflictDoUpdate: async () => undefined }),
  });
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: insertMock,
  };
  getDbMock.mockReturnValue({
    // The parked-PR pre-scan awaits `.where()` itself, while the in-transaction
    // lookups await `.limit()`; mocking both the same way breaks confusingly.
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction: async (run: (tx: unknown) => Promise<void>) => run(tx),
  });
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

  it("records the unconfigured repository instead of failing invisibly", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: { repository: null },
    });
    readTriageConfigRowMock.mockResolvedValue({ repository: null });

    await expect(
      action.run(
        {
          factoryId: "testingfactory",
          includeIssues: false,
          includePullRequests: true,
        },
        {
          caller: "automation" as const,
          userEmail: "owner@example.com",
          orgId: "org-1",
        },
      ),
    ).rejects.toThrow("Configure a GitHub repository before polling GitHub.");

    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        action: "poll-github-sources",
        status: "error",
      }),
      "testingfactory",
    );
  });
});

describe("poll-github-sources author filter", () => {
  function pullRequest(number: number, userId: number, userLogin: string) {
    return {
      number,
      title: `PR ${number}`,
      body: null,
      state: "open",
      draft: false,
      htmlUrl: `https://github.com/acme/repo/pull/${number}`,
      userId,
      userLogin,
      headSha: `sha-${number}`,
      headRef: "feature",
      baseRef: "main",
      mergeable: true,
      mergeableState: "clean",
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    };
  }

  function runWithAuthors(authorMode: "include" | "exclude", ids: string[]) {
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode,
        authorIds: ids,
        inboxLimit: 25,
      },
    });
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => [],
      listOpenPullRequests: async () => [
        pullRequest(1, 138030887, "builder-io-integration[bot]"),
        pullRequest(2, 844291, "steve8708"),
      ],
    });
  }

  const context = {
    caller: "automation" as const,
    userEmail: "owner@example.com",
    orgId: "org-1",
  };

  const input = {
    factoryId: "testingfactory",
    includeIssues: false,
    includePullRequests: true,
  };

  it("never stores a pull request whose author the filter excludes", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    runWithAuthors("include", ["138030887"]);

    const result = await action.run(input, context);

    expect(result).toMatchObject({ pullRequests: 1, authorFiltered: 1 });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the inbox budget for matching authors only", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    runWithAuthors("include", ["138030887"]);

    await action.run(input, context);

    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        details: expect.objectContaining({
          authorFiltered: 1,
          added: 1,
          truncated: false,
        }),
      }),
      "testingfactory",
    );
  });

  it("separates an all-filtered run from an empty repository queue", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    runWithAuthors("include", ["999999"]);

    const result = await action.run(input, context);

    expect(result).toMatchObject({ pullRequests: 0, authorFiltered: 2 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        status: "skipped",
        summary:
          "Every open item was skipped by the automation's author filter (2 skipped).",
      }),
      "testingfactory",
    );
  });
});
