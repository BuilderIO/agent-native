import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());
const readFactoryPollCursorMock = vi.hoisted(() => vi.fn());
const writeFactoryPollCursorMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: recordFactoryAuditMock,
}));

vi.mock(
  "../server/lib/require-factory-automation.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/require-factory-automation.js")
    >()),
    requireFactoryAutomation: requireFactoryAutomationMock,
  }),
);

vi.mock("../server/lib/factory-poll-cursors.js", () => ({
  readFactoryPollCursor: readFactoryPollCursorMock,
  writeFactoryPollCursor: writeFactoryPollCursorMock,
}));

function item(id: string, authorId: string) {
  return {
    id,
    source: "github",
    externalId: id,
    sourceUrl: null,
    title: id,
    summary: null,
    status: "pr_observed",
    risk: "unknown",
    coverage: "complete",
    repository: "acme/repo",
    pullRequestNumber: 1,
    headSha: "abc",
    metadataJson: JSON.stringify({ authorId, author: "octocat" }),
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  recordFactoryAuditMock.mockResolvedValue(undefined);
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  readFactoryPollCursorMock.mockResolvedValue(null);
  writeFactoryPollCursorMock.mockResolvedValue(undefined);
  readCallingFactoryAutomationMock.mockResolvedValue({
    name: "factory-pr-governance",
    content: "",
    config: {
      source: "github",
      authorMode: "include",
      authorIds: ["99"],
      workLimit: 3,
    },
  });
});

describe("list-triage-items automation limits", () => {
  it("caps automation callers at workLimit even when they ask for more", async () => {
    const rows = [
      item("a", "99"),
      item("b", "99"),
      item("c", "99"),
      item("d", "99"),
      item("e", "1"),
    ];
    let selectCalls = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue(rows),
                })),
              };
            }
            return { orderBy: vi.fn().mockResolvedValue([]) };
          }),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "github",
        needsReview: true,
        limit: 5,
      },
      {
        caller: "automation",
        userEmail: "owner@example.com",
        automation: {
          triggerId: "job-1",
          triggerName: "factory-github-issues",
        },
      },
    );
    expect(result.items).toHaveLength(3);
    expect(recordFactoryAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({
          limit: 3,
          listedItems: [
            { itemId: "a", status: "pr_observed", outcome: null },
            { itemId: "b", status: "pr_observed", outcome: null },
            { itemId: "c", status: "pr_observed", outcome: null },
          ],
        }),
      }),
      expect.anything(),
    );
    expect(result.items.every((entry: { author: string }) => true)).toBe(true);
    expect(
      result.items.every((entry: { id: string }) =>
        ["a", "b", "c"].includes(entry.id),
      ),
    ).toBe(true);
  });

  it("drops parked babysit items from the GitHub review window", async () => {
    const parked = {
      ...item("parked", "99"),
      metadataJson: JSON.stringify({
        authorId: "99",
        author: "octocat",
        prBabysitState: "waiting",
      }),
    };
    const rows = [parked, item("fresh", "99")];
    let selectCalls = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue(rows),
                })),
              };
            }
            return { orderBy: vi.fn().mockResolvedValue([]) };
          }),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "github",
        needsReview: true,
        limit: 5,
      },
      {
        caller: "automation",
        userEmail: "owner@example.com",
        automation: {
          triggerId: "job-1",
          triggerName: "factory-pr-governance",
        },
      },
    );
    expect(result.items.map((entry: { id: string }) => entry.id)).toEqual([
      "fresh",
    ]);
  });

  it("keeps scanning past a parked page so the review cursor stays usable", async () => {
    const parked = (id: string) => ({
      ...item(id, "99"),
      id,
      metadataJson: JSON.stringify({
        authorId: "99",
        author: "octocat",
        prBabysitState: "waiting",
      }),
    });
    const pages = [
      [parked("p1"), parked("p2"), parked("p3")],
      [item("fresh", "99")],
    ];
    let itemPages = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => {
              if (itemPages < pages.length) {
                return {
                  limit: vi.fn().mockResolvedValue(pages[itemPages++] ?? []),
                };
              }
              return Promise.resolve([]);
            }),
          })),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "github",
        needsReview: true,
        limit: 2,
      },
      {
        userEmail: "owner@example.com",
      },
    );
    expect(result.items.map((entry: { id: string }) => entry.id)).toEqual([
      "fresh",
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("does not invent a next page when the last scan fills exactly", async () => {
    const rows = [item("a", "99"), item("b", "99")];
    let selectCalls = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue(rows),
                })),
              };
            }
            return { orderBy: vi.fn().mockResolvedValue([]) };
          }),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "github",
        needsReview: true,
        limit: 2,
      },
      {
        userEmail: "owner@example.com",
      },
    );
    expect(result.items.map((entry: { id: string }) => entry.id)).toEqual([
      "a",
      "b",
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    for (const entry of result.items) {
      expect(entry.inboxPresentation?.routing.labelKey).toMatch(
        /^triage\.inboxRouting\./,
      );
      expect(entry.inboxPresentation).toHaveProperty("leavesReviewWindow");
    }
  });

  it("drops started and already-marked Slack items from the review window", async () => {
    const slackItem = (
      id: string,
      status: string,
      slackReactionName?: string,
    ) => ({
      ...item(id, "99"),
      id,
      source: "slack",
      status,
      metadataJson: JSON.stringify({
        authorId: "99",
        author: "octocat",
        ...(slackReactionName ? { slackReactionName } : {}),
      }),
    });
    const rows = [
      slackItem("started", "automation_started"),
      slackItem("marked", "received", "eyes"),
      slackItem("fresh", "received"),
    ];
    let selectCalls = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue(rows),
                })),
              };
            }
            return { orderBy: vi.fn().mockResolvedValue([]) };
          }),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "slack",
        needsReview: true,
        limit: 5,
      },
      {
        userEmail: "owner@example.com",
      },
    );
    expect(result.items.map((entry: { id: string }) => entry.id)).toEqual([
      "fresh",
    ]);
  });

  it("lists newest first for a caller named like the retired babysit job, with no queue cursor", async () => {
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factory-pr-babysit",
      content: "",
      config: {
        source: "github",
        authorMode: "include",
        authorIds: ["99"],
        workLimit: 3,
        repository: "acme/repo",
      },
    });
    const queued = {
      ...item("queued", "99"),
      id: "queued",
      updatedAt: "2026-09-14T18:35:19.685Z",
      metadataJson: JSON.stringify({
        authorId: "99",
        author: "builder-io-bot",
        prBabysitState: "queued",
        prBabysitPendingReopen: true,
      }),
    };
    const fresh = {
      ...item("fresh", "99"),
      id: "fresh",
      updatedAt: "2026-09-14T19:00:00.000Z",
    };
    let selectCalls = 0;
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue([fresh, queued]),
                })),
              };
            }
            return { orderBy: vi.fn().mockResolvedValue([]) };
          }),
        })),
      })),
    });
    const { default: action } = await import("./list-triage-items.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        source: "github",
        needsReview: true,
        limit: 1,
      },
      {
        caller: "automation",
        userEmail: "owner@example.com",
        automation: {
          triggerId: "job-1",
          triggerName: "factory-pr-babysit",
        },
      },
    );
    expect(result.items.map((entry: { id: string }) => entry.id)).toEqual([
      "fresh",
    ]);
    expect(readFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(writeFactoryPollCursorMock).not.toHaveBeenCalled();
  });
});

describe("list-triage-items workflow gate", () => {
  const context = {
    caller: "automation" as const,
    userEmail: "owner@example.com",
    automation: { triggerId: "job-1", triggerName: "factories/f1/flow" },
  };

  function emptyDb() {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
          })),
        })),
      })),
    });
  }

  it("asks the workflow gate when the calling job's runner is workflow", async () => {
    emptyDb();
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/f1/flow",
      content: "---\nrunner: workflow\n---\n",
      config: { source: "slack", workLimit: 3 },
    });
    const { default: action } = await import("./list-triage-items.js");

    await action.run({ factoryId: "f1", limit: 5 }, context);

    expect(requireFactoryAutomationMock).toHaveBeenCalledWith(
      context,
      { userEmail: "owner@example.com", orgId: "org-1" },
      "workflow",
      "f1",
    );
  });

  it("stops a workflow whose graph does not name it, before reading the queue", async () => {
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factories/f1/flow",
      content: "---\nrunner: workflow\n---\n",
      config: { source: "slack", workLimit: 3 },
    });
    requireFactoryAutomationMock.mockRejectedValue(new Error("not named"));
    const { default: action } = await import("./list-triage-items.js");

    await expect(
      action.run({ factoryId: "f1", limit: 5 }, context),
    ).rejects.toThrow("not named");
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("leaves a legacy job, and a person, ungated as before", async () => {
    emptyDb();
    const { default: action } = await import("./list-triage-items.js");

    await action.run({ factoryId: "f1", limit: 5 }, context);
    readCallingFactoryAutomationMock.mockResolvedValue(null);
    await action.run(
      { factoryId: "f1", limit: 5 },
      { caller: "frontend", userEmail: "owner@example.com" },
    );

    expect(requireFactoryAutomationMock).not.toHaveBeenCalled();
  });
});
