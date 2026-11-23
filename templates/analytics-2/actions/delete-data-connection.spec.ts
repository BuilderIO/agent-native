// oracle-change: the built-in sample connection remains listed after deleting every stored connection.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

/**
 * The warehouse flow refuses to create a connection it could not remove, so
 * deletion is the control that makes the real-credential round trip safe. These
 * checks exercise the delete action's cleanup contract: the row and its grants
 * go, the stored credential goes, a default that pointed at it is cleared, and
 * a non-manager can neither see nor remove it.
 */
interface ConnectionRecord {
  id: string;
  provider: string;
  label: string;
  accountId: string | null;
  orgId: string | null;
  ownerEmail: string;
  config: Record<string, unknown>;
  allowedUsers: string[];
  allowedUserGroups: string[];
  allowedApps: string[];
  status: string;
  credentialRefs: { key: string; provider: string; scope: string }[];
  grants?: string[];
}
const state = vi.hoisted(() => ({
  actor: { userEmail: "qa-owner@example.invalid", orgId: "qa-workspace" } as {
    userEmail: string;
    orgId: string;
  } | null,
  connections: new Map<string, ConnectionRecord>(),
  settings: new Map<string, Record<string, unknown>>(),
  credentials: new Map<string, string>(),
  role: "owner" as string,
  failCredentialDelete: false,
  canonicalOrgEntryReads: false,
  deleted: [] as string[],
}));
vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => state.actor,
  readOrgMemberRole: async () => state.role,
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: async () => null,
  saveCredential: vi.fn(async (key: string, value: string) => {
    state.credentials.set(key, value);
  }),
  deleteCredential: vi.fn(async (key: string) => {
    if (state.failCredentialDelete) throw new Error("Simulated vault failure");
    state.credentials.delete(key);
  }),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (org: string, key: string) =>
    state.settings.get(`org:${org}:${key}`) ?? null,
  putOrgSetting: async (
    org: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    state.settings.set(`org:${org}:${key}`, value);
  },
  mutateUserSetting: async (
    user: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const location = `user:${user}:${key}`;
    const next = await updater(state.settings.get(location) ?? null);
    state.settings.set(location, next);
    return next;
  },
  getUserSetting: async (user: string, key: string) =>
    state.settings.get(`user:${user}:${key}`) ?? null,
  putUserSetting: async (
    user: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    state.settings.set(`user:${user}:${key}`, value);
  },
  getSettingEntry: async (location: string) => {
    // Entry-aware reads address the public store's canonical org location;
    // this fixture keeps org helper writes in its existing readable map.
    const fixtureLocation =
      state.canonicalOrgEntryReads && location.startsWith("o:")
        ? `org:${location.slice(2)}`
        : location;
    return state.settings.has(fixtureLocation)
      ? { found: true, value: state.settings.get(fixtureLocation) }
      : { found: false };
  },
  listOrgSettings: async (org: string, prefix = "") => {
    const scoped = `org:${org}:${prefix}`;
    const out: Record<string, Record<string, unknown>> = {};
    for (const [location, value] of state.settings) {
      if (!location.startsWith(scoped)) continue;
      out[location.slice(`org:${org}:`.length)] = value;
    }
    return out;
  },
  mutateOrgSetting: async (
    org: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
    _options?: unknown,
  ) => {
    const location = `org:${org}:${key}`;
    const next = updater(state.settings.get(location) ?? null);
    state.settings.set(location, next);
    return next;
  },
  deleteSetting: async (location: string) => state.settings.delete(location),
  deleteSettingIfValue: async (
    location: string,
    expected: Record<string, unknown>,
  ) => false && expected && state.settings.delete(location),
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  }),
  withDbExec: (_tx: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  getWorkspaceConnection: async (id: string) => {
    const row = state.connections.get(id);
    return row?.orgId === state.actor?.orgId ? row : null;
  },
  listWorkspaceConnectionsForApp: async () =>
    [...state.connections.values()].filter(
      (c) => c.orgId === state.actor?.orgId,
    ),
  listWorkspaceConnections: async () =>
    [...state.connections.values()].filter(
      (c) => c.orgId === state.actor?.orgId,
    ),
  deleteWorkspaceConnection: async (id: string) => {
    const row = state.connections.get(id);
    if (!row || row.orgId !== state.actor?.orgId) return false;
    state.connections.delete(id);
    state.deleted.push(id);
    return true;
  },
  assertWorkspaceUserGroupIds: async (groups: string[]) => groups,
  credentialKeyMatches: (
    _provider: string,
    requested: string,
    actual: string,
  ) => requested === actual,
  resolveWorkspaceConnectionCredentialForApp: async ({
    key,
    connectionId,
  }: {
    key: string;
    connectionId: string;
  }) => ({
    available: state.credentials.has(`${connectionId}:${key}`),
    value: state.credentials.get(`${connectionId}:${key}`),
  }),
  upsertWorkspaceConnection: async () => ({}),
  upsertWorkspaceConnectionGrant: async () => ({}),
}));

import {
  deleteDataConnection,
  listDataConnections,
  setDefaultDataConnection,
} from "../server/model/data-connections";
import deleteAction from "./delete-data-connection";

const connection = (
  overrides: Partial<ConnectionRecord> = {},
): ConnectionRecord => ({
  id: "qa-connection",
  provider: "bigquery",
  label: "QA warehouse",
  accountId: "qa-project",
  orgId: "qa-workspace",
  ownerEmail: "qa-owner@example.invalid",
  config: {
    projectId: "qa-project",
    serviceAccountCredentialKey: "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
    dbtCredentialKey: "DATA_CONNECTION_QA_SERVICE_ACCOUNT_DBT",
  },
  allowedUsers: [],
  allowedUserGroups: [],
  allowedApps: ["analytics-2"],
  status: "connected",
  credentialRefs: [
    {
      key: "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
      provider: "bigquery",
      scope: "org",
    },
  ],
  ...overrides,
});

beforeEach(() => {
  state.actor = {
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  };
  state.connections.clear();
  state.settings.clear();
  state.credentials.clear();
  state.role = "owner";
  state.failCredentialDelete = false;
  state.canonicalOrgEntryReads = false;
  state.deleted = [];
});

describe("delete data connection", () => {
  it("removes the connection, its stored credentials and its default, and reads back zero", async () => {
    state.connections.set("qa-connection", connection());
    state.credentials.set(
      "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
      "SYNTHETIC TEST FIXTURE",
    );
    state.credentials.set(
      "DATA_CONNECTION_QA_SERVICE_ACCOUNT_DBT",
      "SYNTHETIC TEST FIXTURE",
    );
    await setDefaultDataConnection("qa-connection");
    expect((await listDataConnections())[0]?.isDefault).toBe(true);

    await expect(
      deleteAction.run({ id: "qa-connection" }, {} as never),
    ).resolves.toEqual({
      id: "qa-connection",
      deleted: true,
    });

    expect(state.deleted).toEqual(["qa-connection"]);
    expect((await listDataConnections()).map((entry) => entry.id)).toEqual([
      SAMPLE_DATA_SOURCE_ID,
    ]);
    expect(state.connections.size).toBe(0);
    expect([...state.credentials.keys()]).toEqual([]);
    expect(
      state.settings.get("org:qa-workspace:analytics.data.default-connection"),
    ).toEqual({
      id: null,
    });
  });

  it("keeps a draft connection removable and never returns credential values", async () => {
    state.connections.set(
      "qa-draft",
      connection({
        id: "qa-draft",
        status: "disabled",
        config: { projectId: "qa-project", draft: true },
      }),
    );
    const result = await deleteDataConnection({ id: "qa-draft" });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC");
    expect(state.connections.size).toBe(0);
  });

  it("refuses a member and an anonymous caller, and never deletes another workspace's connection", async () => {
    state.connections.set("qa-connection", connection());
    state.role = "member";
    await expect(deleteDataConnection({ id: "qa-connection" })).rejects.toThrow(
      "Only workspace admins",
    );
    expect(state.connections.size).toBe(1);

    state.role = "owner";
    state.actor = {
      userEmail: "qa-other@example.invalid",
      orgId: "another-workspace",
    };
    await expect(deleteDataConnection({ id: "qa-connection" })).rejects.toThrow(
      "not found",
    );
    expect(state.connections.size).toBe(1);

    state.actor = null;
    await expect(deleteDataConnection({ id: "qa-connection" })).rejects.toThrow(
      "signed-in account",
    );
  });

  it("reports a vault cleanup failure instead of claiming the credential is gone", async () => {
    state.connections.set("qa-connection", connection());
    state.credentials.set(
      "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
      "SYNTHETIC TEST FIXTURE",
    );
    state.failCredentialDelete = true;
    await expect(
      deleteDataConnection({ id: "qa-connection" }),
    ).rejects.toMatchObject({
      errorCode: "data_connection_credential_cleanup_failed",
      statusCode: 500,
    });
    expect(state.connections.size).toBe(0);
  });

  it("resumes credential and default cleanup when the first deletion removed the row", async () => {
    state.canonicalOrgEntryReads = true;
    state.connections.set("qa-connection", connection());
    const keys = [
      "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
      "DATA_CONNECTION_QA_SERVICE_ACCOUNT_DBT",
    ];
    for (const key of keys)
      state.credentials.set(key, "SYNTHETIC TEST FIXTURE");
    await setDefaultDataConnection("qa-connection");

    state.failCredentialDelete = true;
    await expect(
      deleteDataConnection({ id: "qa-connection" }),
    ).rejects.toMatchObject({
      errorCode: "data_connection_credential_cleanup_failed",
      statusCode: 500,
    });
    expect(state.connections.has("qa-connection")).toBe(false);
    expect([...state.credentials.keys()].sort()).toEqual([...keys].sort());
    expect(
      state.settings.get("org:qa-workspace:analytics.data.default-connection"),
    ).toEqual({ id: "qa-connection" });

    state.failCredentialDelete = false;
    await expect(
      deleteDataConnection({ id: "qa-connection" }),
    ).resolves.toEqual({ id: "qa-connection", deleted: true });
    expect.soft([...state.credentials.keys()]).toEqual([]);
    expect
      .soft(
        state.settings.get(
          "org:qa-workspace:analytics.data.default-connection",
        ),
      )
      .toEqual({ id: null });
    expect((await listDataConnections()).map((entry) => entry.id)).toEqual([
      SAMPLE_DATA_SOURCE_ID,
    ]);
    expect(state.connections.size).toBe(0);
    expect(state.deleted).toEqual(["qa-connection"]);
  });

  it("preserves a credential still referenced by a scoped sibling connection", async () => {
    const sharedKey = "DATA_CONNECTION_QA_SERVICE_ACCOUNT";
    const privateKey = "DATA_CONNECTION_QA_SERVICE_ACCOUNT_DBT";
    state.connections.set("qa-connection", connection());
    state.connections.set(
      "qa-sibling",
      connection({
        id: "qa-sibling",
        label: "QA sibling warehouse",
        config: {
          projectId: "qa-project",
          serviceAccountCredentialKey: sharedKey,
        },
        credentialRefs: [
          { key: sharedKey, provider: "bigquery", scope: "org" },
        ],
      }),
    );
    state.credentials.set(sharedKey, "SYNTHETIC SHARED TEST FIXTURE");
    state.credentials.set(privateKey, "SYNTHETIC PRIVATE TEST FIXTURE");
    await setDefaultDataConnection("qa-connection");

    await expect(
      deleteDataConnection({ id: "qa-connection" }),
    ).resolves.toEqual({
      id: "qa-connection",
      deleted: true,
    });
    expect.soft([...state.credentials.keys()]).toEqual([sharedKey]);
    expect(state.connections.has("qa-connection")).toBe(false);
    expect(state.connections.has("qa-sibling")).toBe(true);
    expect((await listDataConnections()).map((entry) => entry.id)).toEqual([
      "qa-sibling",
      SAMPLE_DATA_SOURCE_ID,
    ]);
    expect(
      state.settings.get("org:qa-workspace:analytics.data.default-connection"),
    ).toEqual({ id: null });
  });

  // The undefined MCP flag expectation from 83667c5b6f is retired by the
  // deliberate UI-only restriction in 3930a672db (imported as e4957ebb9f).
  // Explicit false flags and nonpersistent approval enforce that stronger policy.
  it("is reachable only from the settings UI, never from an agent or chat", () => {
    expect(deleteAction.agentTool).toBe(false);
    expect(deleteAction.mcpTool).toBe(false);
    expect(deleteAction.toolCallable).toBe(false);
    expect(deleteAction.persistInChatHistory).toBe(false);
    expect(deleteAction.needsApproval).toBe(true);
    expect(deleteAction.allowPersistentApproval).toBe(false);
    expect(deleteAction.http).toEqual({ method: "POST" });
  });
});
