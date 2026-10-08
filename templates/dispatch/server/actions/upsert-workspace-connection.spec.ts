import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertManager: vi.fn(),
  assertUserGroups: vi.fn(),
  getProvider: vi.fn(),
  getConnection: vi.fn(),
  isOrgMember: vi.fn(),
  track: vi.fn(),
  upsertConnection: vi.fn(),
}));

vi.mock("@agent-native/core/connections", () => ({
  getWorkspaceConnectionProvider: mocks.getProvider,
}));
vi.mock("@agent-native/core/org", () => ({
  isOrgMember: mocks.isOrgMember,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("@agent-native/core/workspace-connections", () => ({
  assertWorkspaceUserGroupIds: mocks.assertUserGroups,
  getWorkspaceConnection: mocks.getConnection,
  normalizeWorkspaceConnectionAllowedUsers: (users: string[]) => users,
  upsertWorkspaceConnection: mocks.upsertConnection,
}));
vi.mock("../../actions/connection-permissions.js", () => ({
  assertWorkspaceConnectionManager: mocks.assertManager,
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";
import type { SerializedWorkspaceConnection } from "@agent-native/core/workspace-connections";

import action from "../../actions/upsert-workspace-connection.js";

const context = {
  caller: "tool" as const,
  userEmail: "user@example.com",
  orgId: "org-1",
};

const connection: SerializedWorkspaceConnection = {
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
  lastUsedAt: null,
  lastCheckedAt: null,
  lastError: null,
};

describe("upsert-workspace-connection action cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertManager.mockResolvedValue(undefined);
    mocks.assertUserGroups.mockResolvedValue(undefined);
    mocks.getProvider.mockReturnValue({
      id: "example",
      label: "Example",
      credentialKeys: [],
    });
    mocks.getConnection.mockResolvedValue(null);
    mocks.upsertConnection.mockResolvedValue(connection);
  });

  it("records a card for a newly created connection", async () => {
    const result = await action.run(
      {
        provider: "example",
        status: "connected",
        scopes: [],
        config: {},
        allowedApps: [],
        credentialRefs: [],
      },
      context,
    );

    expect(result).toMatchObject({
      id: "connection-1",
      change: {
        verb: "created",
        kind: "workspace-connection",
        title: "Example workspace",
        detail: "Example account",
        url: "/integrations",
      },
    });
    expect(action.chatUI?.renderer).toBe(ACTION_CHAT_UI_RECORD_CHANGE_RENDERER);
    expect(action.chatUI?.when?.({}, result)).toBe(true);
  });

  it("keeps a semantically unchanged update as an ordinary action result", async () => {
    mocks.getConnection.mockResolvedValue(connection);
    mocks.upsertConnection.mockResolvedValue({
      ...connection,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = await action.run(
      {
        id: connection.id,
        provider: "example",
        status: "connected",
        scopes: [],
        config: {},
        allowedApps: [],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [],
      },
      context,
    );

    expect(result).not.toHaveProperty("change");
    expect(action.chatUI?.when?.({}, result)).toBe(false);
  });

  it("records a card when an existing connection changes", async () => {
    mocks.getConnection.mockResolvedValue(connection);
    mocks.upsertConnection.mockResolvedValue({
      ...connection,
      scopes: ["read"],
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = await action.run(
      {
        id: connection.id,
        provider: "example",
        status: "connected",
        scopes: ["read"],
        config: {},
        allowedApps: [],
        allowedUsers: [],
        allowedUserGroups: [],
        credentialRefs: [],
      },
      context,
    );

    expect(result).toMatchObject({
      change: {
        verb: "updated",
        kind: "workspace-connection",
        title: "Example workspace",
      },
    });
  });
});
