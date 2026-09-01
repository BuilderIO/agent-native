import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());

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
  readCallingFactoryAutomationMock.mockResolvedValue({
    name: "factory-github-issues",
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
});
