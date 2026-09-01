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
  };
});

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resolveUniqueFactoryIdMock.mockResolvedValue("support-triage");
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
  it("creates a name-only factory with a minimal graph and no automations", async () => {
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
  });
});
