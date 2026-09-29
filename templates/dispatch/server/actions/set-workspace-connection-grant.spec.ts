import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertGrantManager: vi.fn(),
  getConnection: vi.fn(),
  getGrant: vi.fn(),
  revokeGrant: vi.fn(),
  upsertConnection: vi.fn(),
  upsertGrant: vi.fn(),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  getWorkspaceConnection: mocks.getConnection,
  getWorkspaceConnectionGrant: mocks.getGrant,
  revokeWorkspaceConnectionGrant: mocks.revokeGrant,
  upsertWorkspaceConnection: mocks.upsertConnection,
  upsertWorkspaceConnectionGrant: mocks.upsertGrant,
}));
vi.mock("../../actions/connection-permissions.js", () => ({
  assertWorkspaceConnectionGrantManager: mocks.assertGrantManager,
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";
import type { WorkspaceConnection } from "@agent-native/core/workspace-connections";

import action from "../../actions/set-workspace-connection-grant.js";

const connection: WorkspaceConnection = {
  id: "connection-1",
  provider: "example",
  label: "Example workspace",
  accountId: null,
  accountLabel: "Example account",
  status: "connected",
  scopes: [],
  config: {},
  allowedApps: [],
  allowedUsers: [],
  allowedUserGroups: [],
  credentialRefs: [],
  ownerEmail: "user@example.com",
  orgId: "org-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastCheckedAt: null,
  lastError: null,
};

describe("set-workspace-connection-grant action cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertGrantManager.mockResolvedValue(undefined);
    mocks.getConnection.mockResolvedValue(connection);
    mocks.getGrant.mockResolvedValue(null);
    mocks.revokeGrant.mockResolvedValue(false);
    mocks.upsertConnection.mockImplementation(async (input) => ({
      ...connection,
      allowedApps: input.allowedApps,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }));
    mocks.upsertGrant.mockResolvedValue({
      connectionId: connection.id,
      appId: "mail",
      provider: connection.provider,
      scopes: [],
      config: {},
      credentialRefs: [],
    });
  });

  it("records a card when app access changes", async () => {
    const result = await action.run(
      { connectionId: connection.id, appId: "mail", granted: true },
      { caller: "tool" },
    );

    expect(result).toMatchObject({
      allowedApps: ["mail"],
      change: {
        verb: "updated",
        kind: "workspace-connection",
        title: "Example workspace",
        detail: "mail",
        url: "/integrations",
      },
    });
    expect(action.chatUI?.renderer).toBe(ACTION_CHAT_UI_RECORD_CHANGE_RENDERER);
    expect(action.chatUI?.when?.({}, result)).toBe(true);
  });

  it("keeps unchanged all-app access as an ordinary action result", async () => {
    const result = await action.run(
      { connectionId: connection.id, accessMode: "all-apps" },
      { caller: "tool" },
    );

    expect(result).not.toHaveProperty("change");
    expect(action.chatUI?.when?.({}, result)).toBe(false);
  });

  it("records a card when an explicit app grant is created", async () => {
    mocks.getConnection.mockResolvedValue({
      ...connection,
      allowedApps: ["dispatch", "mail"],
    });

    const result = await action.run(
      { connectionId: connection.id, appId: "mail", granted: true },
      { caller: "tool" },
    );

    expect(mocks.upsertGrant).toHaveBeenCalledWith({
      connectionId: connection.id,
      appId: "mail",
    });
    expect(result).toMatchObject({
      change: {
        verb: "updated",
        kind: "workspace-connection",
        detail: "mail",
      },
    });
  });
});
