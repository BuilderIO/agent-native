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
        metadataJson: "{}",
      },
      {
        pullRequestNumber: 2,
        repository: "acme/old",
        metadataJson: "{}",
      },
      {
        pullRequestNumber: 3,
        repository: "acme/current",
        metadataJson: '{"prBabysitLastCheckedAt":"2026-09-03T00:00:00.000Z"}',
      },
      {
        pullRequestNumber: 4,
        repository: "acme/current",
        metadataJson: '{"prBabysitLastCheckedAt":"2026-09-02T00:00:00.000Z"}',
      },
      {
        pullRequestNumber: 5,
        repository: "acme/current",
        metadataJson: '{"prBabysitLastCheckedAt":"2026-09-05T00:00:00.000Z"}',
      },
    ];
    expect(
      selectParkedRowsForRecheck(rows, {
        configuredRepository: "acme/current",
        listedOpenPrNumbers: new Set([1]),
        extraLimit: 2,
      }).map((row) => row.pullRequestNumber),
    ).toEqual([1, 4, 3]);
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
            metadataJson: "{}",
          },
        ],
        {
          configuredRepository: "acme/current",
          listedOpenPrNumbers: new Set(),
        },
      ),
    ).toEqual([]);
  });

  // `/pulls?state=open` sorts by creation, so a long-parked pull request that
  // later gets human feedback is only reachable through this extra set. Raise
  // the limit if real inventory outgrows it; do not park items in `active` to
  // keep them on the listed page.
  it("rotates through the oldest rechecks up to the default limit", async () => {
    const { selectParkedRowsForRecheck, PARKED_PR_RECHECK_EXTRA_LIMIT } =
      await import("./poll-github-sources.js");
    const rows = Array.from(
      { length: PARKED_PR_RECHECK_EXTRA_LIMIT + 5 },
      (_, index) => ({
        pullRequestNumber: index + 1,
        repository: "acme/current",
        metadataJson: JSON.stringify({
          prBabysitLastCheckedAt: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      }),
    );
    const selected = selectParkedRowsForRecheck(rows, {
      configuredRepository: "acme/current",
      listedOpenPrNumbers: new Set(),
    });
    expect(selected).toHaveLength(PARKED_PR_RECHECK_EXTRA_LIMIT);
    expect(
      JSON.parse(selected[0]?.metadataJson ?? "{}").prBabysitLastCheckedAt,
    ).toBe(
      rows
        .map(
          (row) =>
            JSON.parse(row.metadataJson).prBabysitLastCheckedAt as string,
        )
        .sort()[0],
    );
  });
});

describe("parkedRecheckEvidencePatch", () => {
  const recheck = {
    humanReviewCommentCount: 1,
    humanReviewBodyCount: 0,
    commentsTruncated: false,
    reviewsTruncated: false,
    changesRequested: false,
    mergeable: null,
    mergeableState: "unknown",
  };

  it("keeps a stored conflict when GitHub has not recomputed mergeability", async () => {
    const { parkedRecheckEvidencePatch } =
      await import("./poll-github-sources.js");
    expect(
      parkedRecheckEvidencePatch(
        { prBabysitMergeConflict: true, prBabysitMergeabilityComputed: true },
        { ...recheck, mergeable: null, mergeableState: "unknown" },
      ),
    ).toMatchObject({
      prBabysitMergeConflict: true,
      prBabysitMergeabilityComputed: true,
    });
  });

  it("adopts a definite reading and records that it was definite", async () => {
    const { parkedRecheckEvidencePatch } =
      await import("./poll-github-sources.js");
    expect(
      parkedRecheckEvidencePatch(
        {},
        { ...recheck, mergeable: true, mergeableState: "unstable" },
      ),
    ).toMatchObject({
      prBabysitMergeConflict: false,
      prBabysitMergeabilityComputed: true,
    });
  });

  it("does not invent a definite reading for a row that never had one", async () => {
    const { parkedRecheckEvidencePatch } =
      await import("./poll-github-sources.js");
    expect(
      parkedRecheckEvidencePatch(
        {},
        { ...recheck, mergeable: null, mergeableState: "unknown" },
      ),
    ).toMatchObject({
      prBabysitMergeConflict: false,
      prBabysitMergeabilityComputed: false,
    });
  });

  it("defers human review counters when poll reopens on new human work", async () => {
    const { parkedRecheckEvidencePatch } =
      await import("./poll-github-sources.js");
    expect(
      parkedRecheckEvidencePatch(
        { prBabysitHumanReviewCommentCount: 1 },
        recheck,
        {
          deferHumanReviewCounters: true,
          checkedAt: "2026-09-10T00:00:00.000Z",
        },
      ),
    ).toEqual({
      prBabysitMergeConflict: false,
      prBabysitMergeabilityComputed: false,
      prBabysitLastCheckedAt: "2026-09-10T00:00:00.000Z",
    });
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
  // Mirrors GitHubOpenItemPage. Built through a helper so a page mock cannot
  // omit a required count and feed NaN into the audit totals.
  function page<T>(
    items: T[],
    extra: { hasMore?: boolean; unparsed?: number } = {},
  ) {
    return {
      items,
      unparsed: extra.unparsed ?? 0,
      hasMore: extra.hasMore ?? false,
    };
  }

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
      listOpenIssues: async () => page([]),
      listOpenPullRequests: async () =>
        page([
          pullRequest(1, 138030887, "builder-io-integration[bot]"),
          pullRequest(2, 844291, "steve8708"),
        ]),
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
          // Skipping an open item means the run did not observe the whole
          // repository, so it must not report a complete observation.
          truncated: true,
          providerHasMore: false,
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
          "No open GitHub items reached the queue: 2 skipped by the automation's author filter.",
        details: expect.objectContaining({ truncated: true }),
      }),
      "testingfactory",
    );
  });

  it("walks past a page of excluded authors to reach a matching one", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode: "include",
        authorIds: ["138030887"],
        inboxLimit: 25,
      },
    });
    const pages = [
      page([pullRequest(1, 844291, "steve8708")], { hasMore: true }),
      page([pullRequest(2, 138030887, "builder-io-integration[bot]")]),
    ];
    const seenPages: number[] = [];
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([]),
      listOpenPullRequests: async (
        _repository: unknown,
        _limit: number,
        options: { page?: number } = {},
      ) => {
        const requested = options.page ?? 1;
        seenPages.push(requested);
        return pages[requested - 1] ?? page([]);
      },
    });

    const result = await action.run(input, context);

    expect(seenPages).toEqual([1, 2]);
    expect(result).toMatchObject({ pullRequests: 1, authorFiltered: 1 });
  });

  it("does not recheck or reopen a parked pull request from an excluded author", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    runWithAuthors("include", ["138030887"]);
    const getPullRequestSummary = vi.fn();
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([]),
      // Parked rows are only rechecked when they fall off the open page.
      listOpenPullRequests: async () => page([]),
      getPullRequestSummary,
    });
    getDbMock.mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: "item-parked",
              metadataJson: JSON.stringify({
                authorId: "844291",
                prBabysitState: "waiting",
              }),
              pullRequestNumber: 9,
              headSha: "sha-9",
              sourceUrl: "https://github.com/acme/repo/pull/9",
              title: "PR 9",
              repository: "acme/repo",
              updatedAt: "2026-09-04T00:00:00.000Z",
            },
          ],
        }),
      }),
      transaction: async (run: (tx: unknown) => Promise<void>) =>
        run({
          select: () => ({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
          }),
          insert: insertMock,
          update: () => ({ set: () => ({ where: async () => undefined }) }),
        }),
    });

    await action.run(input, context);

    expect(getPullRequestSummary).not.toHaveBeenCalled();
  });

  it("reports a run that stopped with provider pages left as truncated", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode: "include",
        authorIds: ["138030887"],
        inboxLimit: 1,
      },
    });
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([]),
      listOpenPullRequests: async () =>
        page([pullRequest(1, 138030887, "builder-io-integration[bot]")], {
          hasMore: true,
        }),
    });

    const result = await action.run(input, context);

    expect(result).toMatchObject({ providerHasMore: true, truncated: true });
  });

  it("walks past a page of already-queued items to reach a new one", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    const { itemDedupeKey } = await import("../server/triage/ids.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode: "include",
        authorIds: ["138030887"],
        inboxLimit: 1,
      },
    });
    const queuedId = itemDedupeKey(
      {
        source: "github",
        externalId: "acme/repo#1",
        repository: "acme/repo",
        pullRequestNumber: 1,
      },
      "org-1",
      "testingfactory",
    );
    getDbMock.mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: queuedId,
              metadataJson: JSON.stringify({ authorId: "138030887" }),
              pullRequestNumber: 1,
              headSha: "sha-1",
              sourceUrl: "https://github.com/acme/repo/pull/1",
              title: "PR 1",
              repository: "acme/repo",
              updatedAt: "2026-09-04T00:00:00.000Z",
            },
          ],
        }),
      }),
      transaction: async (run: (tx: unknown) => Promise<void>) =>
        run({
          select: () => ({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
          }),
          insert: insertMock,
          update: () => ({ set: () => ({ where: async () => undefined }) }),
        }),
    });
    const pages = [
      page([pullRequest(1, 138030887, "builder-io-integration[bot]")], {
        hasMore: true,
      }),
      page([pullRequest(2, 138030887, "builder-io-integration[bot]")]),
    ];
    const seenPages: number[] = [];
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([]),
      listOpenPullRequests: async (
        _repository: unknown,
        _limit: number,
        options: { page?: number } = {},
      ) => {
        const requested = options.page ?? 1;
        seenPages.push(requested);
        return pages[requested - 1] ?? page([]);
      },
    });

    await action.run(input, context);

    // PR 1 fills the inbox limit of 1 in count only: it is already queued, so
    // it consumes no capacity and must not end the walk before PR 2.
    expect(seenPages).toEqual([1, 2]);
  });

  it("names the inbox limit, not the author filter, when the cap dropped everything", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode: "include",
        authorIds: ["138030887"],
        inboxLimit: 0,
      },
    });
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([]),
      listOpenPullRequests: async () =>
        page([pullRequest(1, 138030887, "builder-io-integration[bot]")]),
    });

    await action.run(input, context);

    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        status: "skipped",
        summary:
          "No open GitHub items reached the queue: 1 dropped at the inbox limit.",
        details: expect.objectContaining({
          authorFiltered: 0,
          droppedByInboxLimit: 1,
          truncated: true,
        }),
      }),
      "testingfactory",
    );
  });

  it("explains an empty issue count that came from pull requests on the issues endpoint", async () => {
    const { default: action } = await import("./poll-github-sources.js");
    requireFactoryAutomationMock.mockResolvedValue(undefined);
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/testingfactory/factory-pr-babysit",
      content: "",
      config: {
        repository: "acme/repo",
        authorMode: "include",
        authorIds: ["138030887"],
        inboxLimit: 25,
      },
    });
    createGitHubClientMock.mockReturnValue({
      listOpenIssues: async () => page([], { unparsed: 3 }),
      listOpenPullRequests: async () => page([]),
    });

    const result = await action.run(
      {
        factoryId: "testingfactory",
        includeIssues: true,
        includePullRequests: false,
      },
      context,
    );

    // Those three are fetched as pull requests instead, so the run is not
    // truncated — but the zero issue count still needs an explanation.
    expect(result).toMatchObject({ unparsed: 3, truncated: false });
    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        summary:
          "No open GitHub items reached the queue: 3 pull requests returned by the issues endpoint.",
      }),
      "testingfactory",
    );
  });
});
