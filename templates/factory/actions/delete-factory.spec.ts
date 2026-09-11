import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  factoryAuditEvents,
  factoryComments,
  factoryDefinitions,
  factoryGraphVersions,
  factoryPollCursors,
  triageConfig,
  triageDecisions,
  triageFeedback,
  triageItems,
  triageRules,
  triageRuns,
} from "../server/db/schema.js";

const getDbMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const readTriageConfigRowMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const listFactoryAutomationCleanupPathsMock = vi.hoisted(() => vi.fn());
const removeFactoryAutomationResourcesMock = vi.hoisted(() => vi.fn());
const removeFactoryAutomationRunHistoryMock = vi.hoisted(() => vi.fn());
const snapshotFactoryAutomationsMock = vi.hoisted(() => vi.fn());
const restoreFactoryAutomationSnapshotsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "product-feedback",
  readFactoryDefinition: readFactoryDefinitionMock,
}));

vi.mock("../server/lib/factory-scope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/factory-scope.js")>();
  return {
    ...actual,
    readTriageConfigRow: readTriageConfigRowMock,
  };
});

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

vi.mock("../server/plugins/factory-scheduler-job.js", () => ({
  listFactoryAutomationCleanupPaths: listFactoryAutomationCleanupPathsMock,
  removeFactoryAutomationResources: removeFactoryAutomationResourcesMock,
  removeFactoryAutomationRunHistory: removeFactoryAutomationRunHistoryMock,
  snapshotFactoryAutomations: snapshotFactoryAutomationsMock,
  restoreFactoryAutomationSnapshots: restoreFactoryAutomationSnapshotsMock,
}));

const existingSnapshots = [
  {
    path: "jobs/factories/support-triage/factory-slack-feedback.md",
    content: "---\nenabled: true\n---\n",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "member@example.com",
    orgId: "org-1",
    role: "member",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "member@example.com",
    orgId: "org-1",
  });
  readFactoryDefinitionMock
    .mockResolvedValueOnce({ id: "support-triage", name: "Support triage" })
    .mockResolvedValueOnce(undefined);
  readTriageConfigRowMock.mockResolvedValue({
    pollingEnabled: 1,
    githubPollingEnabled: 0,
    sentryPollingEnabled: 0,
    slackChannelId: "C123",
  });
  listFactoryAutomationCleanupPathsMock.mockResolvedValue([]);
  removeFactoryAutomationResourcesMock.mockResolvedValue(undefined);
  removeFactoryAutomationRunHistoryMock.mockResolvedValue(undefined);
  snapshotFactoryAutomationsMock.mockResolvedValue(existingSnapshots);
  restoreFactoryAutomationSnapshotsMock.mockResolvedValue(undefined);
});

describe("delete-factory", () => {
  it("lets an organization member remove all Factory-owned data and automations", async () => {
    const deletedTables: unknown[] = [];
    const tx = {
      delete: vi.fn((table: unknown) => {
        deletedTables.push(table);
        if (table === factoryDefinitions) {
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: "support-triage" }]),
            })),
          };
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<void>) =>
          callback(tx),
      ),
    });

    const { default: action } = await import("./delete-factory.js");
    const result = await action.run(
      { factoryId: "support-triage", confirmName: "Support triage" },
      { userEmail: "member@example.com", orgId: "org-1" },
    );

    expect(result).toEqual({
      ok: true,
      factoryId: "support-triage",
      name: "Support triage",
      verified: true,
    });
    expect(snapshotFactoryAutomationsMock).toHaveBeenCalledWith(
      "member@example.com",
      "org-1",
      "support-triage",
    );
    expect(removeFactoryAutomationResourcesMock).toHaveBeenCalledWith(
      "org-1",
      "support-triage",
      "member@example.com",
      ["jobs/factories/support-triage/factory-slack-feedback.md"],
    );
    expect(removeFactoryAutomationRunHistoryMock).toHaveBeenCalledWith(
      "org-1",
      "support-triage",
      "member@example.com",
      ["jobs/factories/support-triage/factory-slack-feedback.md"],
    );
    expect(listFactoryAutomationCleanupPathsMock).toHaveBeenCalledWith(
      "org-1",
      "support-triage",
      "member@example.com",
    );
    expect(deletedTables).toEqual([
      factoryDefinitions,
      factoryComments,
      factoryGraphVersions,
      factoryAuditEvents,
      factoryPollCursors,
      triageFeedback,
      triageDecisions,
      triageRuns,
      triageRules,
      triageItems,
      triageConfig,
    ]);
  });

  it("rejects the default Factory before deleting anything", async () => {
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        {
          factoryId: "product-feedback",
          confirmName: "Product feedback to shipped change",
        },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("default Factory");
    expect(removeFactoryAutomationResourcesMock).not.toHaveBeenCalled();
  });

  it("requires the exact current Factory name", async () => {
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Wrong name" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("does not match");
    expect(removeFactoryAutomationResourcesMock).not.toHaveBeenCalled();
  });

  it("restores scheduled automations when the SQL transaction fails", async () => {
    getDbMock.mockReturnValue({
      transaction: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Support triage" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("database unavailable");
    expect(restoreFactoryAutomationSnapshotsMock).toHaveBeenCalledWith(
      "org-1",
      existingSnapshots,
    );
    expect(removeFactoryAutomationRunHistoryMock).not.toHaveBeenCalled();
  });

  it("restores scheduled automations when schedule removal fails", async () => {
    const transaction = vi.fn();
    getDbMock.mockReturnValue({ transaction });
    removeFactoryAutomationResourcesMock.mockRejectedValue(
      new Error("scheduler unavailable"),
    );
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Support triage" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("scheduler unavailable");
    expect(transaction).not.toHaveBeenCalled();
    expect(restoreFactoryAutomationSnapshotsMock).toHaveBeenCalledWith(
      "org-1",
      existingSnapshots,
    );
  });

  it("rejects deletion when the confirmed name no longer matches the row", async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ name: "Renamed factory" }]),
          })),
        })),
      })),
      delete: vi.fn((table: unknown) => {
        if (table === factoryDefinitions) {
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([]),
            })),
          };
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<void>) =>
          callback(tx),
      ),
    });
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Support triage" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow("changed before deletion");
    expect(restoreFactoryAutomationSnapshotsMock).toHaveBeenCalledWith(
      "org-1",
      existingSnapshots,
    );
    expect(removeFactoryAutomationRunHistoryMock).not.toHaveBeenCalled();
  });

  it("returns an unverified success when post-commit confirmation cannot be read", async () => {
    const tx = {
      delete: vi.fn((table: unknown) => {
        if (table === factoryDefinitions) {
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: "support-triage" }]),
            })),
          };
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<void>) =>
          callback(tx),
      ),
    });
    readFactoryDefinitionMock.mockReset();
    readFactoryDefinitionMock
      .mockResolvedValueOnce({ id: "support-triage", name: "Support triage" })
      .mockRejectedValueOnce(new Error("database unavailable"));
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Support triage" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({
      ok: true,
      factoryId: "support-triage",
      name: "Support triage",
      verified: false,
      verificationError: "database unavailable",
    });
    expect(restoreFactoryAutomationSnapshotsMock).not.toHaveBeenCalled();
  });

  it("returns an unverified success when Factory jobs remain after the row is gone", async () => {
    const tx = {
      delete: vi.fn((table: unknown) => {
        if (table === factoryDefinitions) {
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: "support-triage" }]),
            })),
          };
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    getDbMock.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<void>) =>
          callback(tx),
      ),
    });
    listFactoryAutomationCleanupPathsMock.mockResolvedValue([
      "jobs/factories/support-triage/factory-slack-custom.md",
    ]);
    const { default: action } = await import("./delete-factory.js");

    await expect(
      action.run(
        { factoryId: "support-triage", confirmName: "Support triage" },
        { userEmail: "member@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({
      ok: true,
      factoryId: "support-triage",
      name: "Support triage",
      verified: false,
      verificationError:
        "Automations still present: jobs/factories/support-triage/factory-slack-custom.md",
    });
    expect(restoreFactoryAutomationSnapshotsMock).not.toHaveBeenCalled();
    expect(removeFactoryAutomationRunHistoryMock).not.toHaveBeenCalled();
  });
});
