import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const recordManualFactoryAuditMock = vi.hoisted(() => vi.fn());

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

vi.mock("../server/triage/audit.js", () => ({
  recordManualFactoryAudit: recordManualFactoryAuditMock,
}));

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "item-1",
    source: "slack",
    externalId: "item-1",
    sourceUrl: null,
    title: "Something broke",
    summary: null,
    status: "needs_manual",
    risk: "unknown",
    coverage: "unknown",
    repository: null,
    metadataJson: JSON.stringify({ slackReactionName: "eyes" }),
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function mockDb(selected: Record<string, unknown> | undefined) {
  const setMock = vi.fn().mockReturnValue({ where: vi.fn() });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  getDbMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selected ? [selected] : []),
        }),
      }),
    }),
    update: updateMock,
  });
  return { updateMock, setMock };
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
  recordManualFactoryAuditMock.mockResolvedValue(undefined);
});

describe("set-triage-item-outcome action", () => {
  it("marks a Slack item resolved without touching its metadata", async () => {
    const { default: action } = await import("./set-triage-item-outcome.js");
    const { setMock } = mockDb(item());

    const result = await action.run(
      { factoryId: "default", itemId: "item-1", outcome: "resolved" },
      {},
    );

    expect(result).toEqual({ ok: true, itemId: "item-1", status: "resolved" });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "resolved",
        metadataJson: JSON.stringify({ slackReactionName: "eyes" }),
      }),
    );
    expect(recordManualFactoryAuditMock).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        action: "set-triage-item-outcome",
        itemId: "item-1",
        details: expect.objectContaining({
          outcome: "resolved",
          nextStatus: "resolved",
        }),
      }),
    );
  });

  it("reopens a Slack item to received and clears the claimed reaction", async () => {
    const { default: action } = await import("./set-triage-item-outcome.js");
    const { setMock } = mockDb(item({ status: "needs_manual" }));

    const result = await action.run(
      { factoryId: "default", itemId: "item-1", outcome: "reopen" },
      {},
    );

    expect(result).toEqual({ ok: true, itemId: "item-1", status: "received" });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "received", metadataJson: "{}" }),
    );
  });

  it("reopens a GitHub PR item to pr_observed and clears the babysit state", async () => {
    const { default: action } = await import("./set-triage-item-outcome.js");
    const { setMock } = mockDb(
      item({
        id: "item-2",
        source: "github",
        status: "needs_manual",
        metadataJson: JSON.stringify({ prBabysitState: "clean" }),
      }),
    );

    const result = await action.run(
      { factoryId: "default", itemId: "item-2", outcome: "reopen" },
      {},
    );

    expect(result).toEqual({
      ok: true,
      itemId: "item-2",
      status: "pr_observed",
    });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pr_observed", metadataJson: "{}" }),
    );
  });

  it("throws when the item does not exist in this org/factory", async () => {
    const { default: action } = await import("./set-triage-item-outcome.js");
    mockDb(undefined);

    await expect(
      action.run(
        { factoryId: "default", itemId: "missing", outcome: "resolved" },
        {},
      ),
    ).rejects.toThrow("Triage item not found");
  });
});
