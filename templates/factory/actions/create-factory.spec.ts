import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  factoryDefinitions,
  factoryGraphVersions,
  triageConfig,
} from "../server/db/schema.js";

const getDbMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const resolveUniqueFactoryIdMock = vi.hoisted(() => vi.fn());
const assertUniqueSlackChannelForFactoryMock = vi.hoisted(() => vi.fn());
const ensureFactoryAutomationsMock = vi.hoisted(() => vi.fn());
const syncFactoryAutomationEnabledStatesMock = vi.hoisted(() => vi.fn());
const removeFactoryAutomationResourcesMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/factory"),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/lib/factory-scope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/factory-scope.js")>();
  return {
    ...actual,
    resolveUniqueFactoryId: resolveUniqueFactoryIdMock,
    assertUniqueSlackChannelForFactory: assertUniqueSlackChannelForFactoryMock,
  };
});

vi.mock("../server/plugins/factory-scheduler-job.js", () => ({
  ensureFactoryAutomations: ensureFactoryAutomationsMock,
  syncFactoryAutomationEnabledStates: syncFactoryAutomationEnabledStatesMock,
  removeFactoryAutomationResources: removeFactoryAutomationResourcesMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resolveUniqueFactoryIdMock.mockResolvedValue("support-triage");
  assertUniqueSlackChannelForFactoryMock.mockResolvedValue(undefined);
  ensureFactoryAutomationsMock.mockResolvedValue(undefined);
  syncFactoryAutomationEnabledStatesMock.mockResolvedValue(undefined);
  removeFactoryAutomationResourcesMock.mockResolvedValue(undefined);
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
});

describe("create-factory", () => {
  it("creates a name-only factory with a minimal graph and seeded automations", async () => {
    const insertedDefinitions: unknown[] = [];
    const insertedVersions: unknown[] = [];
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: vi.fn((table: unknown) => ({
            values: vi.fn(async (row: unknown) => {
              if (table === factoryDefinitions) insertedDefinitions.push(row);
              if (table === factoryGraphVersions) insertedVersions.push(row);
              if (table === triageConfig) {
                throw new Error("triage config should not be inserted");
              }
            }),
          })),
        };
        await callback(tx);
      }),
    });

    const { default: action } = await import("./create-factory.js");
    const result = await action.run(
      { name: "Support triage" },
      { userEmail: "owner@example.com" },
    );

    expect(result).toMatchObject({
      ok: true,
      factoryId: "support-triage",
      name: "Support triage",
      graphVersion: 1,
      enabledAutomations: [],
    });
    expect(insertedDefinitions).toHaveLength(1);
    expect(insertedVersions).toHaveLength(1);
    expect(ensureFactoryAutomationsMock).toHaveBeenCalledWith(
      "owner@example.com",
      "org-1",
      "support-triage",
      { enabledNames: new Set() },
    );
    expect(syncFactoryAutomationEnabledStatesMock).not.toHaveBeenCalled();
  });

  it("persists source config and enables matching automations", async () => {
    const insertedConfig: unknown[] = [];
    getDbMock.mockReturnValue({
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: vi.fn((table: unknown) => ({
            values: vi.fn(async (row: unknown) => {
              if (table === triageConfig) insertedConfig.push(row);
            }),
          })),
        };
        await callback(tx);
      }),
    });

    const { default: action } = await import("./create-factory.js");
    const result = await action.run(
      {
        name: "Support triage",
        slackWorkspace: "secondary",
        slackChannelId: "C123",
        builderSlackUserId: "U096KN3EL2Y",
        observeSlack: true,
        repository: "agent-native/agent-native",
      },
      { userEmail: "owner@example.com" },
    );

    expect(result.enabledAutomations).toEqual(
      expect.arrayContaining([
        "factory-slack-feedback",
        "factory-pr-governance",
        "factory-pr-babysit",
      ]),
    );
    expect(insertedConfig).toHaveLength(1);
    expect(insertedConfig[0]).toMatchObject({
      slackWorkspace: "secondary",
      slackChannelId: "C123",
      builderSlackUserId: "U096KN3EL2Y",
      pollingEnabled: 1,
    });
    expect(assertUniqueSlackChannelForFactoryMock).toHaveBeenCalled();
    expect(syncFactoryAutomationEnabledStatesMock).toHaveBeenCalledWith(
      "owner@example.com",
      "org-1",
      "support-triage",
      expect.arrayContaining([
        "factory-slack-feedback",
        "factory-pr-governance",
        "factory-pr-babysit",
      ]),
    );
  });

  it("rejects Slack observation without a channel", async () => {
    getDbMock.mockReturnValue({
      transaction: vi.fn(),
    });
    const { default: action } = await import("./create-factory.js");
    await expect(
      action.run(
        { name: "Support triage", observeSlack: true },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow(/Slack channel/);
  });
});
