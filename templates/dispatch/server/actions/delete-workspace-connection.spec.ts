import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDeleteManager: vi.fn(),
  deleteConnection: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  deleteWorkspaceConnection: mocks.deleteConnection,
  getWorkspaceConnection: mocks.getConnection,
}));
vi.mock("../../actions/connection-permissions.js", () => ({
  assertWorkspaceConnectionDeleteManager: mocks.assertDeleteManager,
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";
import type { WorkspaceConnection } from "@agent-native/core/workspace-connections";

import action from "../../actions/delete-workspace-connection.js";

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

describe("delete-workspace-connection action cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue(connection);
    mocks.assertDeleteManager.mockResolvedValue(undefined);
    mocks.deleteConnection.mockResolvedValue(true);
  });

  it("records a card only after the connection was deleted", async () => {
    const result = await action.run({ id: connection.id }, { caller: "tool" });

    expect(result).toMatchObject({
      deleted: true,
      change: {
        verb: "deleted",
        kind: "workspace-connection",
        title: "Example workspace",
        detail: "Example account",
        url: "/integrations",
      },
    });
    expect(action.chatUI?.renderer).toBe(ACTION_CHAT_UI_RECORD_CHANGE_RENDERER);
    expect(action.chatUI?.when?.({}, result)).toBe(true);
  });

  it("does not return a card when the deletion did not happen", async () => {
    mocks.deleteConnection.mockResolvedValue(false);

    await expect(
      action.run({ id: connection.id }, { caller: "tool" }),
    ).rejects.toThrow("was not found");
    expect(action.chatUI?.when?.({}, { deleted: false })).toBe(false);
  });
});
